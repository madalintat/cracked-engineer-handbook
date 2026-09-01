# NumPy & PyTorch Internals — Curriculum Research

*What the scientific-Python and deep-learning stack actually is, underneath the Python.*

Research date: 2026-09-01. Audience assumption: the learner already has C++, Linux, x86-64 assembly and CUDA from earlier units. Everything here is written to exploit that — the explanations reach for cache lines, dispatch tables, bitsets and kernel launches rather than analogies.

---

## Source notes — read this first

Everything below was read from primary sources on 2026-09-01: the `numpy/numpy` and `pytorch/pytorch` `main` branches via `raw.githubusercontent.com`, the projects' own documentation, and the OpenXLA / JAX / CPython specs. **Where a claim could not be verified it is marked `> **Flagged.**` inline.** That convention is used ~15 times in this document; take those markers seriously, because several of them contradict things that are widely repeated.

| Source | What it actually is | Value |
|---|---|---|
| `github.com/pytorch/pytorch` `main` | The tree. Note that a large fraction of what you want to read **does not exist in the git tree** — `VariableType_*.cpp`, `Functions.cpp`, `RegisterCPU.cpp`, `python_variable_methods.cpp` are all *generated* into a build directory from `native_functions.yaml` + `derivatives.yaml` + templates. Cite template paths, not generated ones. | Highest. The header comments in `c10/core/DispatchKey.h` and `c10/cuda/CUDACachingAllocator.cpp` are better documentation than anything published. |
| `blog.ezyang.com/2019/05/pytorch-internals/` | The canonical talk-turned-post. Tensor/storage/strides, the two-dispatch picture, the device×layout×dtype trinity, the source-tree map, the kernel-writing checklist. **Seven autograd slides were omitted from the original talk and remain unwritten** — so this post has a hole exactly where autograd should be. | High, with the caveat that it is from 2019: `Variable` and `Tensor` have since merged, `TH` is gone, and the dispatcher has been rebuilt around backend-bits. Use it for the *mental model*, not the API. |
| `blog.ezyang.com/2020/09/lets-talk-about-the-pytorch-dispatcher/` | The design rationale for the dispatcher: the many-dimensions-of-extensibility argument, the operator×key grid, boxing/unboxing, TLS include/exclude, `BackendSelect`. | Highest for *why*. Pair it with `DispatchKey.h` for *what*. Note `blog.ezyang.com/2020/09/pytorch-dispatcher-walkthrough/` **404s** — do not cite it. |
| `docs.pytorch.org/tutorials/advanced/dispatcher.html` | *Registering a Dispatched Operator in C++*. The registration API with working code. **Its `at::AutoNonVariableTypeMode` is the old spelling; current code uses `at::AutoDispatchBelowADInplaceOrView` / `AutoDispatchBelowAutograd`.** | High, but check every guard name against the tree. |
| `numpy.org/doc/stable/` | Reference + C-API pages. Accurate and current, with one exception: the **SIMD "how it works" page documents the pre-1.26 distutils `/*@targets*/` syntax**; under Meson the targets moved into `numpy/_core/meson.build`. | High. |
| MIT 6.172 (Fall 2018) Lecture 1 slides | The 4096³ matmul ladder, Python → AVX intrinsics. **Verified from the OCW PDF**; the headline is **53,292×** at version 10, not the round "50,000×", and the Python row is 21,041.67 s — *different from* the numbers in Leiserson et al.'s Science 2020 paper, which reruns the experiment on other hardware. Do not mix the two tables. | Highest for the quantified argument. |
| `docs.jax.dev/.../autodidax.html` | JAX built from scratch: `Primitive`, `bind`, the `trace_stack`, and the per-transform rule dicts. **The single best explanation of "autodiff as a program transformation" in existence.** | Highest. |
| `dmlc/dlpack` header | The interchange ABI. **v1.2 removed NULL-strides-means-contiguous**; most tutorials are stale on this. | High. |

### Ten things this report corrects

Each of these is repeated widely and is wrong or stale as of this research date. They are called out again at the relevant section.

1. **`Node` is in `torch/csrc/autograd/node.h`**, not `function.h`. And `grad_fn_` is a `c10::intrusive_ptr<Node>`, not a `std::shared_ptr`.
2. **`compute_dependencies` is not a BFS.** It uses `std::vector<Node*>` with `back()`/`pop_back()` — a LIFO stack. (The order is irrelevant; only the in-degree counts matter. But the claim is still wrong.)
3. **nanobind's numbers are ~4× compile / ~5× binary / 3–10× runtime**, not "4/4/8". The "8× runtime" figure appears in no primary source.
4. **pybind11 cannot produce `abi3` wheels** — zero `abi3`/`Py_LIMITED_API` hits across its entire changelog through 3.1.0 (Aug 2026).
5. **CPython's GC thresholds are `(2000, 10, 10)`**, not `(700, 10, 10)`. The generational redesign landed in 3.14 and was **reverted in 3.14.5** for the default build.
6. **DLPack `strides` may no longer be NULL** when `ndim != 0` (v1.2+).
7. **Dynamo's resume functions are named `torch_dynamo_resume_in_<fn>_at_<lineno>`**, not `__resume_at_<offset>`. Likewise the cache entry field is `guard_manager`, not `check_fn`.
8. **`torch.library.impl_abstract` is deprecated** (`FutureWarning`) — the current name is `register_fake`.
9. **"try/except causes a graph break" is a pre-2.2 fact.** Dynamo has had a full exception-handling implementation in `symbolic_convert.py` since then.
10. **`torch.compiler_guards_overview.html` does not exist** (404). Several old flat `docs/stable/torch.compiler_*.html` URLs are now JS redirect stubs — cite the versioned or in-repo paths.

### One methodological note

Two of the most quoted performance numbers in this space — PyTorch's per-kernel-launch overhead and `cudaMalloc`/`cudaFree` cost — could **not** be verified from any primary source. They are treated here as folklore and replaced with (a) a structural account of *where* the cost comes from and (b) an exercise that has the student measure it on their own hardware. That is a better outcome pedagogically anyway: a number you measured is a number you understand.

---

## How to read this document

Sections 1–4 are the technical content, ordered so that each one is a prerequisite for the next: **strides → compute → dispatch → autograd → execution/compilation → the Python boundary.** Section 5 proposes what to build. Section 6 arranges the whole thing into six teachable units with machine-checkable exercises.

The three ideas everything else hangs off, stated once here so they can be referred back to:

1. **Memory is flat; shape is metadata; strides are the interface.** (§1.2, §2.3)
2. **Arithmetic intensity decides everything.** FLOPs per byte moved, compared against machine balance, is the *same* argument that explains BLAS levels, NumPy ufunc performance, GPU kernel fusion, XLA's fusion invariant, and Inductor's entire scheduling strategy. (§1.6, §2.5, §3.4)
3. **An operator is not a function; it is a row in a table.** Cross-cutting concerns are columns. This is PyTorch's dispatcher, and — arrived at independently — JAX's interpreter stack. (§2.2, §3.5)
# 1. NumPy internals

## 1.1 The `ndarray` struct

`numpy/_core/include/numpy/ndarraytypes.h`, verified against `main`:

```c
typedef struct tagPyArrayObject_fields {
    PyObject_HEAD
    char *data;              /* pointer to the raw data buffer                */
    int nd;                  /* number of dimensions, a.k.a. ndim             */
    npy_intp *dimensions;    /* the shape                                     */
    npy_intp *strides;       /* bytes to jump to the next element, per axis   */
    PyObject *base;          /* what this is a view OF (decref'd on delete)   */
    PyArray_Descr *descr;    /* the dtype                                     */
    int flags;               /* C_CONTIGUOUS | F_CONTIGUOUS | OWNDATA | ...   */
    PyObject *weakreflist;
    void *_buffer_info;      /* ≥1.20: cached PEP 3118 export state           */
    PyObject *mem_handler;   /* ≥1.22: per-object allocator                   */
} PyArrayObject_fields;
typedef PyArrayObject_fields PyArrayObject;
```

Facts worth stating out loud to a systems audience:

- **The whole object is ~72–80 bytes on LP64.** The data is somewhere else. `dimensions` and `strides` are two `npy_intp` arrays of length `nd`.
- **`npy_intp` is signed and pointer-wide** (`ssize_t`). Strides being *signed* is exactly what makes `a[::-1]` a view.
- **The struct is opaque since NumPy 1.7.** Under `#define NPY_NO_DEPRECATED_API NPY_1_7_API_VERSION` the public `PyArrayObject` becomes an incomplete type and `arr->data` fails to compile. Go through `PyArray_DATA/NDIM/DIMS/STRIDES/DESCR/BASE/FLAGS/ITEMSIZE`.
- `NPY_SIZEOF_PYARRAYOBJECT` was **removed in 1.20**, with a comment that it "gave a false sense of a stable ABI with respect to the structures size" — use `PyArray_Type.tp_basicsize`.
- **`NPY_MAXDIMS` is 64 since NumPy 2.0** (was 32).

The dtype is its own object:

```c
typedef struct {
    PyObject_HEAD
    PyTypeObject *typeobj;
    char kind;        /* 'b','i','u','f','c','S','U','V','O','M','m' */
    char type;
    char byteorder;   /* '<', '>', '=', '|' */
    char _former_flags;
    int type_num;
    npy_uint64 flags;
    npy_intp elsize;      /* widened from int in NumPy 2.0 */
    npy_intp alignment;
    NpyAuxData *c_metadata;
    npy_hash_t hash;
    void *reserved_null[2];
} PyArray_Descr;
```

`elsize`/`alignment` moved behind `PyDataType_ELSIZE()` / `PyDataType_ALIGNMENT()` accessors in 2.0 for 1.x compatibility. This is a good live example of "the struct is the ABI, and that is why it is now hidden."

## 1.2 Strides, properly

From the NumPy reference, verbatim:

> "An instance of class `ndarray` consists of a contiguous one-dimensional segment of computer memory (owned by the array, or by some other object), combined with an **indexing scheme** that maps N integers into the location of an item in the block."

That indexing scheme is one line of arithmetic. For index `(n₀, n₁, …, n_{N-1})`:

```
byte_address = data + Σ_k  s_k · n_k          (s = strides, in BYTES)
```

The two canonical stride vectors, with `d_j = shape[j]`:

```
column-major (Fortran):  s_k = itemsize · Π_{j<k}  d_j     → s[0]  == itemsize
row-major    (C):        s_k = itemsize · Π_{j>k}  d_j     → s[-1] == itemsize
```

**Strides are otherwise entirely unconstrained.** They need not be positive, need not be multiples of itemsize, need not be monotone, need not be distinct. Every zero-copy trick in the library is a consequence of that freedom:

| Operation | `data` | `shape` | `strides` | Bytes copied |
|---|---|---|---|---|
| `a.T`, `a.transpose(perm)` | unchanged | permuted | permuted | **0** |
| `a[i0:i1:s]` (basic slicing) | `+= i0·stride[0]` | `ceil((i1-i0)/s)` | `stride[0] *= s` | **0** |
| `a[None, :]`, `np.broadcast_to` | unchanged | new axis, size n | **0** on that axis | **0** |
| `a[::-1]` | `+= (n-1)·stride[0]` | unchanged | `stride[0] = -stride[0]` | **0** |

`PyArray_Transpose` (`numpy/_core/src/multiarray/shape.c`) is literally a permuted copy of the `dimensions` and `strides` arrays. The buffer pointer is not touched.

### Broadcasting is stride 0, and that is the whole story

From `PyArray_Broadcast()` in `numpy/_core/src/multiarray/iterators.c`:

```c
    /*
     * Reset the iterator dimensions and strides of each iterator
     * object -- using 0 valued strides for broadcasting
     */
    ...
        if ((k < 0) || PyArray_DIMS(it->ao)[k] != mit->dimensions[j]) {
            it->contiguous = 0;
            it->strides[j] = 0;
        }
        else {
            it->strides[j] = PyArray_STRIDES(it->ao)[k];
        }
```

A stride-0 axis makes the `s_k · n_k` term vanish: **every index on that axis maps to the same byte.** Zero memory, zero copy, and the value is served from L1 (or splatted into a vector register once SIMD gets hold of it). This is why `a + b[:, None]` costs the same *bandwidth* as `a + scalar`.

One consequence to teach explicitly: an array with a zero stride on an axis of size > 1 **aliases**. Multiple logical indices name one byte. So `np.broadcast_to` returns a **read-only** view, and NumPy's BLAS path explicitly rejects stride-0 inputs (`_bad_strides`, §1.6). Broadcasting is safe for reads and a data race for writes.

### C order vs Fortran order

- **C / row-major:** last index varies fastest; `strides[-1] == itemsize`; `a[i,j]` and `a[i,j+1]` are adjacent.
- **Fortran / column-major:** first index varies fastest; `strides[0] == itemsize`; `a[i,j]` and `a[i+1,j]` are adjacent.

The C API's `NPY_ORDER` enum: `NPY_ANYORDER` (-1), `NPY_CORDER` (0), `NPY_FORTRANORDER` (1), **`NPY_KEEPORDER`** (2). The last one means "match the memory layout of the inputs as closely as possible" and is what the iterator uses to pick a traversal that walks memory forward — see §1.5.

**Why order matters for BLAS.** Reference BLAS is Fortran, hence column-major. CBLAS papers over this with a `CBLAS_ORDER` argument plus `lda` (leading dimension). NumPy never transposes data for BLAS — it *describes* the layout. A C-contiguous `(m,n)` array is a column-major `(n,m)` array with `lda = n`; algebraically identical, zero data movement. What does *not* survive is a strided fast axis: `lda` is the slow stride **in elements**, so `stride % itemsize != 0` disqualifies an array outright, and `A[:, ::2] @ B` must copy. **Transposes are free; gathers are not.** Exactly the same distinction as cuBLAS's column-major convention and its `ld` parameters.

## 1.3 When a copy is forced

### Always

- **Advanced (fancy) indexing.** Integer-array and boolean-mask indexing produce index sets that are not expressible as `(offset, shape, strides)`, so there is no view to make. The docs are unambiguous: *"Advanced indexing, on the other hand, always creates copies."* Diagnostic: `y.base is None`.
- **`ndarray.flatten()`** — "always returns a flattened copy". (`ravel()` returns a view "wherever possible" — that asymmetry is a good exam question.)
- **`np.array(x)`** (default `copy=True`). Note NumPy 2.0 changed `np.array(x, copy=False)` to **raise** rather than silently copy; the C flag is `NPY_ARRAY_ENSURENOCOPY` (0x4000).
- `np.ascontiguousarray` / `np.asfortranarray` **when the layout doesn't already satisfy the request** — otherwise they return the same object.

### Copy iff the strides can't express it

- **`reshape`.** From the docs: *"creates a view where possible or a copy otherwise… in some cases where the array becomes non-contiguous (perhaps after a `ndarray.transpose` operation), the reshaping cannot be done by modifying strides and requires a copy."*
  Canonical demo: `a = np.arange(12).reshape(3,4)`; `a.reshape(12)` is a view, `a.T.reshape(12)` is a copy.
  **The diagnostic trick worth teaching:** in-place `a.shape = (...)` never copies — it raises `AttributeError: Incompatible shape for in-place modification. Use .reshape() to make a copy with the desired shape.` So assigning to `.shape` *tells you* whether a reshape would have copied.
- Passing a non-contiguous / misaligned / byteswapped array to any routine demanding single-segment memory — BLAS, and most C entry points using `PyArray_FromAny(..., NPY_ARRAY_CARRAY)`.

### The flags, with their real bit values

```c
#define NPY_ARRAY_C_CONTIGUOUS    0x0001
#define NPY_ARRAY_F_CONTIGUOUS    0x0002
#define NPY_ARRAY_OWNDATA         0x0004
#define NPY_ARRAY_FORCECAST       0x0010
#define NPY_ARRAY_ENSURECOPY      0x0020
#define NPY_ARRAY_ENSUREARRAY     0x0040
#define NPY_ARRAY_ELEMENTSTRIDES  0x0080
#define NPY_ARRAY_ALIGNED         0x0100
#define NPY_ARRAY_NOTSWAPPED      0x0200
#define NPY_ARRAY_WRITEABLE       0x0400
#define NPY_ARRAY_WRITEBACKIFCOPY 0x2000
#define NPY_ARRAY_ENSURENOCOPY    0x4000

#define NPY_ARRAY_BEHAVED    (NPY_ARRAY_ALIGNED | NPY_ARRAY_WRITEABLE)
#define NPY_ARRAY_CARRAY     (NPY_ARRAY_C_CONTIGUOUS | NPY_ARRAY_BEHAVED)
#define NPY_ARRAY_FARRAY     (NPY_ARRAY_F_CONTIGUOUS | NPY_ARRAY_BEHAVED)
#define NPY_ARRAY_DEFAULT     NPY_ARRAY_CARRAY
```

(The gaps at `0x0800`/`0x1000` are `NPY_ARRAY_UPDATEIFCOPY`, removed in 1.23.)

Python-visible meanings: `C_CONTIGUOUS`, `F_CONTIGUOUS`, `OWNDATA` ("the array owns the memory it uses or borrows it from another object"), `WRITEABLE`, `ALIGNED`, `WRITEBACKIFCOPY` (a copy whose contents must be flushed back to `base` before dealloc, via `PyArray_ResolveWritebackIfCopy`). Plus derived pseudo-flags: `FNC` (F and not C), `FORC` (F or C — the one-segment test), `BEHAVED`, `CARRAY`, `FARRAY`.

**Only three are user-settable:** `WRITEBACKIFCOPY` (only to `False`), `WRITEABLE` (only to `True` if the array owns its memory or the ultimate owner exposes a writeable buffer), and `ALIGNED` (only to `True` if the data really is aligned). A view inherits `WRITEABLE` at creation but can be locked afterwards independently of its base.

### The contiguity quirk everyone gets wrong

`_UpdateContiguousFlags()` in `numpy/_core/src/multiarray/flagsobject.c`. The header comment states the rule: *"When a dimension has length 1, its stride is never used and thus has no effect on the memory layout. The above rules thus only apply when ignoring all size 1 dimensions."*

```c
    npy_intp sd = PyArray_ITEMSIZE(ap);
    npy_bool is_c_contig = 1;
    for (int i = PyArray_NDIM(ap) - 1; i >= 0; --i) {
        npy_intp dim = PyArray_DIMS(ap)[i];
        if (dim == 0) {                       /* contiguous by definition */
            PyArray_ENABLEFLAGS(ap, NPY_ARRAY_C_CONTIGUOUS);
            PyArray_ENABLEFLAGS(ap, NPY_ARRAY_F_CONTIGUOUS);
            return;
        }
        if (dim != 1) {                       /* size-1 axes are SKIPPED */
            if (PyArray_STRIDES(ap)[i] != sd) { is_c_contig = 0; }
            sd *= dim;
        }
    }
```

Four consequences, all of which bite in practice:

1. **Any array with a zero-length dimension is both C- and F-contiguous** — early return.
2. **0-d arrays are both** — the loop body never runs.
3. **Every ordinary 1-D array with `stride == itemsize` is both.** So `a.flags.f_contiguous` is `True` for a vector, and you cannot infer "this is C-order" from the F bit. Use `FNC` if you mean "genuinely Fortran and not C".
4. **Size-1 axes are ignored entirely**, so `np.zeros((5,1)).T` is still both.

Corollary the docs state explicitly and every stride-manipulating program must respect: **for a contiguous array, `strides[k]` is arbitrary whenever `shape[k] == 1` or the array is empty.** Never assert on such a stride. Flags are recomputed by `PyArray_UpdateFlags(arr, NPY_ARRAY_UPDATE_ALL)` after manual stride surgery.

## 1.4 The buffer protocol (PEP 3118)

```c
typedef struct bufferinfo {
     void *buf;                 /* the memory                                */
     Py_ssize_t len;            /* total bytes                               */
     int readonly;
     const char *format;        /* struct-syntax string; NULL ⇒ unsigned bytes */
     int ndim;
     Py_ssize_t *shape;
     Py_ssize_t *strides;       /* BYTES, same semantics as NumPy            */
     Py_ssize_t *suboffsets;    /* pointer indirection; negative ⇒ none      */
     Py_ssize_t itemsize;
     void *internal;            /* exporter-private lifetime bookkeeping     */
} Py_buffer;

typedef int  (*getbufferproc)(PyObject *obj, Py_buffer *view, int flags);
typedef void (*releasebufferproc)(PyObject *obj, Py_buffer *view);
int  PyObject_GetBuffer(PyObject *obj, Py_buffer *view, int flags);
void PyBuffer_Release(Py_buffer *view);
```

**The flags are a contract, not a hint.** The consumer declares what shapes of memory it can handle, and the exporter must either satisfy it or raise `BufferError`:

| Flag | = | Consumer is saying |
|---|---|---|
| `PyBUF_SIMPLE` | 0 | flat C-contiguous byte block, format assumed `'B'` |
| `PyBUF_WRITABLE` | | must be writable |
| `PyBUF_FORMAT` | | I need real dtype info |
| `PyBUF_ND` | | give me `shape`; C-contiguity assumed |
| `PyBUF_STRIDES` | ⊃ND | I can handle arbitrary strides |
| `PyBUF_C_CONTIGUOUS` / `PyBUF_F_CONTIGUOUS` / `PyBUF_ANY_CONTIGUOUS` | ⊃STRIDES | |
| `PyBUF_INDIRECT` | ⊃STRIDES | I can chase `suboffsets` |
| `PyBUF_RECORDS` | STRIDES\|WRITABLE\|FORMAT | |
| `PyBUF_FULL` / `PyBUF_FULL_RO` | INDIRECT\|FORMAT(\|WRITABLE) | anything |

**The important asymmetry:** a consumer that requests `PyBUF_SIMPLE` on a non-contiguous NumPy view gets a `BufferError`, *not a silent copy*. That refusal is the protocol working — it will not lie about layout. Building an exporter and getting that refusal right is the best possible exercise on the topic.

`suboffsets` is the odd one: negative means "no dereference needed". It exists to describe PIL-style pointer-to-pointer image buffers. NumPy always exports `suboffsets == NULL`.

Format strings extend `struct` syntax with `t` (bit), `?` (`_Bool`), `g` (long double), `c`/`u`/`w` (UCS-1/2/4), `O` (PyObject*), `Z` (complex, e.g. `Zd`), `&` (pointer to), `T{...}` (struct), `(k1,k2)` (sub-array), `:name:` (field name), `X{}` (function pointer).

**Why it is the lingua franca.** `Py_buffer` is `(pointer, itemsize, ndim, shape[], strides[])` — i.e. *exactly the `PyArrayObject` data model minus the dtype object*. The translation is total and mechanical in both directions, so `np.asarray(obj)` on any exporter wraps the pointer with `base = obj` and `OWNDATA` clear, and `np.asarray(PIL.Image.open(...))` transfers a pointer, not pixels. `bytes`, `array.array`, `mmap`, `ctypes` arrays, PIL, Arrow all speak it.

**Where it runs out:** PEP 3118 format strings cannot express everything a `PyArray_Descr` can (datetime units, object arrays, some alignment cases), so those exports fail. And it is **CPU-only** — which is precisely the gap DLPack fills (§4).

## 1.5 Where the compute actually happens

### ufuncs — the one signature that explains everything

```c
void loopfunc(char **args, npy_intp const *dimensions,
              npy_intp const *steps, void *data);
/* typedef'd as PyUFuncGenericFunction */
```

- `args` — `nin + nout` data pointers, inputs first
- `dimensions[0]` — the inner loop length `n`
- `steps` — `nin + nout` **byte** strides, one per operand
- `data` — arbitrary payload stored with the ufunc

The documented reference implementation:

```c
static void
double_add(char **args, npy_intp const *dimensions,
           npy_intp const *steps, void *extra)
{
    npy_intp i;
    npy_intp is1 = steps[0], is2 = steps[1];
    npy_intp os = steps[2], n = dimensions[0];
    char *i1 = args[0], *i2 = args[1], *op = args[2];
    for (i = 0; i < n; i++) {
        *((double *)op) = *((double *)i1) + *((double *)i2);
        i1 += is1; i2 += is2; op += os;
    }
}
```

**Everything about NumPy's performance follows from this signature.** Two observations:

1. **The inner loop is stride-aware.** `steps` is per-operand and in bytes, so the loop works directly on views, on broadcast operands (`step == 0`), and on reversed operands (`step < 0`), with no copy. The generic strided form above is the fallback; the fast paths detect `is1 == is2 == os == sizeof(double)` and hand that case to SIMD.
2. **It is called once per contiguous chunk, with `n` in the thousands.** All the Python-side cost — argument parsing, `__array_ufunc__` checks, type resolution, broadcasting setup, output allocation — is amortised over that `n`. That is the *entire* mechanism by which NumPy "is fast": it is not that the C is fast, it is that you pay the Python tax once per array instead of once per element.

Loop selection: `PyUFuncObject` holds `functions[]` (the loops), `data[]`, and `types[]` sized `nargs × ntypes`. Selection is a **linear scan over the `ntypes` rows** for the first row whose input types the actual inputs can safely cast to. `np.add.types` (`'ll->l'`, `'dd->d'`, …) and `np.add.ntypes` expose exactly this table — a two-line demo that de-mystifies dtype promotion.

Type resolution proper lives in `numpy/_core/src/umath/dispatching.cpp` (the NEP 42/43 ArrayMethod/promoter machinery), with the legacy `PyUFunc_DefaultTypeResolver` in `ufunc_type_resolution.c`. User-facing knobs: `signature=`, `dtype=`, and `casting=` (`'no'`, `'equiv'`, `'safe'`, `'same_kind'` (default for output), `'unsafe'`). **NumPy 2.0 changed promotion materially (NEP 50: value-based casting for Python scalars is gone)** — pin the version in any teaching material.

Buffer size: `NPY_BUFSIZE` is **8192** elements (`ndarraytypes.h`), runtime-settable via `np.setbufsize()`. Deliberately sized to sit in L1/L2. This is the buffer used when the iterator must cast, align, or byteswap.

**`__array_ufunc__` (NEP 13)** is the override hook: `def __array_ufunc__(self, ufunc, method, *inputs, **kwargs)` where `method ∈ {"__call__", "reduce", "accumulate", "reduceat", "outer", "at"}`. Rules: subclasses before superclasses, inputs before outputs, outputs before `where`, then left to right; first non-`NotImplemented` return wins; all `NotImplemented` ⇒ `TypeError`; setting it to `None` makes every ufunc touching that operand raise. This is how Dask, CuPy, JAX, pint and `np.ma` intercept `a + b` **without subclassing `ndarray`** — and it is the direct conceptual ancestor of PyTorch's `__torch_function__`/`__torch_dispatch__`. Worth drawing that line explicitly.

### The iterator — where loop optimisation happens at runtime

`NpyIter` (`numpy/_core/src/multiarray/nditer_constr.c`, `nditer_api.c`). Constructors `NpyIter_New`, `NpyIter_MultiNew`, `NpyIter_AdvancedNew`. The flags that matter:

| Flag | Effect |
|---|---|
| `NPY_ITER_EXTERNAL_LOOP` | **skip the innermost loop — hand it to the caller.** This is how ufuncs get their `n`. |
| `NPY_ITER_BUFFERED` | buffer to satisfy dtype / alignment / byte-order requirements |
| `NPY_ITER_GROWINNER` | let the inner loop grow when buffering isn't actually needed |
| `NPY_ITER_REDUCE_OK` | permit writeable operands with stride 0 and size > 1 (reduction mode) |
| `NPY_ITER_DELAY_BUFALLOC` | delay buffer allocation to `Reset()`; for threading and reductions |
| `NPY_ITER_MULTI_INDEX` | track the full multi-index — **and thereby disable coalescing** |

The two optimisations, in the docs' own words:

- *"Coalesces axes to produce bigger inner loops for efficiency"* — adjacent axes whose strides multiply out consistently are merged. A C-contiguous `(100,100,100)` array iterates as **one 10⁶-element inner loop**, not 10⁴ loops of 100.
- *"Reorders axes when using `NPY_KEEPORDER` to reverse those with negative strides, traversing memory forward"* — so `a[::-1] + b[::-1]` walks memory in the prefetcher-friendly direction and the loop sees positive strides.

Axes are additionally sorted by stride magnitude so the innermost loop is the smallest-stride one, **regardless of how the user wrote the indices**. That is *automatic loop interchange, performed at runtime by a library* — the exact transformation that is "version 4" in the MIT table below. Point this out; it reframes `nditer` from "an iteration utility" into "a tiny optimising compiler for memory access order".

The canonical `EXTERNAL_LOOP` consumption pattern is the shape every ufunc inner loop is invoked from:

```c
NpyIter_IterNextFunc *iternext = NpyIter_GetIterNext(iter, NULL);
char **dataptr     = NpyIter_GetDataPtrArray(iter);
npy_intp *stride   = NpyIter_GetInnerStrideArray(iter);
npy_intp *size_ptr = NpyIter_GetInnerLoopSizePtr(iter), size;
do {
    size = *size_ptr;
    while (size--) {
        /* work at dataptr[0..nop-1] */
        for (iop = 0; iop < nop; ++iop) dataptr[iop] += stride[iop];
    }
} while (iternext(iter));
```

`dataptr` and `stride` are stable *addresses* whose contents change per `iternext`; `size_ptr` must be re-dereferenced each outer iteration.

### SIMD — NumPy's universal-intrinsics (NPYV) framework

Three layers (NEP 38):

1. **Write once** in `npyv_*` universal intrinsics, which map onto SSE/AVX2/AVX-512, NEON/ASIMD/SVE, VSX2/VSX3, VX/VXE (s390x), RVV, LSX. Sources: `numpy/_core/src/common/simd/{sse,avx2,avx512,neon,vec,lsx}/`.
2. **Compile many kernels** — a *baseline* every binary must have (`--cpu-baseline`) plus *dispatched* variants (`--cpu-dispatch`).
3. **Select at runtime** — the CPU is probed at import; a generated `if/else if` chain over cached feature bits picks the highest-interest available kernel. Note: **function-pointer-free**, so the branch predictor pins it after the first call.

The dispatch sources are in `numpy/_core/src/umath/*.dispatch.c.src` — `loops_arithm_fp`, `loops_arithmetic`, `loops_comparison`, `loops_exponent_log`, `loops_trigonometric`, `loops_hyperbolic`, `loops_minmax`, `loops_unary_fp`, and friends. `.src` is NumPy's own template preprocessor (`/**begin repeat … @TYPE@ … /**end repeat**/`), which expands per-dtype *before* the C compiler runs. So one `.src` file becomes float × double × {SSE, AVX2, AVX-512} kernels.

Codegen shape: for each target the build emits a wrapper TU that `#define`s `NPY__CPU_TARGET_CURRENT` plus every implied lower feature and `#include`s the real source; symbols are mangled per target (`simd_whoami`, `simd_whoami_AVX512F`, `simd_whoami_SSE41`) via `NPY_CPU_DISPATCH_CURFX`; and a generated `*.dispatch.h` defines `NPY__CPU_DISPATCH_CALL(CHK, CB, ...)` expanding to the ordered feature-check chain.

> **Doc staleness to flag.** The `simd/how-it-works` page still documents the *distutils* `/*@targets baseline sse42 avx512f */` comment syntax. Since NumPy 1.26 the build is **Meson**, and dispatch targets are declared in `numpy/_core/meson.build` via `mod_features.multi_targets(...)`. The generated headers and the `NPY_CPU_DISPATCH_*` macros are unchanged; only the *declaration site* moved.

**Inspection — this is the good classroom material:**

```python
np.show_config()                       # Build Dependencies / blas / lapack / SIMD Extensions
np.show_config(mode='dicts')           # programmatic
from numpy._core._multiarray_umath import __cpu_features__, __cpu_baseline__, __cpu_dispatch__
```

`__cpu_features__` is a `dict[str, bool]` from the runtime probe; `__cpu_baseline__`/`__cpu_dispatch__` are lists of strings. Use them to *prove* to a student that their wheel really contains AVX-512 kernels. Then:

```bash
NPY_DISABLE_CPU_FEATURES="AVX512F,AVX512CD" python bench.py
```

**Same binary, same array, different ISA level.** This is the single best demo in the whole unit — it isolates the SIMD contribution from everything else with no recompilation. (`NPY_ENABLE_CPU_FEATURES` is the allowlist counterpart. NumPy validates at import that the CPU has every *baseline* feature and raises if not.)

**What is vendored (from `.gitmodules`), and the honest 2.x story:**

- **SVML** (Intel Short Vector Math Library) — prebuilt **AVX-512 assembly objects** at `src/umath/svml/linux/avx512/svml_z0_*.s`. **Linux + x86-64 + AVX-512 only, transcendentals only.** The build comment notes an accuracy caveat versus the universal-intrinsic path — worth teaching, because "faster `exp`" is not free.
- **Highway** (Google's portable SIMD) — currently used for **sorting**, not ufuncs: `src/npysort/highway_qsort*.dispatch.cpp`.
- **x86-simd-sort** (Intel) — `src/npysort/x86_simd_qsort.dispatch.cpp`, targets `AVX512_SPR, AVX512_ICL`. **This is why `np.sort` on an AVX-512 machine beats `std::sort` several times over** — it is a vectorised bitonic/quick sort, not a comparison-per-element loop.
- **pocketfft** for FFT.

So: *NPYV for elementwise ufuncs; SVML for AVX-512 transcendentals on Linux/x86; Highway and x86-simd-sort for sorting; pocketfft for FFT.*

### NumPy does not auto-parallelise

State this explicitly to a CUDA-literate audience: **ufuncs are single-threaded.** `np.exp(a)` on a 10⁸-element array uses one core. The only multithreading in NumPy comes from the BLAS library and from x86-simd-sort's optional OpenMP path. This is less costly than students expect — elementwise work is bandwidth-bound and one core can get close to saturating a memory channel — but it must not be a surprise.

## 1.6 The handoff to BLAS/LAPACK

### The levels, and why level 3 is the only one that can be fast

| Level | Example | FLOPs | Words touched | Intensity (flops/word) |
|---|---|---|---|---|
| 1 vector–vector | `axpy`, `dot` | 2n | 3n | ~2/3 — **constant** |
| 2 matrix–vector | `gemv` | 2n² | ≈n² | ~2 — **constant** |
| 3 matrix–matrix | `gemm` | 2n³ | 3n² | **~2n/3 — grows with n** |

In flops per *byte* for fp64, divide by 8: BLAS-1 ≈ 0.083, BLAS-2 ≈ 0.25, BLAS-3 ≈ n/12.

This is a roofline argument identical to the one you would make for a CUDA kernel. A modern core does ~2 FMA/cycle × 8 fp64 lanes (AVX-512) = 32 flops/cycle while sustaining perhaps 1–2 bytes/cycle from DRAM per core, so **machine balance is on the order of 20–50 flops/byte.** Levels 1 and 2 sit two orders of magnitude below the ridge point — they are memory-bound and will run at a few percent of FLOP peak *no matter how good the code is*. Level 3 crosses the ridge once n is a few hundred, and can then be blocked so each loaded tile is reused Θ(n_block) times, reaching 80–95 % of peak.

**The corollary students must internalise:** `A @ B` is the *only* NumPy operation that can approach peak FLOPS. `a + b`, `np.exp(a)`, `a.sum()` are all bandwidth-bound; vectorising them harder changes nothing once DRAM is saturated. **Fusing** them (Numba, `numexpr`, JAX, Inductor) helps because it removes memory traffic, not because it removes instructions. That sentence is the bridge from this unit to §2.5.

### When NumPy actually calls BLAS

`numpy/_core/src/umath/matmul.c.src`. `matmul` is a **gufunc** with signature `(m?,n),(n,p?)->(m?,p?)`, so it broadcasts over batch dimensions and the inner loop sees one 2-D × 2-D problem at a time. The eligibility test, verbatim:

```c
/*
 * Determine if a 2d matrix can be used by BLAS
 * 1. Strides must not alias or overlap
 * 2. The faster (second) axis must be contiguous
 * 3. The slower (first) axis stride, in unit steps, must be larger than
 *    the faster axis dimension
 */
static inline npy_bool
is_blasable2d(npy_intp byte_stride1, npy_intp byte_stride2,
              npy_intp d1, npy_intp d2, npy_intp itemsize)
{
    npy_intp unit_stride1 = byte_stride1 / itemsize;
    if (byte_stride2 != itemsize) {
        return NPY_FALSE;
    }
    if ((byte_stride1 % itemsize == 0) &&
        (unit_stride1 >= d2) &&
        (unit_stride1 <= BLAS_MAXSIZE))
    {
        return NPY_TRUE;
    }
    return NPY_FALSE;
}
```

Ten lines that answer the whole question:

1. `byte_stride2 != itemsize` → **the fast axis must be exactly contiguous.** `A[:, ::2] @ B` fails here.
2. `byte_stride1 % itemsize != 0` → **the slow stride must be a whole number of elements**, because it becomes `lda`. A view into a record array fails here.
3. `unit_stride1 < d2` → **rows must not overlap.** This catches stride-0 broadcast axes and `as_strided` sliding windows.
4. `unit_stride1 > BLAS_MAXSIZE` → `lda` must fit the BLAS integer type (`NPY_MAX_INT - 1` for LP64, `NPY_MAX_INT64 - 1` for ILP64).

It is checked **both orientations**, so a transposed view is blasable and gets a `CblasTrans` flag instead of a copy.

The dispatch table that results:

| Condition | Result |
|---|---|
| dtype ∉ {float32, float64, complex64, complex128} | **never BLAS.** int64 matmul is a plain C loop. |
| built with `-Dallow-noblas=true` and no BLAS found | naive loop everywhere |
| any dim 0, or any dim > `BLAS_MAXSIZE` | naive loop |
| `dm==1 && dp==1` (row · column) | `?dot` — level 1 |
| `dn==1` with `dm==1` or `dp==1` | naive loop (source comment: *"could use cblas_Xaxy, but that requires 0ing output and would not be faster (XXX prove it)"*) |
| `dp==1` or `dm==1`, other operand blasable | `?gemv` — level 2 |
| column @ row (outer product) | naive loop |
| general m,n,p, all blasable | **`?gemm`, no copy** |
| general m,n,p, some operand not blasable | one `PyMem_RawMalloc`, `matrix_copy` to pack it, then `?gemm` (fix for gh-12365 / gh-23588) |

**There is no small-size cutoff.** A `(2,2) @ (2,2)` float64 product still goes through `cblas_dgemm`, and the per-call overhead (microseconds) dominates. That is precisely why batching — `(N,2,2) @ (N,2,2)` as one gufunc call — still beats a Python loop, and why `numpy.linalg`'s stacked-matrix operations exist.

`np.dot` takes a *different*, stricter path: `cblas_matrixproduct()` in `numpy/_core/src/common/cblasfuncs.c`, gated by `_bad_strides()`, which rejects misaligned data, **negative strides**, ragged strides, and stride-0 axes — and on failure **eagerly `PyArray_NewCopy`s**. So `np.dot(a[::-1], b)` copies while `a[::-1] @ b` may not. Two entry points to the same math with different copy policies; a good exercise.

`cblasfuncs.c` also contains an optimisation students recognise: *"Use syrk if we have a case of a matrix times its transpose"* — `A @ A.T` is detected by pointer identity and dispatched to `?syrk`, which does half the FLOPs.

Long level-1 loops are issued in `NPY_CBLAS_CHUNK`-sized pieces (`CBLAS_INT_MAX/2 + 1` for 32-bit `CBLAS_INT`) so `n` never overflows the BLAS integer type.

### OpenBLAS vs MKL vs Accelerate

Build selection (Meson): `-Dblas=` / `-Dlapack=` accepting `openblas`, `mkl`, `accelerate`, `atlas`, `blis`, `blas`/`lapack` (Netlib), `scipy-openblas`. Default probe order is roughly **MKL, Accelerate, OpenBLAS, FlexiBLAS, BLIS, plain libblas/liblapack** (docs note this "may vary per platform or over releases"). `-Duse-ilp64=true` selects 64-bit-integer BLAS; LP64 is the default.

**Apple Accelerate**, from the NumPy 1.26.0 release notes, verbatim:

> "Support for the updated Accelerate BLAS/LAPACK library, including ILP64 (64-bit integer) support, in macOS 13.3 has been added. This brings arm64 support, and significant performance improvements of up to 10x for commonly used linear algebra operations. When Accelerate is selected at build time, the 13.3+ version will automatically be used if available."

Background: the old Accelerate was LAPACK-3.2.1-era and buggy, and NumPy dropped support for years. macOS 13.3 shipped a rewritten one (LAPACK 3.9.1, AMX-backed) and NumPy 1.26 re-enabled it. Same release switched NumPy's build system to Meson.

**What the official wheels actually contain**, from `pyproject.toml`:

```toml
# The build will use openblas64 everywhere, except on arm64 macOS >=14.0 (uses Accelerate)
[tool.cibuildwheel.config-settings]
setup-args = ["-Duse-ilp64=true", "-Dallow-noblas=false"]
```

So `pip install numpy` gives you **ILP64 OpenBLAS everywhere except Apple Silicon on macOS ≥ 14, where it gives Accelerate and no vendored OpenBLAS at all.** MKL is never in the PyPI wheel; you get it from conda-forge or Intel's channel. `scipy-openblas32`/`scipy-openblas64` are PyPI packages shipping a prebuilt OpenBLAS plus a pkg-config file, used by NumPy's own dev workflow.

**How to find out at runtime:**

```python
np.show_config()                                # human-readable
cfg = np.show_config(mode='dicts')
cfg['Build Dependencies']['blas']               # {'name': 'openblas64', 'version': '0.3.34', ...}

import threadpoolctl
threadpoolctl.threadpool_info()                 # the reliable cross-library answer:
                                                # actual .so path, internal API, version, threads
```

`ldd`/`otool -L` on `numpy._core._multiarray_umath` shows the real linkage. Thread control differs per library: `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS`, `VECLIB_MAXIMUM_THREADS` (Accelerate), with `OMP_NUM_THREADS` as a fallback. Setting these to 1 is how you isolate single-core GFLOPS in a benchmark — mandatory for any measurement exercise.

## 1.7 Quantified: why `A @ B` beats a Python loop

### The MIT 6.172 table, verified

Source: MIT 6.172 *Performance Engineering of Software Systems*, Fall 2018, **Lecture 1, slide 67 ("Version 11: Final Reckoning")**. Problem: **4096 × 4096 double-precision matrix multiply** (2·4096³ ≈ 1.374 × 10¹¹ flops).

| # | Implementation | Time (s) | Rel. | Abs. | GFLOPS | % peak |
|---|---|---:|---:|---:|---:|---:|
| 1 | Python | 21,041.67 | 1.00 | 1 | 0.006 | 0.001 |
| 2 | Java | 2,387.32 | 8.81 | 9 | 0.058 | 0.007 |
| 3 | C | 1,155.77 | 2.07 | 18 | 0.118 | 0.014 |
| 4 | + interchange loops | 177.68 | 6.50 | 118 | 0.774 | 0.093 |
| 5 | + optimization flags | 54.63 | 3.25 | 385 | 2.516 | 0.301 |
| 6 | Parallel loops | 3.04 | 17.97 | 6,921 | 45.211 | 5.408 |
| 7 | + tiling | 1.79 | 1.70 | 11,772 | 76.782 | 9.184 |
| 8 | Parallel divide-and-conquer | 1.30 | 1.38 | 16,197 | 105.722 | 12.646 |
| 9 | + compiler vectorization | 0.70 | 1.87 | 30,272 | 196.341 | 23.486 |
| 10 | + AVX intrinsics | 0.39 | 1.76 | **53,292** | 352.408 | 41.677 |
| 11 | **Intel MKL** | 0.41 | 0.97 | 51,497 | 335.217 | 40.098 |

Machine (slide 20): Haswell Xeon E5-2666 v3, 2.9 GHz, 2 chips × 9 cores, 2-way SMT, 8 fp64 ops/core/cycle incl. FMA, 64 B lines, 32 KB L1d, 256 KB L2, 25 MB L3, 60 GB DRAM. Peak = 2.9e9 × 2 × 9 × 16 = **836 GFLOPS**.

The slide's own closer: *"Version 10 is competitive with Intel's professionally engineered Math Kernel Library!"*

Three corrections to the version of this table that circulates second-hand:

- The famous "~50,000×" is **53,292×**, and it lands on version 10 (AVX intrinsics), not on a separate "parallel + vectorize" row.
- The Python row is **21,041.67 s ≈ 5.8 hours at 0.006 GFLOPS**, not the 25,552.48 s / 0.005 GFLOPS figure from Leiserson et al., *"There's plenty of room at the Top"* (Science, 2020) Table 1 — that paper reruns the experiment on different hardware. **Do not mix numbers from the two sources.** (The Science paper is paywalled and its exact row values are *unverified* here.)
- Slide 20's peak formula renders as `(2.9 ! 10^9) ! 2 ! 9 ! 16` in the PDF text layer; the `!` is a mangled `×`. The 16 is 8 flops × 2 for FMA.

**The single most useful pedagogical fact in this table: Python → C is only 18×. The other ~3,000× is memory hierarchy, parallelism and vectorization** — the same three levers already familiar from CUDA (coalescing/shared memory, occupancy, warp width). Language choice is the *smallest* term. Anyone who concludes "the fix is to rewrite it in C" has read the first three rows and stopped.

### Where NumPy sits on that ladder

NumPy is **not** "version 3 (C)". For `A @ B` on float64 with blasable strides, NumPy **is version 11** — it calls the same class of blocked, threaded, AVX-512 `dgemm`. The 40 %-of-peak row *is* what `np.dot` gets you. Every intermediate row is work OpenBLAS/MKL/Accelerate already did:

| MIT version | NumPy equivalent |
|---|---|
| 4, interchange loops | the nditer's automatic axis reordering; BLAS's internal packing |
| 5, optimization flags | the wheel is built with max opt |
| 6, parallel loops | OpenBLAS threading (`OPENBLAS_NUM_THREADS`) |
| 7, tiling | BLAS's blocked GEMM (L1/L2/L3 tiles) |
| 9–10, vectorization / AVX | OpenBLAS per-microarchitecture assembly; NPYV on the ufunc side |

For `a + b` — a ufunc, not BLAS — NumPy is roughly version 5–9: one vectorised single-threaded pass, **bandwidth-bound**, sitting at low single-digit percent of FLOP peak no matter what. That is correct behaviour, not a defect; it is the roofline.

### The interpreter-overhead half

*(Estimate — flagged as not verified from a primary source.)* A CPython bytecode dispatch is on the order of **tens of nanoseconds**; a `BINARY_OP` on two Python floats costs a dispatch, two type checks, an unbox, the add, and a `PyFloat` allocation, so **~50–100 ns per elementary Python-level arithmetic operation** is the standard rule of thumb. It is consistent with the table: version 1 does 1.374 × 10¹¹ flops in 21,042 s ⇒ **153 ns per flop**, and the triple loop also does index arithmetic and list indexing per flop. (CPython 3.11+'s specialising adaptive interpreter cuts this meaningfully; 3.13's JIT more so — so this number *dates*.)

Against that, a single FMA on the same Haswell core: 16 flops/cycle at 2.9 GHz ⇒ **~0.06 ns per useful flop** at peak. **Ratio ≈ 1,000–2,500× per operation from the interpreter alone**, before any parallelism. The remainder of the 53,292× is memory hierarchy (~7× from interchange + tiling) and cores (~18×).

The three-line version for a lecture:

> A Python `for` loop pays ~50–100 ns of interpreter tax **per scalar operation**. A NumPy ufunc pays that tax **once per array** and then runs a C loop at roughly one element per cycle. `A @ B` goes further: it hands the whole problem to a blocked, threaded, AVX-512 GEMM that reuses each cache line Θ(block) times and reaches 40 % of the machine's floating-point peak. Same math, five orders of magnitude.

### Ballpark fp64 GFLOPS on a modern core

*(Model-derived estimates, flagged as unmeasured. Have the class measure their own — that is the exercise.)*

| Workload | fp64 GFLOPS | Bound by |
|---|---:|---|
| Pure-Python triple loop | ~0.005–0.01 | interpreter |
| NumPy elementwise, out of cache | ~0.5–2 effective | DRAM bandwidth |
| NumPy elementwise, in L2 | ~5–20 | SIMD width |
| OpenBLAS `dgemm`, 1 core, AVX-512 | ~50–100 | near FLOP peak |
| OpenBLAS `dgemm`, 8–16 cores | ~400–1,500 | FLOP peak / power |

Roughly 2× for fp32. The measurement recipe: `2*n**3 / time`, with `OPENBLAS_NUM_THREADS=1`, `threadpoolctl.threadpool_info()` to confirm what is loaded, and `NPY_DISABLE_CPU_FEATURES` to toggle ISA levels on the same binary.
# 2. PyTorch internals — the main event

## 2.1 The layered architecture

Verified against `pytorch/pytorch` `main`, `CONTRIBUTING.md` §"Codebase structure".

```
                     ┌─────────────────────────────────────────────┐
  Python             │ torch/*.py, torch/nn/, torch/optim/         │  pure Python
                     │ Tensor.__add__ → torch._C._TensorBase.add   │
                     └────────────────────┬────────────────────────┘
                                          │ CPython C-API + pybind11
                     ┌────────────────────▼────────────────────────┐
  Bindings           │ torch/csrc/   (everything named python_*)   │  C++, knows Python
                     │ THPVariable, python_arg_parser,             │
                     │ generated python_torch_functions.cpp        │
                     └────────────────────┬────────────────────────┘
                                          │ at::add(self, other, alpha)
                     ┌────────────────────▼────────────────────────┐
  Dispatcher         │ aten/src/ATen/core/dispatch/                │  the routing layer
                     │ Dispatcher.h/.cpp, OperatorEntry,           │
                     │ DispatchKeyExtractor                        │
                     └───┬──────────┬──────────┬──────────┬────────┘
                         │          │          │          │  (one hop per key)
              Autocast ──┘  Autograd┘ ADInplace┘  Backend ┘
                     ┌────────────────────▼────────────────────────┐
  ATen kernels       │ aten/src/ATen/native/     (CPU, generic)    │  the actual math
                     │ aten/src/ATen/native/cpu/ (AVX-compiled)    │
                     │ aten/src/ATen/native/cuda/(.cu kernels)     │
                     │ aten/src/ATen/native/{cudnn,mkl,mkldnn}/    │
                     └────────────────────┬────────────────────────┘
                     ┌────────────────────▼────────────────────────┐
  c10 core           │ c10/core/{TensorImpl,StorageImpl,Allocator, │  no autograd,
                     │   DispatchKey,DispatchKeySet,Device,Scalar} │  no Python,
                     │ c10/cuda/CUDACachingAllocator               │  mobile-safe
                     └─────────────────────────────────────────────┘
```

Directory semantics, verbatim from `CONTRIBUTING.md`:

| Dir | What it is |
|---|---|
| `c10/` | "Core library files that work everywhere, both server and mobile… intended only to contain essential functionality, and appropriate to use in settings where binary size matters." This is where `TensorImpl` and `StorageImpl` live. `c10` is a pun on "Caffe 10" (Caffe2 + ATen). |
| `aten/src/ATen/` | "C++ tensor library for PyTorch (**no autograd support**)." `ATen` = "A TENsor library". `native/` is "Modern implementations of operators. If you want to write a new operator, here is where it should go." |
| `aten/src/ATen/native/cpu/` | "**Not actually CPU implementations** of operators, but specifically implementations which are compiled with processor-specific instructions, like AVX." Each `.cpp` here is compiled 3–4× at different ISA levels and selected at runtime. |
| `torch/csrc/` | "C++ files composing the PyTorch library… a mix of Python binding code (conventionally prefixed with `python_`) and C++ heavy lifting." Autograd engine lives here (`torch/csrc/autograd/`), **not** in ATen. |
| `torchgen/` | "the logic and tooling for generating PyTorch's low-level C++ and Python bindings from operator definitions, typically specified in `native_functions.yaml`". |

**The layering rule worth memorising:** ATen does not know about autograd; autograd does not know about Python; c10 does not know about either. Each layer is added by *registration at a dispatch key*, not by an `if` in the layer below. That is the whole point of the dispatcher.

### The codegen step (why you can't grep for `at::add`'s body)

`aten/src/ATen/native/native_functions.yaml` (16,245 lines on `main`) is the operator declaration file. The `add.Tensor` entry, verbatim:

```yaml
- func: add.Tensor(Tensor self, Tensor other, *, Scalar alpha=1) -> Tensor
  device_check: NoCheck   # TensorIterator
  structured_delegate: add.out
  variants: function, method
  dispatch:
    SparseCPU, SparseCUDA, SparseMPS, SparseMeta, SparseXPU: add_sparse
    SparseCsrCPU, SparseCsrCUDA, SparseCsrMeta, SparseCsrXPU: add_sparse_csr
    MkldnnCPU: mkldnn_add
    ZeroTensor: add_zerotensor
    NestedTensorCPU, NestedTensorHPU, NestedTensorCUDA, NestedTensorXPU: NestedTensor_add_Tensor
  tags: [core, pointwise]

- func: add.out(Tensor self, Tensor other, *, Scalar alpha=1, Tensor(a!) out) -> Tensor(a!)
  device_check: NoCheck   # TensorIterator
  structured: True
  structured_inherits: TensorIteratorBase
  ufunc_inner_loop:
    Generic: add (AllAndComplex, BFloat16, Half, ComplexHalf)
    ScalarOnly: add (Bool)
  dispatch:
    SparseCPU, SparseMeta: add_out_sparse_cpu
    SparseCUDA: add_out_sparse_cuda
    ...
```

Read this closely, it teaches the whole design:

- The `func:` line is a **schema** in a small DSL (JIT schema language). `Tensor(a!)` means "aliases memory `a` and mutates it" — the alias annotations are what functionalization and autograd view-tracking consume.
- **There is no dispatch entry for `CPU` or `CUDA` on `add.Tensor`.** `structured_delegate: add.out` says: the real implementation is `add.out`; the functional and in-place variants are *generated* wrappers that allocate/reuse an output and call it. This is the "three variants (`abs_out`, `abs_`, `abs`)" rule from ezyang's 2019 talk, now automated.
- `structured: True` + `structured_inherits: TensorIteratorBase` means the shape/dtype/device computation ("meta function") is generated separately from the compute ("impl function"), so the Meta backend (fake tensors, `torch.compile`'s shape propagation) gets a kernel for free.
- `ufunc_inner_loop:` means even the CPU/CUDA compute kernel is generated from one scalar expression — `add` — instantiated over `AllAndComplex, BFloat16, Half, ComplexHalf`, once per SIMD ISA level on CPU and once as a CUDA elementwise kernel.

Backward rules live separately in `tools/autograd/derivatives.yaml`:

```yaml
- name: mul.Tensor(Tensor self, Tensor other) -> Tensor
  self: mul_tensor_backward(grad, other, self.scalar_type())
  other: mul_tensor_backward(grad, self, other.scalar_type())
  result: other_t * self_p + self_t * other_p     # the forward-mode (JVP) rule
```

Codegen turns those two YAML files into (paths are relative to the *build* dir, which is why they are not in the git tree):

```
build/aten/src/ATen/Functions.h            at::add(...)             the unboxed entry point
build/aten/src/ATen/RegisterCPU.cpp        TORCH_LIBRARY_IMPL(aten, CPU, ...)
build/aten/src/ATen/RegisterCUDA.cpp       TORCH_LIBRARY_IMPL(aten, CUDA, ...)
build/aten/src/ATen/RegisterZeroTensor.cpp (named in DispatchKey.h's ZeroTensor comment)
torch/csrc/autograd/generated/VariableType_*.cpp   the Autograd kernels
torch/csrc/autograd/generated/Functions.cpp        class MulBackward0 : public Node
torch/csrc/autograd/generated/python_torch_functions.cpp   the pybind/CPython layer
```

**Teaching consequence:** "where is the code for `torch.add`?" has no single answer, and that is the lesson. The op is a *schema* plus a *set of registrations at dispatch keys*, assembled at static-initialisation time into a table. Nothing in the source tree calls `add_cpu` directly.

---

## 2.2 The dispatcher — read this twice

### The problem it solves

Sources: ezyang, *Let's talk about the PyTorch dispatcher* (blog.ezyang.com, Sept 2020); the *Registering a Dispatched Operator in C++* tutorial (docs.pytorch.org/tutorials/advanced/dispatcher.html); `c10/core/DispatchKey.h`.

Naively, `torch.add(a, b)` needs one implementation. In reality, before any arithmetic happens, PyTorch may need to:

1. cast both inputs to fp16 because you are inside `torch.autocast`,
2. record the operation on the autograd tape so `backward()` works,
3. bump a version counter if the op is in-place, or set up view metadata if it is a view,
4. record it into a JIT trace,
5. add a batch dimension because you are inside `vmap`,
6. intercept it in Python because the tensor is a `__torch_dispatch__` subclass,
7. …then finally, dispatch on *device* (CPU/CUDA/XLA/MPS), on *layout* (dense/sparse-COO/sparse-CSR/MKLDNN/nested), and on *dtype*.

Those are **orthogonal, composable concerns**, contributed by different teams, in different libraries, some of them out-of-tree. ezyang's framing: without an abstraction, "our implementation code would quickly devolve into an unmaintainable mess." Concretely, the naive design is a nested `if` cascade inside every one of ~2,000 operators, which nobody can extend without patching PyTorch.

The dispatcher's answer: **an operator is a row in a table; a concern is a column; a kernel is a cell.** You register a cell without touching any other cell.

### Dispatch keys

`c10/core/DispatchKey.h` defines `enum class DispatchKey : uint16_t`. The header's own classification comment, verbatim:

```
// This enum actually contains several types of keys, which are explained
// in more detail further down:
// (1) non-customizable backends (e.g. FPGA)
// (2) non-customizable functionalities (e.g. Functionalize)
// (3) functionalized that are customizable per backend (e.g. Dense, Sparse,
//     AutogradFunctionality)
// (4) per-backend instances of customizable functionalities (e.g. CPU,
//     SparseCPU, AutogradCPU)
// (5) alias keys (e.g. CompositeImplicitAutograd)
//
// (1), (2) and (3) all get their own dedicated bits in the DispatchKeySet.
// (1), (2) and (4) all get their own dedicated slots in the runtime operator
// table.
```

The functionality keys, **in declaration order** (= increasing bit index = increasing priority), from `main`:

```
Undefined = 0 / CatchAll
Dense                       ← per-backend customizable  (this is where CPU/CUDA kernels land)
FPGA, Vulkan, Metal         ← non-extensible backends
Quantized                   ← per-backend customizable
CustomRNGKeyId
MkldnnCPU
Sparse, SparseCsr, NestedTensor   ← per-backend customizable
BackendSelect
Fake
Python
FuncTorchDynamicLayerBackMode
Functionalize
Conjugate, Negative, ZeroTensor
ADInplaceOrView
AutogradOther, AutogradFunctionality, AutogradNestedTensor
Tracer
AutocastCPU, AutocastMTIA, AutocastMAIA, AutocastXPU, AutocastIPU,
  AutocastHPU, AutocastXLA, AutocastMPS, AutocastCUDA, AutocastPrivateUse1
BatchedNestedTensor, Batched, VmapMode
DeferredInit
PythonTLSSnapshot
TESTING_ONLY_GenericWrapper, TESTING_ONLY_GenericMode
PreDispatch, PythonDispatcher
EndOfFunctionalityKeys
```

Then alias keys, which are *not* runtime keys — they expand at registration time:

```
Autograd                                    → all AutogradXXX backend keys
CompositeImplicitAutograd                   → all backends + all autograd keys
CompositeExplicitAutograd                   → all backends, not autograd
CompositeExplicitAutogradNonFunctional
FuncTorchBatchedDecomposition
CompositeImplicitAutogradNestedTensor
StartOfAliasKeys = Autograd
Autocast = AutocastCUDA                     ← a back-compat alias, worth knowing
```

### The bitset encoding — the clever bit

`DispatchKeySet` is a **single `uint64_t`**. It is split in two:

- **low ~16 bits** = `BackendComponent` bits: `CPUBit, CUDABit, HIPBit, XLABit, MPSBit, IPUBit, XPUBit, HPUBit, VEBit, LazyBit, MTIABit, MAIABit, PrivateUse1/2/3Bit, MetaBit`.
- **high bits** = functionality bits (`Dense`, `Sparse`, `Autograd*`, `Autocast*`, …).

A runtime key like `SparseCUDA` is therefore **not** its own bit. It is the pair (`Sparse` functionality bit, `CUDA` backend bit). The header:

> "When we encounter a functionality bit that is known to be customizable per-backend, then we also look at the lower `BackendComponent` bits and take the highest bit to determine which backend's implementation to use."

Why this matters: without it, `num_functionalities × num_backends` would blow past 64 bits. With it, adding a new backend costs *one* bit and instantly gets `Dense`, `Sparse`, `SparseCsr`, `Quantized`, `NestedTensor` and `Autograd` variants. The runtime operator table is still flattened:

```cpp
num_runtime_entries = num_functionality_keys
                    + (numPerBackendFunctionalityKeys() * (num_backends - 1))
```

with a static assertion that backend bits + functionality bits together fit in 64.

**Priority is bit index.** From the header, verbatim:

```
// In implementation terms, the dispatch key identifies a specific "bit" in a
// DispatchKeySet.  Higher bit indexes get handled by dispatching first (because
// we "count leading zeros" when we extract the highest priority dispatch key.)
```

So "pick the handler" is literally one `lzcnt` instruction on a 64-bit word. That is why `Autocast*` sits above `Autograd*`, which sits above `ADInplaceOrView`, which sits above `Dense` — the *ordering of the enum is the ordering of the layers*, and it is enforced by hardware bit-scan, not by a chain of branches.

### The dispatch formula

This is the one piece of code to memorise. `aten/src/ATen/core/dispatch/DispatchKeyExtractor.h`:

```cpp
inline DispatchKeySet computeDispatchKeySet(
    DispatchKeySet ks,
    DispatchKeySet key_mask) {
  c10::impl::LocalDispatchKeySet local =
      c10::impl::tls_local_dispatch_key_set();
  return (((ks | local.included_) - local.excluded_) & key_mask);
}
```

Four inputs:

| Term | Where it comes from |
|---|---|
| `ks` | Union of `key_set()` over every dispatch-relevant argument. `detail::multi_dispatch_key_set(args...)` walks the args doing `ts = ts \| x.key_set()`. Each `TensorImpl` carries its own `DispatchKeySet key_set_` field. |
| `local.included_` | Thread-local **included** set. Turning on tracing does `IncludeDispatchKeyGuard(Tracer)`. Default is `{BackendSelect, ADInplaceOrView}` (`c10::default_included_set`). |
| `local.excluded_` | Thread-local **excluded** set. "Exclusion wins over inclusion." Default is all the `Autocast*` keys (`c10::default_excluded_set`) — i.e. autocast is *off* by default by being TLS-excluded, not by being absent. |
| `key_mask` | Per-call mask, documented in the source as serving two purposes: skipping operators whose table entry is a **fallthrough**, and implementing **redispatch** by zeroing the key the caller asked to stop at. Note the comment: these "are NOT tracked in the TLS, but must be applied AFTER TLS (since the backend may have been introduced for consideration by the included TLS)". |

Then `.highestPriorityTypeId()` (count-leading-zeros) picks the winner, and `OperatorEntry::lookup(ks)` indexes the operator's `std::array<KernelFunction, num_runtime_entries>`. If the cell is empty, the dispatcher falls back to `Dispatcher::backendFallbackKernels_[key]` — the per-key "whole column" fallback.

Note the TLS-initialisation trick in `c10/core/impl/LocalDispatchKeySet.h`: the POD TLS stores `included_ ^ default_included_set` and `excluded_ ^ default_excluded_set`, because "TLS is defined to be zero-initialized" and the defaults are non-zero. Cute, and exactly the kind of detail that explains why the fast path is a plain `thread_local uint64_t` pair with no lazy init.

### Walking `aten::add` all the way down

Take `c = a + b`, `a` and `b` CUDA fp32 tensors with `requires_grad=True`, inside `torch.autocast("cuda")`.

**0. Python.** `Tensor.__add__` → `torch._C.TensorBase.add`, a CPython method in generated `python_variable_methods.cpp`. `THPVariable` is:

```cpp
struct THPVariable {
  PyObject_HEAD
  at::Tensor cdata;                          // the payload
  PyObject* backward_hooks = nullptr;
  PyObject* post_accumulate_grad_hooks = nullptr;
};
```

`PythonArgParser` parses `*args/**kwargs` against the overloads generated from the schema. Then `pybind11::gil_scoped_release no_gil;` and call `at::add`.

**1. Compute the key set.** `a.key_set()` and `b.key_set()` each contain `{CUDABit, Dense, AutogradFunctionality}` (the autograd bit is on the tensor because `requires_grad=True`). TLS included adds `{BackendSelect, ADInplaceOrView}`. TLS excluded normally removes all `Autocast*`, but `torch.autocast("cuda")` un-excludes `AutocastCUDA`. Union, minus excluded, mask → highest bit is **`AutocastCUDA`**.

**2. Autocast.** Kernel in `aten/src/ATen/autocast_mode.cpp`. Pattern (from the tutorial):

```cpp
c10::impl::ExcludeDispatchKeyGuard no_autocast(c10::DispatchKey::Autocast);
return mymatmul(at::autocast::cached_cast(at::kHalf, self),
                at::autocast::cached_cast(at::kHalf, other));
```

It adds `Autocast` to the TLS **excluded** set (RAII), casts per the op's policy — `matmul`/`conv` to fp16/bf16, `softmax`/`log`/reductions kept fp32, `add` promoted to the widest input type — and re-enters the dispatcher. The `cached_cast` memoises the fp16 copy of each weight for the duration of the autocast region, so a weight used by five layers is cast once.

**3. Autograd.** Now the highest bit is `AutogradFunctionality` ⊕ `CUDABit` → runtime slot `AutogradCUDA`. The kernel is generated into `torch/csrc/autograd/generated/VariableType_*.cpp`. It:

- checks `requires_grad` on the inputs and `GradMode::is_enabled()`,
- constructs an `AddBackward0` node, wires `next_edges_` to the inputs' `grad_fn`/`grad_accumulator`,
- saves whatever the backward formula needs (for `add`, just `alpha`; for `mul`, the *other* operand — which is exactly why `mul` costs memory and `add` doesn't),
- opens `at::AutoDispatchBelowADInplaceOrView guard;` which pushes `{AutogradFunctionality…, ADInplaceOrView}` into the TLS **excluded** set,
- calls `at::redispatch::add(ks & c10::after_autograd_keyset, ...)`,
- attaches `grad_fn` to the output and sets `output_nr_`.

`c10/core/DispatchKeySet.h` defines exactly the masks used here:

```cpp
constexpr DispatchKeySet autograd_dispatch_keyset = DispatchKeySet({
    DispatchKey::AutogradFunctionality,
    DispatchKey::AutogradOther,
    DispatchKey::AutogradNestedTensor,
});
constexpr DispatchKeySet after_autograd_keyset =
    DispatchKeySet(DispatchKeySet::FULL_AFTER, c10::DispatchKey::AutogradOther);
constexpr DispatchKeySet after_ADInplaceOrView_keyset = DispatchKeySet(
    DispatchKeySet::FULL_AFTER, c10::DispatchKey::ADInplaceOrView);
```

`FULL_AFTER` = "every bit strictly below this one". **That is redispatch in one constant.**

**4. `ADInplaceOrView`.** From the header comment, verbatim:

```
// ADInplaceOrView key is used by inplace or view ops to register a kernel
// that does additional setup for future autograd computation.
//   1. For inplace ops this kernel does version bump
//   2. For view ops this kernel does `as_view` setup where we properly setup
//      DifferentiableViewMeta on the view tensors.
// For other ops it's fallthrough kernel since there's no extra work to do.
```

`add` is functional, so its `ADInplaceOrView` cell is a **fallthrough** — and fallthroughs are handled by the `key_mask`, meaning the dispatcher skips the bit entirely with no function call at all. The header also documents *why* it isn't a universal layer: doing this for every op "adds an extra dispatch for all ops and it's non-trivial overhead at model level (a few percents)."

**5. Backend.** Highest remaining bit: `Dense` ⊕ `CUDABit` → runtime slot `CUDA`, registered by `TORCH_LIBRARY_IMPL(aten, CUDA, ...)` in generated `RegisterCUDA.cpp`. Because `add.Tensor` has `structured_delegate: add.out`, this is a generated wrapper that runs the meta function (broadcast + type promotion + output allocation) then calls the structured `impl`, which builds a `TensorIterator` and launches the CUDA elementwise kernel.

**6. dtype.** The last dispatch is *not* the dispatcher — it's a `switch` on `ScalarType`, spelled `AT_DISPATCH_ALL_TYPES_AND2(kHalf, kBFloat16, iter.dtype(), "add_cuda", [&]{ ... });`. ezyang's 2019 framing is still the right mental model: **two dispatches, one dynamic (virtual/table, device+layout) and one static (switch, dtype)**, because device implementations may live in separately-loaded shared libraries while dtypes are known at compile time and want to be monomorphised.

If any input were sparse, step 5 would instead have picked `Sparse` ⊕ `CUDABit` → `add_out_sparse_cuda`, from the `dispatch:` block of the YAML. Nothing else in the chain changes. That is the payoff.

### Boxed vs unboxed

Two calling conventions coexist:

- **Unboxed**: the real C++ signature, `Tensor(const Tensor&, const Tensor&, const Scalar&)`. Zero overhead, but the *type is baked in*, so you cannot write one function that works for every operator.
- **Boxed**: arguments arrive on a `torch::jit::Stack`, i.e. `std::vector<IValue>`. ezyang describes `IValue` as "a two word structure consisting of a payload word (usually a pointer, but it could also be an integer or float directly packed into the field) and a tag word which tells us what kind of value the IValue is."

The dispatcher generates the adapters both ways with C++ templates. This is what makes **whole-column fallbacks** possible: `Tracer`, `Functionalize`, the `Python` key and `autogradNotImplementedFallback` are single boxed functions registered once for *all ~2,000 operators*. Without boxing, each would need codegen per operator.

`Dispatcher::call` is short enough to read:

```cpp
auto dispatchKeySet = op.operatorDef_->op.dispatchKeyExtractor()
        .template getDispatchKeySetUnboxed<Args...>(args...);
const KernelFunction& kernel = op.operatorDef_->op.lookup(dispatchKeySet);
return kernel.template call<Return, Args...>(op, dispatchKeySet, std::forward<Args>(args)...);
```

Note the key set is passed *into* the kernel — that is how a kernel can call `redispatch` without recomputing it.

### `BackendSelect`

Factory functions (`torch.empty`, `torch.randn`) have **no tensor arguments**, so `multi_dispatch_key_set(args...)` returns the empty set and dispatch has nothing to go on. `BackendSelect` is a functionality key registered for exactly these ops: it "inspects the arguments and decides what the final dispatch key should be, and then does a direct dispatch to that key, bypassing dispatch key calculation" — reading the `device=` argument out of `TensorOptions`. Its bit sits below `Autograd` so it runs after autograd has had its say. This is the clean answer to "how does `torch.randn(3, device='cuda')` know it's CUDA?"

### Registration API — the operator × key grid

```cpp
// The schema: one per operator, exactly once, program-wide.
TORCH_LIBRARY(myops, m) {
  m.def("myadd(Tensor self, Tensor other) -> Tensor");
}

// One cell: this operator, this key.
TORCH_LIBRARY_IMPL(myops, CPU,  m) { m.impl("myadd", myadd_cpu);  }
TORCH_LIBRARY_IMPL(myops, CUDA, m) { m.impl("myadd", myadd_cuda); }
TORCH_LIBRARY_IMPL(myops, Autograd, m) { m.impl("myadd", myadd_autograd); }
```

Three registration granularities (ezyang's grid picture):

1. **a cell** — `m.impl(op, key)`, one operator at one key;
2. **a row** — a catch-all kernel for all keys of one operator (being phased out, because it defeats the layering);
3. **a column** — `m.fallback(...)`, one key across all operators. Requires a boxed kernel.

Precedence: exact registration > catch-all > fallback.

To call your own dispatched op from C++, you go back through the dispatcher:

```cpp
Tensor myadd(const Tensor& self, const Tensor& other) {
  static auto op = torch::Dispatcher::singleton()
    .findSchemaOrThrow("myops::myadd", "")
    .typed<decltype(myadd)>();
  return op.call(self, other);
}
```

The `static` matters: schema lookup is a hash-map hit, done once per call site.

Autograd for a custom op is a `torch::autograd::Function` registered at the `Autograd` **alias** key (which expands to `AutogradCPU`, `AutogradCUDA`, …), and it must exclude itself before redispatching or it recurses forever:

```cpp
class MyAddFunction : public torch::autograd::Function<MyAddFunction> {
  static Tensor forward(AutogradContext* ctx, Tensor self, Tensor other) {
    at::AutoDispatchBelowADInplaceOrView g;   // TLS-exclude Autograd + ADInplaceOrView
    return myadd(self, other);                // re-enter dispatcher, land on backend
  }
  static tensor_list backward(AutogradContext* ctx, tensor_list grad_outputs) {
    return {grad_outputs[0], grad_outputs[0]};
  }
};
TORCH_LIBRARY_IMPL(myops, Autograd, m) { m.impl("myadd", myadd_autograd); }
```

If your op genuinely has no gradient, say so explicitly rather than leaving the cell empty:

```cpp
TORCH_LIBRARY_IMPL(myops, Autograd, m) {
  m.impl(op, autogradNotImplementedFallback());
}
// and for in-place/view ops, also:
TORCH_LIBRARY_IMPL(myops, ADInplaceOrView, m) {
  m.impl(op, autogradNotImplementedInplaceOrViewFallback());
}
```

### Why the design exists — the three-line version

The tutorial concedes the dispatcher is "a glorified if-statement", then gives three reasons it isn't:

1. **Decentralisation.** No central `if`. A third party ships a new backend or a new mode in a separate `.so` and it composes with everything, without patching PyTorch. This is how XLA, MPS, IPU, HPU and every `PrivateUse1` accelerator exist.
2. **Rich keys.** Autocast, tracing, batching (`vmap`), functionalization, `__torch_dispatch__`, fake tensors, conjugate/negative views, `PreDispatch` for `torch.export` — all bolted on as keys without touching a single kernel.
3. **Boxed fallbacks.** One function covers all 2,000 ops, so a new cross-cutting feature is O(1) code, not O(#ops).

And the cost, stated honestly: ~2–3 table lookups and indirect calls per op. Which is fine for a 1 ms GEMM and catastrophic for a 5 µs elementwise op on 1,000 elements — **which is precisely the overhead `torch.compile` exists to delete.** Frame that link explicitly; it makes §2.6 feel inevitable rather than bolted on.

---

## 2.3 `TensorImpl` and `Storage`

Verified against `c10/core/TensorImpl.h` and `c10/core/StorageImpl.h` on `main`.

The same tensor/storage split as NumPy, plus a device and a dispatch key set. `TensorImpl`'s data members, in declaration order:

```cpp
 protected:
  Storage storage_;                                    // ref-counted, shareable
 private:
  std::unique_ptr<c10::AutogradMetaInterface> autograd_meta_ = nullptr;
 protected:
  std::unique_ptr<c10::ExtraMeta> extra_meta_ = nullptr;   // symbolic shapes, named tensors
  c10::VariableVersion version_counter_;                   // in-place-mutation detection
  impl::PyObjectSlot pyobj_slot_;                          // the Python object, if any
  c10::impl::SizesAndStrides sizes_and_strides_;           // inline SmallVector-ish
  int64_t storage_offset_ = 0;                             // in ELEMENTS, not bytes
  int64_t numel_ = 1;                                      // cached product of sizes
  caffe2::TypeMeta data_type_;                             // the dtype
  std::optional<c10::Device> device_opt_;                  // {type, index}
  bool is_contiguous_ : 1 = true;                          // CACHED, not computed
  bool storage_access_should_throw_ : 1 = false;
  bool is_channels_last_ : 1; bool is_channels_last_contiguous_ : 1;
  bool is_channels_last_3d_ : 1; bool is_channels_last_3d_contiguous_ : 1;
  bool is_non_overlapping_and_dense_ : 1;
  ...
  DispatchKeySet key_set_;                                 // the routing bits
```

`StorageImpl`:

```cpp
  DataPtr data_ptr_;          // pointer + Deleter + Device
  SymInt size_bytes_;
  bool size_bytes_is_heap_allocated_;
  bool resizable_;
  bool received_cuda_;
  Allocator* allocator_;      // CPUAllocator / CUDACachingAllocator / pinned / ...
```

Points worth teaching:

- **`storage_offset_` is in elements; NumPy's equivalent offset is baked into `data` as a raw byte pointer.** PyTorch keeps the base pointer clean in the `Storage` and expresses "where this view starts" in the `TensorImpl`. So a PyTorch view is `(same StorageImpl refcount++, new sizes, new strides, new offset)` and slicing never touches the pointer.
- **PyTorch strides are in ELEMENTS. NumPy strides are in BYTES.** This trips up everyone porting code between them. `t.stride()` for a contiguous `(3,4)` float32 tensor is `(4, 1)`; `a.strides` for the NumPy equivalent is `(16, 4)`.
- **`autograd_meta_` is a nullable pointer, deliberately.** The comment: "`autograd_meta_` can be `nullptr`, as an optimization… tensors which don't require grad will have this field set to null." Three representable states (null / default-constructed / real), and PyTorch does not normalise between them. This is why `requires_grad=False` tensors cost nothing extra.
- **`is_contiguous_` is a cached bit, not a computation.** Recomputed by `refresh_contiguous()` whenever sizes/strides change (`compute_contiguous()`, `compute_channels_last_contiguous_2d()`, `compute_non_overlapping_and_dense()`, …). This is why `t.is_contiguous()` is free and why every stride-mutating op must remember to refresh.
- **`memory_format` is a *fifth* contiguity notion**, not just C/F order: `channels_last` is NCHW logical shape with NHWC physical strides. Convolutions want it; cuDNN/tensor cores want it; the logical shape never changes. This is the single best example of "strides are the API and layout is an implementation detail."
- The **extension trinity** from ezyang 2019: **device × layout × dtype**. "The Cartesian product of these parameters define all of the possible tensors you can make." Not every cell has a kernel; the dispatcher is precisely the machinery for expressing which do.
- `sizes_and_strides_` is kept **inline in the struct even for sparse tensors** where it is meaningless, because "size and stride are too important" to pay a virtual call for. Sparse tensors put indices/values in the custom suffix instead.

### Views vs copies, and `contiguous()`

Identical rules to NumPy (see §1), with two PyTorch-specific additions:

- `t.view(shape)` **refuses** to work on non-contiguous input and raises; `t.reshape(shape)` silently copies when it must. Teaching point: `view` is the honest one. `reshape` is `view` with a fallback to `contiguous().view()`.
- `t.contiguous()` is a no-op returning `self` when `is_contiguous_` is already set, and a full copy otherwise. `t.contiguous(memory_format=torch.channels_last)` requests a *different* contiguity.
- `t.expand(...)` is stride-0 broadcasting (a view, no memory); `t.repeat(...)` materialises (a copy). The names are backwards from what everyone expects and this catches people in real OOMs.
- Storage identity check: `a.data_ptr() == b.data_ptr()` compares the *view's* pointer; `a.untyped_storage().data_ptr() == b.untyped_storage().data_ptr()` compares the allocation. Use the latter to prove a view is a view.

The version counter is the safety mechanism that pure-NumPy strides don't need: every in-place op bumps `version_counter_`, and every saved tensor records the version at save time. Mismatch at `backward()` time is the famous *"one of the variables needed for gradient computation has been modified by an inplace operation"* error. It is a correctness check, not a performance one — without it you'd silently compute wrong gradients.
## 2.4 Autograd

All paths verified against `pytorch/pytorch` `main`. **Note a common stale reference: `Node` now lives in `torch/csrc/autograd/node.h`, not `function.h`.** `function.h` retains only the free helpers `collect_next_edges`, `create_gradient_edge`, `any_variable_requires_grad`, `TypeAndSize`.

| Concept | File |
|---|---|
| `AutogradMeta`, `DifferentiableViewMeta` | `torch/csrc/autograd/variable.h` / `.cpp` |
| `Node` | `torch/csrc/autograd/node.h` |
| `Edge` | `torch/csrc/autograd/edge.h` |
| Engine, `ReadyQueue`, `NodeTask` | `torch/csrc/autograd/engine.h` / `.cpp` |
| `GraphTask` | `torch/csrc/autograd/graph_task.h` |
| `InputBuffer` | `torch/csrc/autograd/input_buffer.h` / `.cpp` |
| `AccumulateGrad` | `torch/csrc/autograd/functions/accumulate_grad.h` / `.cpp` |
| `SavedVariable` (the version check) | `torch/csrc/autograd/saved_variable.cpp` |
| C++ custom Function (`CppNode<T>`) | `torch/csrc/autograd/custom_function.h` |
| Python custom Function (`PyNode`, `THPFunction`) | `torch/csrc/autograd/python_function.h` / `.cpp` |
| Grad-mode TLS | `c10/core/GradMode.h`, `c10/core/AutogradState.h`, `c10/core/InferenceMode.h` |
| Version counter | `c10/core/TensorImpl.h`, `struct C10_API VariableVersion` |
| Codegen | `tools/autograd/{derivatives.yaml,gen_variable_type.py,gen_autograd_functions.py,templates/}` |

### The tape hangs off the tensor

`AutogradMeta` (`variable.h`), abridged to the load-bearing fields:

```cpp
struct TORCH_API AutogradMeta : public c10::AutogradMetaInterface {
  std::string name_;
  Variable grad_;                                   // .grad
  c10::intrusive_ptr<Node> grad_fn_;                // NOT shared_ptr — intrusive refcounting
  c10::weak_intrusive_ptr<Node> grad_accumulator_;  // WEAK. see below
  mutable std::shared_ptr<ForwardGrad> fw_grad_;    // forward-mode AD
  std::vector<std::unique_ptr<FunctionPreHook>> hooks_;
  bool requires_grad_{false};   // "Only meaningful on leaf variables (must be false otherwise)"
  bool retains_grad_{false};    // "Only meaningful on non-leaf variables"
  bool is_view_{false};
  uint32_t output_nr_;          // "if this variable was the second output ... output_nr == 1"
  mutable std::mutex mutex_;
};
```

Two invariants stated in the source itself:

```cpp
bool requires_grad() const override { return requires_grad_ || grad_fn_; }
TORCH_CHECK(!grad_fn_ || !requires_grad_, "requires_grad should be false if grad_fn is set");
```

So `requires_grad_` is **only the leaf bit**. An interior tensor reports `requires_grad() == true` purely because `grad_fn_ != nullptr`. That is a clean, teachable definition of "leaf": a tensor with `requires_grad=True` and no `grad_fn`.

**`grad_accumulator_` is deliberately a weak pointer.** `AccumulateGrad` owns a strong `Variable` pointing back at the leaf; a strong link both ways would be a refcount cycle on every single model parameter. From `variable.cpp`:

```cpp
TORCH_CHECK(!autograd_meta->grad_fn_, "grad_accumulator() should be only called on leaf Variables");
if (!autograd_meta->requires_grad_) return nullptr;
result = autograd_meta->grad_accumulator_.lock();
if (result) return result;
result = c10::make_intrusive<AccumulateGrad>(Variable(std::move(intrusive_from_this)));
autograd_meta->grad_accumulator_ = c10::weak_intrusive_ptr<Node>(result);
```

Consequence worth teaching: an `AccumulateGrad` node exists only as long as some graph edge holds it.

**Everything funnels through one function** (`variable.cpp`), and it is the whole leaf/interior distinction in six lines:

```cpp
Edge gradient_edge(const Variable& self) {
  if (const auto& gradient = self.grad_fn()) {
    return Edge(gradient, self.output_nr());     // interior
  } else {
    return Edge(grad_accumulator(self), 0);      // leaf with requires_grad → AccumulateGrad
  }
}                                                // leaf without → Edge() with function == nullptr
```

### `Node` and `Edge`

```cpp
struct Edge {
  c10::intrusive_ptr<Node> function;
  uint32_t input_nr;
  bool is_valid() const noexcept { return function != nullptr; }
};
```

`Node` (`node.h`). Note the deliberate inversion in its own header comment — *"inputs of the grad_fn correspond to Tensor outputs of the forward function"* — so:

- `num_inputs() == input_metadata_.size()` = number of **forward outputs** = incoming gradients,
- `num_outputs() == next_edges_.size()` = number of **forward inputs** = outgoing gradients.

Members that matter:

```cpp
uint64_t sequence_nr_;
uint64_t topological_nr_ = 0;
mutable bool has_parent_ = false;
edge_list next_edges_;
at::SmallVector<InputMetadata, 2> input_metadata_;
std::vector<std::unique_ptr<FunctionPreHook>> pre_hooks_, tensor_pre_hooks_;
std::vector<std::unique_ptr<FunctionPostHook>> post_hooks_;
protected:
  virtual variable_list apply(variable_list&& inputs) = 0;
```

`operator()` wraps `apply()` in a `RecordFunction` guard **only when profiler step callbacks exist** — otherwise it calls `apply` directly, zero overhead. A nice example of pay-for-what-you-use.

**`sequence_nr_`** — from `NOTE [ Sequence Number ]`, verbatim:

> "1) Helps determine the node's execution priority in the engine. All else being equal, nodes with higher priority numbers are executed first. Thus, nodes corresponding to ops executed later are the first to be executed in the backward pass. One caveat is that we prioritize AccumulateGrad nodes by explicitly setting its sequence_nr to be UINT64_MAX.
> 2) The sequence number of this `Node` is paired with thread_id it was created in as a unique identifier by the profiler ... because sequence_nr is thread_local, i.e., starts counting up from zero in a new thread"

And indeed:

```cpp
// AccumulateGrad sets sequence_nr to the max value so it's always called ASAP during backwards.
AccumulateGrad::AccumulateGrad(Variable variable_)
    : Node(/*sequence_nr=*/UINT64_MAX), variable(std::move(variable_)) { add_input_metadata(variable); }
```

The heuristic behind "later-created nodes run first" is that it frees saved tensors as early as possible, shrinking peak memory during backward.

**`topological_nr_`** — from `NOTE [ Topological Number ]`, verbatim:

> "topological_nr is used to prune branches in the DAG during autograd discovery as maintaining topological_nr helps us check in **O(1)** if there does NOT exist a directed path between two nodes. The topological order number of this `Node` representing the length of the longest possible path from this Node to any leaf node. If you are leaf node, aka AccumulateGrad, this will be zero. This value has the property that For every pair of nodes X, Y in G, existence of a directed path from X to Y implies topo_nr(X) > topo_nr(Y). The converse is not true..."

```cpp
void update_topological_nr(const Edge& edge) {
  TORCH_INTERNAL_ASSERT(!has_parent_, "Cannot update a node's topological_nr after it already has a parent...");
  if (Node* node = edge.function.get()) {
    auto topo_nr = node->topological_nr();
    if (topological_nr_ <= topo_nr) topological_nr_ = topo_nr + 1;
  }
}
uint64_t topological_nr() const noexcept { has_parent_ = true; return topological_nr_; }
```

Reading it *sets* `has_parent_` — that freeze is what makes the invariant safe. It is used to prune whole subgraphs when you call `torch.autograd.grad(..., inputs=...)`.

### Codegen: `derivatives.yaml` → `MulBackward0`

`derivatives.yaml`'s own header states the contract:

> "Also, every time we talk computing 'gradient' we actually mean computing the **vector jacobian product** using the given 'output gradient' as the vector."
> "`grads` is a vector of output gradients, and `grad == grads[0]`, in all the derivative formulas in this file."

Two real entries, showing the memory asymmetry:

```yaml
- name: mul.Tensor(Tensor self, Tensor other) -> Tensor
  self:  mul_tensor_backward(grad, other, self.scalar_type())   # needs `other`
  other: mul_tensor_backward(grad, self,  other.scalar_type())  # needs `self`
  result: other_t * self_p + self_t * other_p                   # forward-mode JVP

- name: sum(Tensor self, *, ScalarType? dtype=None) -> Tensor
  dispatch:
    Default:
      self: grad.expand_symint(self.sym_sizes())                # needs only the SHAPE
      result: auto_linear
```

`mul` must save both operands; `sum` saves only a shape. That table — which ops cost activation memory — is the single most practically useful thing a student can derive from `derivatives.yaml`, and it is exactly what AOTAutograd's min-cut partitioner optimises over.

Output lands in `torch/csrc/autograd/generated/` (a build directory). `VariableType.cpp` is emitted **sharded into 10 files** (`gen_variable_type.py` passes `num_shards=10`), so `VariableType_0.cpp … VariableType_9.cpp`.

The generated node class shape:

```cpp
struct TORCH_API MulBackward0 : public TraceableFunction {   // TraceableFunction : Node
  using TraceableFunction::TraceableFunction;
  variable_list apply(variable_list&& grads) override;
  std::string name() const override { return "MulBackward0"; }
  void release_variables() override { ... }
  SavedVariable self_;
  SavedVariable other_;
  at::ScalarType other_scalar_type;
};
```

And the generated **forward wrapper** — this is the tape-building code, and it is only four templates:

```cpp
// DECLARE_GRAD_FN
c10::intrusive_ptr<MulBackward0> grad_fn;
// SETUP_ANY_REQUIRES_GRAD
[[maybe_unused]] auto _any_requires_grad = compute_requires_grad( self, other );
// SETUP_DERIVATIVE
if (_any_requires_grad) {
  // ASSIGN_GRAD_FN
  grad_fn = c10::make_intrusive<MulBackward0>();
  grad_fn->set_next_edges(collect_next_edges( self, other ));
  grad_fn->self_  = SavedVariable(self,  /*is_output=*/false);
  grad_fn->other_ = SavedVariable(other, /*is_output=*/false);
}
// ... run the op under at::AutoDispatchBelowADInplaceOrView ...
if (grad_fn) set_history(result, grad_fn);
```

with

```cpp
template <typename... Args>
inline bool compute_requires_grad(Args&&... args) {
  if (!GradMode::is_enabled()) return false;                        // ← this is no_grad
  return ComputeRequiresGrad().apply(std::forward<Args>(args)...).out;
}

inline void set_history(const at::Tensor& variable, const c10::intrusive_ptr<Node>& grad_fn) {
  auto output_nr = grad_fn->add_input_metadata(variable);
  impl::set_gradient_edge(variable, {grad_fn, output_nr});
}
```

**The whole tape is built by two calls per operator**: `collect_next_edges` (backward pointers to producers) and `set_history` (forward tensor → this node). Everything else is bookkeeping. Say that sentence out loud in the lecture; it demystifies the subsystem faster than anything else.

### Worked example: `y = (a*b).sum()`

With `a.requires_grad_()`, `b.requires_grad_()`:

1. **`aten::mul.Tensor`** dispatches to `AutogradCUDA` → `VariableType::mul_Tensor`.
   `_any_requires_grad` → true. `grad_fn = MulBackward0`.
   `collect_next_edges(self, other)` → `next_edges_ = [Edge(AccumulateGrad<a>, 0), Edge(AccumulateGrad<b>, 0)]`. **Both `AccumulateGrad` nodes are created lazily right here** and cached weakly on the leaves.
   Both operands saved as `SavedVariable`s, each snapshotting the current version counter.
   Redispatch below autograd → `at::native::mul_kernel_cuda`.
   `set_history(t, grad_fn)` → `t.grad_fn_ = MulBackward0`, `t.output_nr_ = 0`. `MulBackward0::topological_nr_ = 1`.
2. **`aten::sum`** → `SumBackward0`, `next_edges_ = [Edge(MulBackward0, 0)]`, saves only `self_sym_sizes` — **no tensor**. `topological_nr_ = 2`.

```
SumBackward0        topo 2, seq N+1
   └─ next_edges_[0] = (MulBackward0, input_nr=0)
MulBackward0        topo 1, seq N
   ├─ next_edges_[0] = (AccumulateGrad<a>, 0)    topo 0, seq UINT64_MAX
   └─ next_edges_[1] = (AccumulateGrad<b>, 0)    topo 0, seq UINT64_MAX
```

Edges point **backwards**, in the direction gradient flows. The graph is stored in the *outputs*, pointing at their producers — there is no global registry, and when the last tensor referencing a subgraph is dropped, the subgraph is freed by refcounting alone.

### The engine

`Engine::execute` (`engine.cpp`) in outline:

```cpp
validate_outputs(root_edges, inputs, ...);
init_local_ready_queue();
auto graph_task = std::make_shared<GraphTask>(keep_graph, /*grad_mode=*/create_graph, ...);
bool skip_dummy_node = root_edges.size() == 1 && compiled_autograd == nullptr;
auto graph_root = skip_dummy_node ? root_edges.at(0).function
                                  : c10::make_intrusive<GraphRoot>(root_edges, inputs);
auto min_topo_nr = compute_min_topological_nr(outputs);
compute_dependencies(graph_root.get(), *graph_task, min_topo_nr);
if (!outputs.empty()) graph_task->init_to_execute(*graph_root, outputs, accumulate_grad, min_topo_nr);
execute_with_graph_task(graph_task, graph_root, std::move(input_buffer));
graph_task->future_result_->wait();
```

`accumulate_grad` is the flag distinguishing `.backward()` (true — write into `.grad`) from `torch.autograd.grad()` (false — return captured gradients).

**`compute_dependencies` is an in-degree count, and — correcting a widely repeated claim — it uses a LIFO stack, not a BFS queue:**

```cpp
std::vector<Node*> queue{root};
auto& dependencies = task.dependencies_;
while (!queue.empty()) {
  auto fn = queue.back();
  queue.pop_back();                                    // LIFO ⇒ DFS order
  if (fn->topological_nr() < min_topo_nr) continue;    // O(1) subgraph pruning
  for (const auto& edge : fn->next_edges()) {
    if (auto next_ptr = edge.function.get()) {
      dependencies[next_ptr] += 1;                                 // in-degree
      const bool was_inserted = task.nodes_in_graph_.insert(next_ptr).second;
      if (was_inserted) queue.push_back(next_ptr);                 // visit once
    }
  }
}
```

The traversal order is irrelevant — the *only* output is `dependencies_[N] = in-degree(N)`, i.e. how many distinct incoming gradient contributions `N` must receive before it may run. `nodes_in_graph_` makes it O(V+E).

**Scheduling is Kahn's algorithm.** In `Engine::evaluate_function`, for each outgoing gradient:

```cpp
auto it = dependencies.find(next.function.get());
if (--it->second == 0) { dependencies.erase(it); is_ready = true; }

auto not_ready_it = not_ready.find(next.function.get());
if (not_ready_it == not_ready.end()) {
  InputBuffer input_buffer(next.function->num_inputs());
  input_buffer.add(next.input_nr, std::move(output), ...);
  if (is_ready) ready_queue(cpu_ready_queue, next.function->device())
                    ->push(NodeTask(graph_task, next.function, std::move(input_buffer)));
  else          not_ready.emplace(next.function.get(), std::move(input_buffer));
} else {
  auto& input_buffer = not_ready_it->second;
  input_buffer.add(next.input_nr, std::move(output), ...);
  if (is_ready) { ready_queue(...)->push(...); not_ready.erase(not_ready_it); }
}
```

**Why a topological traversal and not a DFS.** A tensor used twice in the forward pass (a residual connection; `d = a*b + a*c`) becomes a node with **in-degree ≥ 2** in the backward graph. Running it as soon as the *first* gradient arrives would compute `∂L/∂x` from one path only and silently produce a wrong answer. The `dependencies_` counter is precisely the guard that says "every contribution has arrived." Corollary: the traversal shape is data-driven, and `sequence_nr` only breaks ties among nodes that are *already* ready.

Also in that function: `if (!graph_task->keep_graph_) fn.release_variables();` — that is where `retain_graph=False` frees the `SavedVariable`s, and why a second `.backward()` throws.

**`ReadyQueue` is a priority queue, not a FIFO:**

```cpp
struct CompareNodeTaskTime {
  bool operator()(NodeTask const& t1, NodeTask const& t2) {
    ...
    if (t1.getReentrantDepth() == t2.getReentrantDepth())
      return t1.fn_->sequence_nr() < t2.fn_->sequence_nr();
    else return t1.getReentrantDepth() < t2.getReentrantDepth();
  }
};
std::priority_queue<NodeTask, std::vector<NodeTask>, CompareNodeTaskTime> heap_;
```

Deeper reentrant depth first, then higher `sequence_nr` first, so `AccumulateGrad` (`UINT64_MAX`) always jumps the queue.

**Threading.** `start_device_threads()` creates **one detached daemon thread per accelerator device**, each owning one `ReadyQueue`, once per process. The CPU side is different, and the TLS comment says why:

> "The CUDA, XLA threads are shared among all invocations of backwards via `device_ready_queues_`, while the caller thread is dedicated to processing work for devices returning true in `should_run_in_cpu_ready_queue` (most notably the CPU device). So any given graph task maintains its own `cpu_ready_queue_`."

i.e. **the Python thread that called `.backward()` becomes the CPU worker for its own `GraphTask`.** `Note [Reentrant backwards]` covers calling `backward()` inside a backward: a thread from `thread_pool_shared_` drains the same queue while the parent blocks, with `MAX_DEPTH = 60`, chosen because *"TSAN's deadlock detector … will fail if a program hold more than 65 locks in one thread at once."*

### `InputBuffer` — the implicit addition node

From `NodeTask`'s comment: *"This buffer serves as an implicit 'addition' node for all of the gradients flowing here."*

```cpp
static void accumulate(std::vector<Variable>& buffer, const size_t pos, Variable&& var) {
  auto& old_var = buffer[pos];
  if (at::GradMode::is_enabled()) {
    buffer[pos] = old_var + var;                     // create_graph=True → must be recorded
  } else if (old_var.is_sparse() || old_var.is_sparse_csr()) {
    ...
  } else if (can_accumulate_inplace(old_var) && !at::isTensorSubclassLike(var)) {
    buffer[pos] = old_var.add_(var);                 // steal the buffer, zero allocation
  } else {
    buffer[pos] = old_var + var;
  }
}
```

`can_accumulate_inplace` requires GradMode off, `use_count() == 1` on both tensor and storage, and contiguous/non-overlapping/dense. **This is why `create_graph=True` is measurably slower and allocates more** — every accumulation becomes a recorded out-of-place add, which is itself a node in a second-order graph.

### `AccumulateGrad` — how `.grad` gets written

`AccumulateGrad::accumulateGrad` is a documented case machine. The important case:

- **Case 1.1** — `.grad` is undefined, GradMode off, the incoming gradient is stealable (`use_count` check) and obeys the layout contract ⇒ `update_grad(new_grad.detach())`, a **zero-copy steal**. This is exactly why the first `backward()` after `zero_grad(set_to_none=True)` allocates nothing extra, and why `set_to_none=True` is the recommended default.
- **Case 1.5** — otherwise `clone_obey_contract(new_grad, variable)`. The **Gradient Layout Contract** says grad strides must match parameter strides; violating it is not an error but emits `TORCH_WARN_ONCE("grad and param do not obey the gradient layout contract. This is not an error, but may impair performance.")` — a great thing to trigger deliberately in an exercise, because it connects §2.3's stride material to real training throughput.
- **Case 2** — `.grad` defined, GradMode off ⇒ in-place `variable_grad += new_grad`.
- **Case 3** — GradMode on ⇒ out-of-place and recorded.

`AccumulateGrad` returns an empty `variable_list` (`num_outputs() == 0`); it is a sink.

### `no_grad` vs `inference_mode` vs `detach()`

All the mode bits live in one TLS bitfield, `c10/core/AutogradState.h`:

```cpp
struct C10_API AutogradState {
  static AutogradState& get_tls_state();
  static void set_tls_state(AutogradState state);
 private:
  bool grad_mode_ : 1 = true;
  bool inference_mode_ : 1 = false;
  bool fw_grad_mode_ : 1 = true;
  bool multithreading_enabled_ : 1 = true;
  bool view_replay_enabled_ : 1 = false;
  bool grad_layout_enforcement_enabled_ : 1 = true;
};
```

**`no_grad` is one TLS bool and a dead branch.** `torch.no_grad()` is exactly `c10::NoGradGuard : AutoGradMode`, an RAII guard flipping `grad_mode_`. **Nothing is excluded from the dispatcher.** The op still routes through `VariableType::mul_Tensor`; but the very first line, `compute_requires_grad(...)`, short-circuits on `if (!GradMode::is_enabled()) return false;`. So `_any_requires_grad == false`, the whole `SETUP_DERIVATIVE` block is skipped, `grad_fn` stays null, no `SavedVariable` is constructed, `set_history` is never called.

That is the entire mechanism. "`no_grad` means `grad_fn` is never set" is literally a **dead branch**, not a key exclusion. Cost: one well-predicted branch per op, plus the full `VariableType` wrapper frame — which you still pay.

**`inference_mode` is a dispatch-key change**, and that is the difference:

```cpp
InferenceMode(bool enabled = true)
    : prev_mode(AutogradState::get_tls_state()),
      prev_keyset(c10::impl::tls_local_dispatch_key_set()) {
  AutogradState::set_tls_state(AutogradState(
      /* grad_mode */ !enabled, /* inference_mode */ enabled,
      /* fw_grad_mode */ !enabled, /* multithreading_enabled */ !enabled));
  DispatchKeySet included = enabled
      ? prev_keyset.included_.remove(c10::DispatchKey::ADInplaceOrView)
      : prev_keyset.included_.add(c10::DispatchKey::ADInplaceOrView);
  DispatchKeySet excluded = enabled
      ? (prev_keyset.excluded_ | c10::autograd_dispatch_keyset)
      : (prev_keyset.excluded_ - c10::autograd_dispatch_keyset);
  ...
  c10::impl::_force_tls_local_dispatch_key_set(cur_keyset);
}
```

Two differences from `no_grad`, both at the dispatcher level:

1. **The whole `VariableType` wrapper is skipped.** `autograd_dispatch_keyset` is *excluded*, so `computeDispatchKeySet` lands directly on the backend kernel. No wrapper frame, no `compute_requires_grad` branch.
2. **`ADInplaceOrView` is removed from `included_`** — that is the kernel that bumps the version counter and records view metadata. So **inference tensors have no version counter and no view metadata at all.**

```cpp
bool is_inference() {
  bool no_ADInplaceOrView = !key_set_.has_any(c10::inplace_or_view_ks);
  bool no_Autograd = !key_set_.has_any(c10::autograd_dispatch_keyset);
  TORCH_INTERNAL_ASSERT_DEBUG_ONLY(no_ADInplaceOrView == no_Autograd,
      "ADInplaceOrView and Autograd keys must be on/off at the same time.");
  return no_ADInplaceOrView && no_Autograd;
}
```

The price is the restriction: tensors created in inference mode cannot later participate in a recorded computation. Enforced by `VariableVersion::bump()`:

```cpp
TORCH_CHECK(version_counter_ || InferenceMode::is_enabled(),
    "Inplace update to inference tensor outside InferenceMode is not allowed. "
    "You can make a clone to get a normal tensor before doing inplace update.");
```

**`detach()`** (`VariableTypeManual.cpp`):

```cpp
Tensor detach(c10::DispatchKeySet ks, const Tensor& self) {
  auto& self_ = unpack(self, "self", 0);
  auto result = ([&]() {
    at::AutoDispatchBelowAutograd guard;
    return at::redispatch::detach(ks & c10::after_autograd_keyset, self_);
  })();
  return result;   // forward grads deliberately not propagated
}
```

The backend `detach` is `shallow_copy_and_detach` on the `TensorImpl`: **new `TensorImpl`, same `StorageImpl`, same sizes/strides/offset, fresh empty `AutogradMeta`.** Crucially it **shares the version counter** with the source — which is why mutating a detached tensor can still trip the in-place check on the original's saved copy. `detach_()` is the destructive variant and refuses views outright (*"Can't detach views in-place. Use detach() instead."*), and using a saved tensor that was `detach_()`ed is explicitly rejected.

The table students should be able to fill in from first principles:

| | dispatcher | GradMode | version counter | view meta | `grad_fn` on outputs |
|---|---|---|---|---|---|
| default | Autograd + ADInplaceOrView | on | bumped | recorded | set if any input requires grad |
| `no_grad` | **unchanged** (wrapper still runs) | **off** | bumped | recorded | never |
| `inference_mode` | Autograd **excluded**, ADInplaceOrView **removed** | off | **absent** | **absent** | never |
| `detach()` | n/a (per tensor) | n/a | **shared with source** | new tensor is not a view | n/a |

### Custom `autograd.Function`

The modern three-method form splits context capture out of `forward`. The docs' stated reason: it "is closer to how PyTorch native operations are implemented and therefore more composable with various PyTorch subsystems" — concretely, `torch.func` transforms and `torch.compile` need a `forward` that is a **pure function of tensors**, with side-effecting context capture separated.

```python
class LinearFunction(Function):
    @staticmethod
    def forward(input, weight, bias):                 # NO ctx
        output = input.mm(weight.t())
        if bias is not None:
            output += bias.unsqueeze(0).expand_as(output)
        return output

    @staticmethod
    def setup_context(ctx, inputs, output):
        input, weight, bias = inputs
        ctx.save_for_backward(input, weight, bias)

    @staticmethod
    def backward(ctx, grad_output):
        input, weight, bias = ctx.saved_tensors
        grad_input = grad_weight = grad_bias = None
        if ctx.needs_input_grad[0]: grad_input  = grad_output.mm(weight)
        if ctx.needs_input_grad[1]: grad_weight = grad_output.t().mm(input)
        if bias is not None and ctx.needs_input_grad[2]: grad_bias = grad_output.sum(0)
        return grad_input, grad_weight, grad_bias
```

`save_for_backward` vs `ctx.foo = tensor`: the docs give three reasons for the former — autograd "can clear them immediately after backward completes", it "prevents reference cycles", and it "supports activation checkpointing" (saved-tensor hooks and `torch.utils.checkpoint` intercept `save_for_backward`, not attribute assignment).

**How it becomes a `Node`.** `Function<T>::apply` in `custom_function.h` does exactly what codegen does for built-ins:

```cpp
auto node = c10::make_intrusive<CppNode<T>>();
extract_vars(node->is_variable_input_, input_vars, args...);
bool is_executable = GradMode::is_enabled() && any_variable_requires_grad(input_vars);
auto next_edges = (is_executable ? collect_next_edges(input_vars) : edge_list());
node->set_ctx_grad_fn(node);
node->set_next_edges(std::move(next_edges));
{
  AutoGradMode grad_mode(false);                     // ← your forward always runs under no_grad
  outputs = T::forward(&node->ctx_, std::forward<Args>(args)...);
}
auto wrapped_outputs = _wrap_outputs(input_vars,
    node->ctx_.get_non_differentiable(),             // mark_non_differentiable
    node->ctx_.get_and_bump_dirty(),                 // mark_dirty → bumps version counters
    to_optional(outputs), is_executable ? node : nullptr, ...);
```

`AutoGradMode grad_mode(false)` is why ops inside your `forward` never build a sub-graph. On the Python side the equivalent is `PyNode : public Node` holding a `THPFunction` whose fields (`to_save`, `non_differentiable`, `dirty_tensors`, `is_variable_input`) *are* the `ctx`. Docs note: *"Custom Python `autograd.Function`s are automatically thread safe because of GIL."*

`gradcheck` compares the analytic VJP against central finite differences:

```python
input = (torch.randn(20, 20, dtype=torch.double, requires_grad=True),
         torch.randn(30, 20, dtype=torch.double, requires_grad=True))
assert gradcheck(linear, input, eps=1e-6, atol=1e-4)
```

`dtype=torch.double` is not optional in practice: fp32 central differences with `eps=1e-6` are dominated by round-off. `@once_differentiable` runs `backward` under `no_grad` and errors if someone tries to differentiate through it.

### The version counter and the in-place error

```cpp
struct C10_API VariableVersion {
 private:
  struct VersionCounter : intrusive_ptr_target {
    std::atomic<uint32_t> version_;
  };
  c10::intrusive_ptr<VersionCounter> version_counter_;
 public:
  VariableVersion(Disabled = DISABLED) {}          // cheap, no allocation
  bool enabled() const { return version_counter_; }
  void bump() {
    TORCH_CHECK(version_counter_ || InferenceMode::is_enabled(), ...);
    if (version_counter_) ++version_counter_->version_;
  }
};
```

A heap-allocated `std::atomic<uint32_t>` **shared between a tensor and all of its views**, bumped by the `ADInplaceOrView` kernel of every mutating op. `SavedVariable` snapshots it at save time and re-checks at unpack:

```cpp
auto current_version = impl::version_counter(data_).current_version();
if (saved_version_ != current_version) {
  message << "one of the variables needed for gradient computation has been "
             "modified by an inplace operation: [" << data_.toString() << ' ' << data_.sizes() << ']';
  if (grad_fn) message << ", which is output " << output_nr_ << " of " << grad_fn->forward_op_name() << ',';
  message << " is at version " << current_version << "; expected version " << saved_version_ << " instead.";
  ...
  TORCH_CHECK(false, std::move(message).str());
}
```

**A real soundness hole worth flagging in teaching:** the check is skipped when saved-tensor hooks are installed — *"If user provides hooks, we can't track versions through the hooks"*. If you write custom `saved_tensors_hooks`, you inherit responsibility for this invariant.

Its sibling error, from `if (!graph_task->keep_graph_) fn.release_variables();`:

```
Trying to backward through the graph a second time (or directly access saved tensors after
they have already been freed). Saved intermediate values of the graph are freed when you call
.backward() or autograd.grad(). Specify retain_graph=True if you need to backward through the
graph a second time or if you need to access saved tensors after calling backward.
```

Both messages are worth putting on a slide, because a student who can *derive* them from the `SavedVariable` mechanism will never be confused by them again.
## 2.5 The CUDA path

### The caching allocator — `c10/cuda/CUDACachingAllocator.cpp`

**Why it exists.** The docs put it plainly: *"PyTorch uses a caching memory allocator to speed up memory allocations. This allows fast memory deallocation **without device synchronizations**."*

The mechanism-level reason is the one a CUDA-literate student will already half-know: `cudaFree` must guarantee no in-flight kernel still references those pages, so the driver **synchronizes the device**. `cudaMalloc` serialises against the driver's allocation lock. A training step issuing thousands of temporaries would, with a malloc/free per op, drain the async pipeline on every single one — turning a pipelined schedule into a serialised one.

> **Flagged.** The "cudaFree synchronizes the device" property is documented in the CUDA Runtime API, not in PyTorch's tree. And the commonly quoted per-call figures ("microseconds to hundreds of microseconds") could **not** be verified from any PyTorch source or doc — treat them as folklore and have students measure their own.

**The design, verbatim from the file header** (this is the best single page of allocator documentation anywhere, and it is a code comment):

```
// Yet another caching allocator for CUDA device allocations.
//
// - Allocations are associated with a stream. Once freed, blocks can be
//   re-allocated on the same stream, but not on any other stream.
// - The allocator attempts to find the smallest cached block that will fit the
//   requested size. If the block is larger than the requested size, it may be
//   split. If no block is found, the allocator will delegate to cudaMalloc.
// - If the cudaMalloc fails, the allocator will attempt to free one cached
//   block of sufficient size that is not split and retry the allocation.
//   If this also fails, the allocator will attempt to free all cached blocks
//   that are not split and retry the allocation.
// - Large (>1MB) and small allocations are stored in separate pools.
//   Small requests are packed into 2MB buffers. Large requests will use the
//   smallest available free block or allocate a new block using cudaMalloc.
// - To reduce fragmentation, requests between 1MB and 10MB will allocate and
//   split a 20MB block, if no free block of sufficient size is available.
// - To further reduce fragmentation, blocks >= max_split_size are not allowed
//   to be split. These oversize cached blocks will still satisfy requests
//   within 1MB of the oversize cached block size.
//
// With this allocator, allocations and frees should logically be considered
// "usages" of the memory segment associated with streams, just like kernel
// launches. The programmer must insert the proper synchronization if memory
// segments are used from multiple streams.
```

The constants (`c10/core/AllocatorConfig.h`):

```cpp
constexpr size_t kSmallBuffer   = 2097152;    // small allocations packed into 2 MiB segments
constexpr size_t kMinBlockSize  = 512;        // every size rounded to ≥ 512 B
constexpr size_t kSmallSize     = 1048576;    // largest "small" allocation = 1 MiB
constexpr size_t kMinLargeAlloc = 10485760;   // 1–10 MiB may use a large segment
constexpr size_t kRoundLarge    = 2097152;    // large allocations rounded to 2 MiB
std::atomic<size_t> large_segment_size_{20971520};   // 20 MB, CONFIGURABLE (large_segment_size_mb)
```

The two data structures:

```cpp
struct BlockPool {
  std::set<Block*, BlockComparatorSizeCounterAddress> blocks;    // free list, ordered (size, counter, addr)
  std::set<Block*, BlockComparatorAddress> blocks_by_addr;       // for coalescing
  std::set<Block*, BlockComparatorAddress> unmapped;             // expandable_segments
  const bool is_small;
  PrivatePool* owner_PrivatePool;                                // CUDA-graph / MemPool private pool
};

struct Block {
  c10::DeviceIndex device;
  cudaStream_t stream;        // ALLOCATION stream
  stream_set stream_uses;     // streams the block was USED on  ← record_stream
  size_t size, requested_size;
  BlockPool* pool;
  void* ptr;
  bool allocated, mapped;
  Block *prev, *next;         // split neighbours WITHIN one cudaMalloc segment, for coalescing
  int event_count;
  ExpandableSegment* expandable_segment_;
};
```

Per device: two default pools (`small_blocks`, `large_blocks`) plus zero or more `PrivatePool`s.

The three sizing functions are worth reading as a unit, because together they are the fragmentation policy:

```cpp
static size_t round_size(size_t size) {                       // → multiple of 512 B
  if (size < kMinBlockSize) return kMinBlockSize;
  auto divisions = AcceleratorAllocatorConfig::roundup_power2_divisions(size);
  if (divisions > 1 && size > (kMinBlockSize * divisions))
    return roundup_power2_next_division(size, divisions);
  return kMinBlockSize * ((size + kMinBlockSize - 1) / kMinBlockSize);
}

static size_t get_allocation_size(size_t size) {              // segment size to cudaMalloc
  if (size <= kSmallSize)         return kSmallBuffer;                                  // 2 MiB
  else if (size < kMinLargeAlloc) return AcceleratorAllocatorConfig::large_segment_size(); // 20 MiB
  else                            return kRoundLarge * ((size + kRoundLarge - 1) / kRoundLarge);
}

bool should_split(const Block* block, size_t size, bool is_expandable_segments_active) {
  size_t remaining = block->size - size;
  if (block->pool->is_small || is_expandable_segments_active) return remaining >= kMinBlockSize;
  else return (size < AcceleratorAllocatorConfig::max_split_size()) && (remaining > kSmallSize);
}
```

**Coalescing has a hard limit that explains every fragmentation OOM you will ever see.** `free_block` merges only with `block->prev` / `block->next` — that intrusive list links blocks that were split out of *the same `cudaMalloc` segment*. Blocks from different segments **can never be merged**. So 100 MB free, spread across 50 segments, cannot serve one 100 MB request.

**The `malloc` retry chain**, read top to bottom as a cost ladder:

```cpp
bool block_found = get_free_block(params)
                || (trigger_free_memory_callbacks(params) && get_free_block(params));
if (!block_found) {
  if (allowed_memory_maximum.has_value() &&
      AcceleratorAllocatorConfig::garbage_collection_threshold() > 0.0)
    garbage_collect_cached_blocks(context);
  // WARNING: alloc_block may release the allocator lock when calling cudaMalloc.
  block_found = alloc_block(params, false, context, lock);
  if (!block_found && !params.oom_rejection_info.rejected) {
    block_found = try_mempool_fallback(...)
        || (release_available_cached_blocks(params, context) && alloc_block(params, false, ...))
        || (C10_LIKELY(!is_capture_context()) && release_cached_blocks(context, {0,0})
            && alloc_block(params, true, context, lock));
  }
}
```

Free-list hit (a `std::set::lower_bound`, nanoseconds) → GC → `cudaMalloc` → free *some* cache and retry → **free *all* cache (`cudaFree` everything, device sync) and retry** → OOM. That last rung is the multi-second stall you see immediately before an OOM message.

**Streams and `record_stream`.** This is the subtlest correctness hazard in the whole system:

```cpp
void recordStream(Block* block, cuda::CUDAStream stream) {
  if (stream.stream() == block->stream) return;    // uses on the ALLOCATION stream need no sync
  block->stream_uses.insert(stream);
  ...
}

// in free_locked:
if (!block->stream_uses.empty()) { ... insert_events(block); }
else                             { free_block(block, context); }   // immediately reusable

// insert_events:
for (auto& stream : streams) {
  EventPool::Event event = create_event_internal(stream.device_index());
  C10_CUDA_CHECK(cudaEventRecord(*event, stream.stream()));
  block->event_count++;
  cuda_events[stream].emplace_back(std::move(event), block);
}
```

`process_events` polls those events and only calls `free_block` once `event_count` reaches 0. **The hazard:** a tensor allocated on stream A but *used* on stream B is, at Python-`del` time, immediately reusable on A — the allocator only knows about A. `t.record_stream(s)` is what inserts B into `stream_uses` so the free is deferred behind a `cudaEventRecord` on B. The docs' canonical snippet:

```python
s = torch.cuda.Stream()
A = torch.empty((100, 100), device=cuda).normal_(0.0, 1.0)
s.wait_stream(torch.cuda.default_stream(cuda))  # ensure normal_() finished before sum(A)
with torch.cuda.stream(s):
    B = torch.sum(A)
A.record_stream(s)                              # do not free A before sum(A) completes
```

**`empty_cache()` is `cudaFree` on every cached block.** The docs: *"Calling `empty_cache()` releases all **unused** cached memory from PyTorch so that those can be used by other GPU applications."* It exists **only** to hand memory back to other processes or libraries (NCCL, a second framework, another rank). Inside one PyTorch process it is a pure pessimisation: you pay `cudaFree` (a sync) now and `cudaMalloc` again later. Teach it as a footgun, not a fix.

**`PYTORCH_ALLOC_CONF`** is now the primary env var; `PYTORCH_CUDA_ALLOC_CONF` is honoured for compatibility (the CUDA-specific name is checked first).

| Key | Effect |
|---|---|
| `max_split_size_mb` | "prevents the native allocator from splitting blocks larger than this size (in MB). This can reduce fragmentation and may allow some borderline workloads to complete without running out of memory." |
| `garbage_collection_threshold` | "helps actively reclaiming unused GPU memory to avoid triggering expensive sync-and-reclaim-all operation." Only active with `set_per_process_memory_fraction`. |
| **`expandable_segments`** | One VA reservation per stream, with physical pages mapped/unmapped underneath via `cuMemCreate`/`cuMemMap`. "allows the allocator to create a segment initially and then expand its size later when more memory is needed" — **this is the fix for fragmentation from fluctuating batch/sequence lengths**, because it dissolves the split-and-cannot-merge problem entirely. |
| `roundup_power2_divisions` | Round to a power-2 sub-division so nearby sizes share blocks. |
| `backend` | `native` (this file) or `cudaMallocAsync` (CUDA ≥ 11.4). |
| `per_process_memory_fraction`, `throw_on_cudamalloc_oom` | |

One caveat worth flagging in class: `expandable_segments:True` **breaks IPC** — *"Tensors allocated with expandable_segments:True cannot be shared between processes."* That bites DataLoader workers.

**Observability, and the one number that matters.**

- `memory_allocated()` / `max_memory_allocated()` = live tensor bytes. `memory_reserved()` / `max_memory_reserved()` = bytes held from the driver — **this is what `nvidia-smi` shows.** `reserved − allocated` is your cache plus your fragmentation.
- `memory_summary()` / `memory_stats()` expose `allocated_bytes`, `reserved_bytes`, `active_bytes`, `inactive_split_bytes`, `segment`, `num_alloc_retries`, `num_ooms`, `oversize_allocations`, each split `AGGREGATE / SMALL_POOL / LARGE_POOL`.
  **`num_alloc_retries > 0` is the fragmentation smoking gun** — it counts entries into the release-and-retry chain above. Teach students to look at this one field first.
- Snapshots:
  ```python
  torch.cuda.memory._record_memory_history(max_entries=100000)
  ...
  torch.cuda.memory._dump_snapshot("snap.pickle")
  ```
  Drop the pickle on **pytorch.org/memory_viz** (client-side JS, nothing uploaded). *"The Python trace collection is fast (2us per trace)"*, but snapshots reach "GB range for longer running workflows". Trace event types: `ALLOC`, `FREE_REQUESTED`, `FREE_COMPLETED`, `SEGMENT_ALLOC`, `SEGMENT_FREE`, `OOM`, `SNAPSHOT`.
  Limitation, verbatim: *"The memory profiler and visualizer described in this document only have visibility into the CUDA memory that is allocated and managed through the PyTorch allocator."* NCCL buffers are invisible — a classic "my memory doesn't add up" cause in distributed training.

### Streams

From the "Stream pool note" in `c10/cuda/CUDAStream.h`, verbatim highlights:

> "There are three pools per device, and a device's pools are lazily created. The first pool contains only the default stream. … The second pool is the 'low priority' or 'default priority' streams. … There are **32** of these streams per device, and when a stream is requested one of these streams is returned round-robin. … This means that **if 33 low priority streams are requested, the first and last streams requested are actually the same stream** (under the covers) and kernels enqueued on them cannot run concurrently. … The third pool is the 'high priority' streams."

> "although the notion of 'current stream for device' is thread local (every OS thread has a separate current stream, as one might expect), the stream pool is **global** across all threads; stream 0 is always stream 0 no matter which thread you use it on. … streams are thread safe; e.g., it is safe to enqueue a kernel on the same stream from two different threads."

```cpp
constexpr int kStreamsPerPoolBits = 5;
constexpr int kStreamsPerPool = 1 << kStreamsPerPoolBits;    // 32
static constexpr int max_compile_time_stream_priorities = 4;
```

A `CUDAStream` is a **64-bit value object** (device index + packed `StreamId`), not a handle — cheap to copy, resolved to a `cudaStream_t` on demand.

**Async w.r.t. the host.** Verbatim: *"When you call a function that uses the GPU, the operations are enqueued to the particular device, but not necessarily executed until later."* Every op you write in Python returns as soon as `cudaLaunchKernel` returns. The tensor's storage is valid; its *contents* are a promise. **Therefore any timing that does not use events or an explicit sync is measuring launch throughput, not compute.** The correct idiom:

```python
start_event = torch.cuda.Event(enable_timing=True)
end_event   = torch.cuda.Event(enable_timing=True)
start_event.record()
# ... work ...
end_event.record()
torch.cuda.synchronize()          # Wait for the events to be recorded!
elapsed_ms = start_event.elapsed_time(end_event)
```

**Backward and streams.** *"Each backward CUDA op runs on the same stream that was used for its corresponding forward op."* Implemented by `InputMetadata::stream()` + `Node::stream()` + the event waits in `evaluate_function` (§2.4). `Note [Streaming backwards]` gives the contract: the engine remembers the caller's current streams and the "leaf streams", and syncs them in post-processing. Hence the docs' unsafe/safe pair:

```python
# unsafe
with torch.cuda.stream(s):
    loss.backward()
use_grads()

# safe
with torch.cuda.stream(s):
    loss.backward()
torch.cuda.current_stream().wait_stream(s)
use_grads()
```

### From `at::mul` to `cudaLaunchKernel`

The full path for `a * b` on CUDA, which is worth walking once end to end because it links every section of this report:

1. `Tensor.__mul__` → `THPVariable_mul` (generated `python_variable_methods.cpp`) → `at::mul`.
2. Dispatcher computes the key set; highest bit is `AutogradCUDA` → **`VariableType::mul_Tensor`** (§2.4) builds `MulBackward0`.
3. Redispatch below autograd → `ADInplaceOrView` (fallthrough for out-of-place `mul`) → the structured meta function: broadcast shape, common dtype, allocate output, **build a `TensorIterator`**.
4. `TensorIteratorBase::build()` does, in order: `compute_strides` → **`reorder_dimensions()`** ("reorders dimensions to improve coalescing") → common-dtype computation → allocate outputs → **`coalesce_dimensions()`**. A fully contiguous N-D elementwise op **collapses to 1-D.** `can_use_32bit_indexing()` decides `int32` vs `int64` offset arithmetic.
   *This is the same idea as NumPy's `NpyIter` axis coalescing and reordering (§1.5) — say so explicitly; it is one of the strongest structural parallels in the whole curriculum.*
5. `mul_stub` → `at::native::mul_kernel_cuda`:
   ```cpp
   AT_DISPATCH_ALL_TYPES_AND_COMPLEX_AND3(kHalf, kBFloat16, kBool, iter.common_dtype(), "mul_cuda", [&]() {
     using opmath_t = at::opmath_type<scalar_t>;
     opmath_symmetric_gpu_kernel_with_scalars<scalar_t>(iter, binary_internal::MulFunctor<opmath_t>());
   });
   ```
   — note `opmath_type`: fp16 inputs, fp32 accumulation.
6. `gpu_kernel` (`aten/src/ATen/native/cuda/Loops.cuh`):
   ```cpp
   if (iter.numel() == 0) return;
   if (!iter.can_use_32bit_indexing()) {
     for (auto& sub_iter : iter.with_32bit_indexing()) gpu_kernel(sub_iter, f);   // ≥2^31 elems → split
     return;
   }
   gpu_kernel_impl(iter, f);
   ```
7. `gpu_kernel_impl`: `if (!needs_dynamic_casting<func_t>::check(iter)) return gpu_kernel_impl_nocast(iter, f);` then `bool contiguous = iter.is_contiguous();` chooses `launch_vectorized_kernel` (contiguous) vs an offset-calculator kernel (strided).

**Launch configuration** (`aten/src/ATen/native/cuda/thread_constants.h`):

```cpp
#if defined(USE_ROCM)
constexpr int num_threads() { return 256; }
constexpr int thread_work_size() { return 4; }
#else
constexpr uint32_t num_threads() { return C10_WARP_SIZE * 4; }   // 128 on NVIDIA
constexpr int thread_work_size() { return 8; }
#endif
constexpr int block_work_size() { return thread_work_size() * num_threads(); }
```

And the vectorisation choice:

```cpp
const uint16_t max_vec_size = memory::can_vectorize_up_to<func_t>(data);
uint16_t vec_size = 16 / static_cast<uint16_t>(sizeof(cpp_type));   // target 128-bit accesses
vec_size = std::min<uint16_t>(vec_size, max_vec_size);
// due to excessive binary size the `vectorized_elementwise_kernel` of size 8 is compiled for sm_90 and sm_10x only.
if (p->major != 9 && p->major != 10) vec_size = std::min<uint16_t>(vec_size, 4);
int64_t grid = (N + bws - 1) / bws;
vectorized_elementwise_kernel<4, func_t, array_t><<<grid, num_threads(), 0, stream>>>(N, f, data);
```

So the famous **4-wide vectorized load** is just `16 / sizeof(float) = 4` → `float4`, i.e. one 128-bit `LDG.E.128` per thread per operand. For `half`/`bfloat16` it wants 8 but is clamped to 4 below sm_90. Kernels carry `C10_LAUNCH_BOUNDS_1(num_threads())`. `<<<grid, block, 0, stream>>>` lowers to `cudaLaunchKernel(func, grid, block, args, 0, stream)`, with `stream = at::cuda::getCurrentCUDAStream()` (thread-local).

**Launch overhead.** The CUDA-graphs blog states the problem qualitatively:

> "Modern DL frameworks have complicated software stacks that incur significant overheads associated with the submission of each operation to the GPU. When DL workloads are strong-scaled to many GPUs for performance, the time taken by each GPU operation diminishes to just a few microseconds and, in these cases, the high work submission latencies of frameworks often lead to low utilization of the GPU."

> **Flagged.** The specific "~3–10 µs per launch" figure is **not** stated in any PyTorch doc, blog or source file. What *is* verified is what CUDA graphs elide: *"a graph replay skips all layers of argument setup and kernel dispatch, including Python, C++, and CUDA driver overheads."* **Teach the *structure* of the cost** — Python binding + `PythonArgParser` → dispatch key computation → `VariableType` wrapper + `grad_fn` construction → `TensorIterator` build → `cudaLaunchKernel` — and have students measure the total on their own hardware with an empty-kernel microbenchmark. That is a better exercise than memorising a number anyway.

**CUDA graphs as the amortisation.** Note the interlock with the allocator, which is the interesting engineering:

```cpp
// capture_begin
c10::cuda::CUDACachingAllocator::beginAllocateToPool(capture_dev_, mempool_id_, ...);
AT_CUDA_CHECK(cudaStreamBeginCapture(capture_stream_, capture_mode));
c10::cuda::CUDACachingAllocator::markCaptureBegin(capture_dev_);
// capture_end
cudaStreamEndCapture(capture_stream_, &graph_);
c10::cuda::CUDACachingAllocator::endAllocateToPool(capture_dev_, mempool_id_);
cudaGraphInstantiateWithFlags(&graph_exec_, graph_, cudaGraphInstantiateFlagAutoFreeOnLaunch);
// replay
cudaGraphLaunch(graph_exec_, at::cuda::getCurrentCUDAStream());
```

Docs: *"The virtual addresses used by the graph must be reserved for the graph across replays. The PyTorch caching allocator achieves this by detecting when capture is underway and satisfying the capture's allocations from a graph-private memory pool."* That is the `PrivatePool` machinery in `get_pool`.

Constraints, all verbatim: *"Capture must occur on a non-default stream."* / *"Ops that synchronize the CPU with the GPU (e.g., `.item()` calls) are prohibited."* / *"Dynamic control flow (based on CPU or GPU data) is prohibited, unless it is based on GPU data and implemented via higher order operator torch.cond()."* / *"Dynamic shapes are prohibited. The graph assumes every tensor in the captured op sequence has the same size and layout in every replay."*

Measured results from the PyTorch blog:

| Workload | GPUs | Speedup |
|---|---|---|
| Mask R-CNN (MLPerf v1.0) | 272 | **1.70×** |
| BERT (MLPerf v1.0) | 4096 | **1.12×** |

and, on the graphed region alone: *"The graphed portion now runs in 6 ms instead of 31 ms, a speedup of 5×. We did not graph the entire model, mostly just the resnet backbone, which resulted in an overall speedup of ~1.7×."* Also worth quoting because it makes the sync lesson concrete: capture required removing syncs — *"this work included changing the implementation of `torch.randperm` function to use CUB instead of Thrust because the latter is a synchronous C++ template library."* The effect is largest at small batch sizes.

API: raw `torch.cuda.CUDAGraph`, the `torch.cuda.graph(g, pool=...)` context manager, and `torch.cuda.make_graphed_callables(module, sample_args)` which is autograd-aware (the backward is graphed too). Warmup must be ≥ ~3 iterations **on a side stream**.

### Why `.item()` destroys throughput

`.item()` on CUDA lands in `aten/src/ATen/native/cuda/CUDAScalar.cu`:

```cpp
// Create pinned memory for the scalar value to avoid implicit
// locking/sync in cuda library due to pageable memory
auto value = at::detail::empty_cpu({1}, ..., /*pin_memory=*/true, ...);
cudaStream_t stream = at::cuda::getCurrentCUDAStream();
at::cuda::memcpy_and_sync(value.template mutable_data_ptr<scalar_t>(),
                          self.template const_data_ptr<scalar_t>(),
                          sizeof(scalar_t), cudaMemcpyDeviceToHost, stream);
```

and `memcpy_and_sync` (`c10/cuda/CUDAFunctions.h`) is:

```cpp
if (C10_UNLIKELY(warning_state().get_sync_debug_mode() != SyncDebugMode::L_DISABLED))
  warn_or_error_on_sync();
...
C10_CUDA_CHECK(cudaMemcpyAsync(dst, src, nbytes, kind, stream));
C10_CUDA_CHECK(cudaStreamSynchronize(stream));      // ← the stall
```

**`cudaStreamSynchronize` blocks the CPU until every kernel previously enqueued on that stream has retired.** The CPU stops running ahead, and the launch pipeline that was hiding per-op CPU cost behind GPU execution collapses. In a step that issues 2,000 kernels, one `.item()` per iteration converts a pipelined schedule into a serialised one.

The full list of implicit synchronisation points, worth putting on one slide:

| Category | Examples | Why |
|---|---|---|
| Explicit scalar read | `.item()`, `float(t)`, `int(t)`, `bool(t)` | D2H copy of one element + sync |
| Python truth-testing | `if t:`, `while t:`, `assert t` | calls `__bool__` → `item()` |
| Formatting | `print(t)`, `repr(t)`, f-strings | reads the data |
| Bulk transfer | `.cpu()`, `.numpy()`, `.tolist()` | D2H; `.numpy()` additionally requires completion |
| **Data-dependent output shape** | `t.nonzero()`, `torch.unique`, `masked_select`, boolean-mask indexing | **the CPU must learn the output size before it can allocate** |

That last row is the one people miss, and it is the most interesting: the sync is not a design flaw, it is forced by the fact that the host allocator must know a size that only the device knows.

**The tools:**

- `torch.cuda.set_sync_debug_mode("warn" | "error")` — implemented as the `C10_UNLIKELY` branch at the top of `memcpy_and_sync`/`stream_synchronize`. Caveat, verbatim: *"not all synchronizing operations will trigger warning or error"* — `torch.distributed` and `torch.sparse` are not covered.
- `CUDA_LAUNCH_BLOCKING=1`. Docs: *"such an error isn't reported until after the operation is actually executed, so the stack trace does not show where it was requested."* Without it, an out-of-bounds index in kernel #37 surfaces at whatever unrelated call happens to sync next — often `.item()` or the next allocation — and the Python traceback points at innocent code. With it, every launch is followed by a sync, so the error is attributed correctly, at large throughput cost. Debug-only.

### Kernel fusion, stated as a bandwidth argument

An elementwise chain like `y = torch.relu(a * b + c)` runs, in eager, as three separate `vectorized_elementwise_kernel` launches. Each one reads its inputs from HBM into registers, does a handful of FLOPs, and **writes back to HBM** — and the next kernel reads that back.

The relevant quantity is **arithmetic intensity**: FLOPs per byte of HBM traffic. An fp32 multiply does 1 FLOP per 12 bytes (two 4-byte loads, one 4-byte store) → AI ≈ 0.083. Contemporary datacenter GPUs have ridge points in the hundreds of FLOP/byte. Anything with AI far below the ridge point is, by the roofline model, **purely bandwidth-bound**: the ALUs idle waiting on memory, and runtime is `bytes_moved / achievable_bandwidth`, essentially independent of the arithmetic.

Therefore fusing `N` elementwise ops into one kernel gives, to first order, an **N× speedup on that chain — not because it saves FLOPs (it saves none) but because it turns N round trips to HBM into 1.** This is why Inductor spends nearly all of its scheduling effort on elementwise/reduction fusion, and equally why **fusion buys almost nothing around a large GEMM** (AI ≈ O(k), already compute-bound, already on the flat part of the roofline).

Second-order benefit, real but smaller: fusion also removes N−1 kernel launches, which matters exactly in the launch-bound regime above. So fusion and CUDA graphs are **complementary, not redundant**: fusion cuts bytes *and* launches; graphs cut only launches.

> **Flagged.** No PyTorch-official published number for elementwise-fusion speedup was found. The roofline argument above is standard GPU-performance reasoning, not a quotation. For a citable measured number, generate it: time a 5-deep `a*b+c` chain eager vs `torch.compile`d at fixed size and read effective bytes/s off an event timer. That is exercise P8 anyway.
## 2.6 `torch.compile`

Everything up to here has been eager mode, and eager mode has exactly two costs: **per-operator CPU overhead** (§2.2's dispatch chain plus §2.5's launch path) and **per-operator memory traffic** (§2.5's fusion argument). `torch.compile` exists to delete both. Read it that way and every design decision follows.

The three components, in PyTorch's own words:

- **TorchDynamo** — *"uses a CPython feature called the Frame Evaluation API to safely capture PyTorch graphs"*
- **AOTAutograd** — *"captures not only the user-level code, but also backpropagation, which results in capturing the backwards pass 'ahead-of-time'"*
- **TorchInductor** — *"the default torch.compile deep learning compiler that generates fast code for multiple accelerators and backends"*, and *"for GPUs, it leverages OpenAI Triton as the key building block"*

### TorchDynamo: how it actually intercepts CPython

This is the part worth being precise about, because the usual one-line summary ("it traces your code") is exactly wrong — it does not trace, it *reads bytecode*.

**The mechanism is PEP 523.** PEP 523 (accepted for Python 3.6) added a function pointer to the interpreter state so that a third party can replace CPython's frame evaluator. The modern typedef (CPython 3.13 `Include/cpython/pystate.h`):

```c
typedef PyObject* (*_PyFrameEvalFunction)(PyThreadState *tstate,
                                          struct _PyInterpreterFrame *, int);
PyAPI_FUNC(void) _PyInterpreterState_SetEvalFrameFunc(PyInterpreterState *interp,
                                                      _PyFrameEvalFunction eval_frame);
```

PyTorch's shim is `torch/csrc/dynamo/eval_frame.c`. Verified first-hand:

```c
static void enable_eval_frame_shim(PyThreadState* tstate) {
  if (_PyInterpreterState_GetEvalFrameFunc(tstate->interp) != &dynamo_custom_eval_frame_shim) {
    previous_eval_frame = _PyInterpreterState_GetEvalFrameFunc(tstate->interp);
    _PyInterpreterState_SetEvalFrameFunc(tstate->interp, &dynamo_custom_eval_frame_shim);
  }
}
```

Three details worth teaching, all visible in that function:

1. **It saves and chains.** The fallthrough path is
   ```c
   if (previous_eval_frame) return previous_eval_frame(tstate, frame, throw_flag);
   else                     return _PyEval_EvalFrameDefault(tstate, frame, throw_flag);
   ```
   so Dynamo composes with whatever hook was already installed (coverage tools, profilers) rather than clobbering it.
2. **The callback is thread-local**, not global: `static Py_tss_t eval_frame_callback_key = Py_tss_NEEDS_INIT;`. Compilation is per-thread state, like `GradMode` (§2.4). The same three-state idea keeps recurring in this codebase.
3. **It is a three-way switch**, with PyTorch's own comment:
   ```c
   // Shims logic into one of three states. ...
   //  - None: disables TorchDynamo
   //  - False: run-only mode (reuse existing compiles)
   //  - Python callable(): enables TorchDynamo
   PyObject* callback = eval_frame_callback_get();
   if (Py_IsNone(callback)) return dynamo_eval_frame_default(tstate, frame, throw_flag);
   return dynamo__custom_eval_frame(tstate, frame, throw_flag, callback);
   ```

**Where the cache lives.** Dynamo claims a per-code-object storage slot at import time:

```c
#if IS_PYTHON_3_12_PLUS
#define _PyEval_RequestCodeExtraIndex PyUnstable_Eval_RequestCodeExtraIndex
#endif
PyObject* torch_c_dynamo_eval_frame_init(void) {
  extra_index = _PyEval_RequestCodeExtraIndex(destroy_extra_state);
  ...
  int result = PyThread_tss_create(&eval_frame_callback_key);
  eval_frame_callback_set(Py_None);
}
```

`_PyEval_RequestCodeExtraIndex` (PEP 523's other half) reserves an index into a per-`PyCodeObject` void-pointer array. So **the compiled artifact and its guards hang directly off the code object**, and the cache lookup on re-entry is an array index, not a dict hash. That is why the steady-state overhead of a compiled function is small.

The frame itself is exposed back to Python as `torch._C._dynamo.eval_frame._PyInterpreterFrame`, with getters for `f_globals`, `f_builtins`, `f_locals`, `f_code`, `f_lasti`, `f_lineno`, `f_back`, `closure`. Everything above that C boundary — and it is the overwhelming majority of Dynamo — is Python.

> **The maintenance cost is visible in the file, and it is the honest counterweight to all of this.** In roughly 900 lines, version guards for `IS_PYTHON_3_11_PLUS`, `_3_12_PLUS`, `_3_13_PLUS`, `_3_14_PLUS` and `_3_16_PLUS` appear about twenty times, and the entire shim is wrapped in:
> ```c
> // 3.16 Not supported at all. See cpython_defs.c for hints
> #if !(IS_PYTHON_3_16_PLUS)
> ```
> **On Python 3.16 the eval-frame approach is currently not supported at all.** PEP 523 buys transparent interception; the price is a permanent, load-bearing dependency on CPython's private frame internals, renegotiated every release. Show students this guard. It is the single best argument for why JAX chose the easier road, and simultaneously for why PyTorch's road was worth taking anyway.

### Symbolic evaluation: `VariableTracker` and the FX graph

Having got the frame, Dynamo **symbolically executes its bytecode**. `InstructionTranslatorBase` in `torch/_dynamo/symbolic_convert.py` *"has about 200 methods, implementing almost all of Python bytecodes"* — it reimplements CPython's stack machine, in Python:

```python
def BUILD_LIST(self, inst):
    items = self.popn(inst.argval)
    self.push(ListVariable(items, mutation_type=ValueMutationNew()))
```

Every value on that modelled stack is a **`VariableTracker`** (`torch/_dynamo/variables/`): `TensorVariable`, `ConstantVariable`, `ListVariable`, `UserDefinedObjectVariable`, and dozens more. `VariableBuilder._wrap` is *"a very long chain of elifs that tries to recursively pattern-match the Python inputs"*. Provenance is tracked by **sources** (`LocalSource`, `GetItemSource`) that *"track how to reconstruct a variable from the original local or global variables"* — which is what makes both guard generation and stack reconstruction possible.

The split that matters: **tensor operations are recorded into an FX graph** (via `OutputGraph`, `fx.Proxy`/`fx.Node`, `create_proxy()`, `wrap_fx_proxy()`); **everything else is evaluated for real, right now, during translation.** A graph holds *"operations on tensors… and operations on symbolic integers"*. So a Python `for` loop over a list of layers is *unrolled at compile time* and vanishes; a `dict` lookup happens once and its result is baked in.

**Correctness comes from guards** — *"an assumption (a boolean expression on an input) made in order to specialize a frame for one set of example inputs"*. Real ones:

```
___check_type_id(L['b'], 94334122025024)
L['b'] == 'Hello'
check_tensor(L['a'], torch.float32, device=None, ...)
2 <= L['a'].size()[0]
L['b'].size()[0] == L['a'].size()[0]
```

Reusing a compiled graph requires **every** guard to pass. Note what those five lines encode: a type identity, a value equality, a tensor's dtype/device/layout, a shape *inequality*, and a *relation between two shapes*. Guards are a small constraint language, and reading a real guard set is the fastest way to understand what Dynamo actually assumed about your code.

### Graph breaks

When Dynamo reaches something it cannot model, it takes a **graph break**: it compiles the prefix, restores the interpreter stack, runs the offending code in real CPython, then jumps into a generated **resume function** — a continuation, named `torch_dynamo_resume_in_<fnname>_at_<lineno>`. (The `__resume_at_<offset>` spelling in older docs and blog posts is stale.)

What causes one:

| Cause | Why |
|---|---|
| **Data-dependent control flow** — `if x.sum() > 0:` | A `POP_JUMP_IF_TRUE` on a **symbolic** value. Dynamo cannot pick a branch without a number only the GPU has. **This is the irreducible one.** |
| `.item()`, `float(t)`, `print(t)` | Forces materialisation of a device value into Python. |
| An opaque C extension | A raw pybind11 function the dispatcher and FX cannot see through — precisely the failure demonstrated in project P5 Round 1. |
| Unsupported builtins / library calls | Anything without a `VariableTracker` model. |

Note the crucial asymmetry: `if cfg["deep"]:` — a jump on a **concrete** Python value — is *not* a break. Dynamo takes the branch, bakes it in, and emits a guard. **Python control flow over Python data is free; over tensor data it is fatal.** That one sentence is the most useful thing a user can know about `torch.compile`, and it falls straight out of the mechanism.

Why breaks matter, in order of severity:
1. **Fusion is lost across the boundary** — the two halves are separate Inductor graphs, so no kernel can span the break. Given §2.5's bandwidth argument, that is the expensive one.
2. **CUDA graphs are lost** (`mode="reduce-overhead"` needs a whole region with no host interaction).
3. **You re-enter the eager dispatcher** for the broken-out code, paying §2.2's overhead again.

Tools: `torch._dynamo.explain(fn)(*args)` for a break report; `fullgraph=True` to turn breaks into errors; `TORCH_LOGS=graph_breaks`; `torch._dynamo.config.suppress_errors`.

### Dynamic shapes

Static by default. On a shape change, Dynamo *"will trace it and generate a graph generic on that variable"* using `torch.SymInt`. Two rules with real consequences:

- **0/1 specialization** — *"if we pass an input where that dimension is 0 or 1, Dynamo will trace it as non-dynamic and it will generate a specific graph for it."* The reason is that empty-tensor and broadcast/stride semantics genuinely differ at 0 and 1 (see §1.3's contiguity quirk — a size-1 axis's stride is *arbitrary*). You cannot write one generic kernel that is correct at 1 and at 100.
- **Duck shaping** — *"If two dynamic integers have the same value at trace time, we will assume that they are equal and guard on it."* Hence `L['b'].size()[0] == L['a'].size()[0]` in the guard list above.

Control with `torch._dynamo.mark_dynamic` / `maybe_mark_dynamic` / `mark_static`, or `torch.compile(dynamic=True)`. Repeated recompilation is bounded by `torch._dynamo.config.cache_size_limit`; exceeding it falls back to eager. `TORCH_LOGS=recompiles` tells you why each recompile happened — and "why" is always "a specific guard failed", which is a satisfying thing for a student to see.

### AOTAutograd

Dynamo produces a **forward** graph. AOTAutograd (`torch/_functorch/aot_autograd.py`) turns that into a forward *and* a backward graph, ahead of time. It does this by running the forward under `__torch_dispatch__` — i.e. by re-entering the dispatcher at the `Python` key from §2.2 — so it observes the **post-autograd** ATen ops, not the Python-level calls.

Three jobs:

1. **Functionalization.** Remove mutations and aliasing so the graph is a pure dataflow graph. This is the `Functionalize` dispatch key doing exactly what its name says — another payoff from the dispatcher design.
2. **Decomposition** into "core ATen"/prim ops, so a backend implements a few hundred primitives instead of two thousand operators.
3. **Partitioning.** Split the joint forward+backward graph into two, deciding which intermediates to **save** and which to **recompute**. The default is a **min-cut** partitioner: the cut through the joint graph that minimises saved-activation bytes subject to a recomputation budget.

That third job deserves emphasis, because it closes a loop opened in §2.4 and §3.5. Recall from `derivatives.yaml` that `mul` must save both operands while `sum` saves only a shape, and from JAX's cost model that *"reverse mode … memory scales with the depth of the computation"*. **Activation checkpointing is the manual version of this trade. The min-cut partitioner is the same trade, done automatically, as a compiler pass over the joint graph.** A student who has built P2b and tabulated which ops save what will find this obvious rather than magical — which is exactly the point of building it.

### TorchInductor and Triton

Inductor lowers the ATen graph to a **loop-level, define-by-run IR**, schedules and fuses it, plans buffers and reuse, and then generates source code: **Triton for GPU, C++/OpenMP for CPU.**

The fusion decisions are the whole value, and they are the §2.5 argument mechanised: chains of elementwise ops with no intervening reduction become one kernel, so N round trips to HBM become 1. Reductions fuse with their elementwise producers and consumers. Reads and writes are counted; the scheduler is essentially minimising bytes moved.

**Why generate Triton instead of CUDA C?** Because Triton's programming model is *block-level*, not thread-level. You write:

```python
@triton.jit
def fused_relu_add(in0, in1, out, n, BLOCK: tl.constexpr):
    pid  = tl.program_id(0)
    offs = pid * BLOCK + tl.arange(0, BLOCK)
    mask = offs < n
    a = tl.load(in0 + offs, mask=mask)
    b = tl.load(in1 + offs, mask=mask)
    tl.store(out + offs, tl.maximum(a + b, 0.0), mask=mask)
```

There are no threads here, no `threadIdx`, no shared-memory declarations, no explicit vectorisation. You describe what one *block* does to one *tile*; the Triton compiler (Python DSL → MLIR → LLVM → PTX) chooses the intra-block thread mapping, the vector widths, the shared-memory staging, and the software pipelining. For a code *generator*, that is decisive: emitting correct, reasonably fast block-level code is tractable; emitting correct, reasonably fast *thread-level* CUDA C with coalescing and bank-conflict avoidance and register blocking is a research project. **Triton is the abstraction level at which a compiler can be a competent CUDA programmer.**

Say this to a class that has just finished the CUDA unit and it lands hard: Triton is precisely the set of decisions they spent that unit learning to make by hand, handed to a compiler.

Inspecting the output is the exercise:

```bash
TORCH_COMPILE_DEBUG=1 python train.py       # dumps the generated Triton/C++ and the IRs
```

or `torch._inductor.config.trace.enabled = True`. Read the generated kernel and count `tl.load`/`tl.store` — one store for a fused chain is the proof that fusion happened.

**Compile modes:**

| Mode | What it adds |
|---|---|
| default | Dynamo + AOTAutograd + Inductor fusion |
| `reduce-overhead` | **plus CUDA graphs** — attacks launch overhead (§2.5) rather than bandwidth. Best on small models where launches dominate. |
| `max-autotune` | **plus benchmarked kernel selection** — Triton GEMM/conv templates are compiled at several tilings and timed against cuBLAS/cuDNN, and the winner is kept. Long compile, best steady-state. |

Notice that `reduce-overhead` and `max-autotune` target the *two different costs* named at the top of this section. Framing the modes that way makes the choice obvious instead of arbitrary.

### Writing an extension

Two ways, and the difference is the entire lesson of §2.2.

**The naive way — a pybind11 function.**

```cpp
// fused_gelu.cu
#include <torch/extension.h>
#include <ATen/cuda/CUDAContext.h>

template <typename scalar_t>
__global__ void fused_gelu_kernel(const scalar_t* __restrict__ x,
                                  const scalar_t* __restrict__ b,
                                  scalar_t* __restrict__ out, int n, int cols) { /* ... */ }

at::Tensor fused_gelu_cuda(const at::Tensor& x, const at::Tensor& bias) {
  TORCH_CHECK(x.is_cuda(), "x must be a CUDA tensor");
  TORCH_CHECK(x.scalar_type() == bias.scalar_type(), "dtype mismatch");
  auto xc = x.contiguous();
  auto out = at::empty_like(xc);
  const int threads = 256, blocks = (xc.numel() + threads - 1) / threads;
  AT_DISPATCH_FLOATING_TYPES_AND2(at::kHalf, at::kBFloat16, xc.scalar_type(), "fused_gelu", [&] {
    fused_gelu_kernel<scalar_t><<<blocks, threads, 0, at::cuda::getCurrentCUDAStream()>>>(
        xc.data_ptr<scalar_t>(), bias.data_ptr<scalar_t>(),
        out.data_ptr<scalar_t>(), xc.numel(), xc.size(-1));
    C10_CUDA_KERNEL_LAUNCH_CHECK();
  });
  return out;
}

PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) {
  m.def("fused_gelu", &fused_gelu_cuda, "fused bias+GELU (CUDA)");
}
```

Built either ahead of time —

```python
# setup.py
from torch.utils.cpp_extension import CUDAExtension, BuildExtension
setup(name="myops",
      ext_modules=[CUDAExtension("myops", ["fused_gelu.cu"])],
      cmdclass={"build_ext": BuildExtension})
```

— or JIT, which is what you want for a course:

```python
from torch.utils.cpp_extension import load
myops = load(name="myops", sources=["fused_gelu.cu"], verbose=True)
```

`load` / `load_inline` shell out to `ninja`, cache in `TORCH_EXTENSIONS_DIR`, and hand you an imported module. The idioms to know: `TORCH_CHECK(cond, msg)` for validation (it raises a Python exception, not an abort); `AT_DISPATCH_FLOATING_TYPES_AND2(kHalf, kBFloat16, ...)` for the dtype switch (§2.2's *second* dispatch); `.data_ptr<scalar_t>()` or `packed_accessor32<scalar_t,2,at::RestrictPtrTraits>()` for indexing; `at::cuda::getCurrentCUDAStream()` so you land on the *right* stream (§2.5); and `C10_CUDA_KERNEL_LAUNCH_CHECK()` immediately after the launch, because a launch failure is otherwise reported at some later, unrelated sync.

**And it works — and it is invisible to everything.** It has no gradient, no shape rule, and no dispatcher entry:

```python
y = myops.fused_gelu(x, b)
y.sum().backward()                       # RuntimeError: does not require grad
torch.compile(f, fullgraph=True)(x, b)   # graph break: opaque call
x.to("meta")                             # no meta kernel, cannot propagate shapes
```

**The dispatcher way.** Declare a schema, register per-key implementations, and add a fake/meta kernel:

```cpp
TORCH_LIBRARY(myops, m) {
  m.def("fused_gelu(Tensor x, Tensor bias) -> Tensor");
  m.def("fused_gelu_backward(Tensor grad, Tensor x, Tensor bias) -> (Tensor, Tensor)");
}
TORCH_LIBRARY_IMPL(myops, CUDA, m) { m.impl("fused_gelu", fused_gelu_cuda); }
TORCH_LIBRARY_IMPL(myops, CPU,  m) { m.impl("fused_gelu", fused_gelu_cpu);  }  // reference impl
TORCH_LIBRARY_IMPL(myops, Autograd, m) { m.impl("fused_gelu", fused_gelu_autograd); }
```

with a `torch::autograd::Function` behind the `Autograd` cell (§2.2), and a Python-side shape rule:

```python
@torch.library.register_fake("myops::fused_gelu")
def _(x, bias):
    torch._check(x.shape[-1] == bias.shape[0])
    return torch.empty_like(x)
```

(Or do the whole thing from Python with `@torch.library.custom_op("myops::fused_gelu", mutates_args=())`.)

**Now all three failures become successes, and each for a specific, nameable reason:**

| Capability | Why it works now |
|---|---|
| `backward()` | There is a kernel at the `Autograd` key, so the dispatcher routes through it and builds a `Node` (§2.4). |
| `torch.compile(fullgraph=True)` | The op has a **schema**, so Dynamo can represent it as a single FX node instead of an opaque call — no graph break. |
| `meta` device, `FakeTensor`, `vmap` | The registered fake kernel gives shape propagation without executing; AOTAutograd needs exactly this to trace ahead of time. |
| `torch.export`, functionalization | The schema's alias annotations (`Tensor(a!)`) tell the system whether you mutate or alias. |

**That table is the payoff of §2.2 and the reason to teach the dispatcher before anything else.** "Register through the dispatcher" is not bureaucratic ceremony; it is the difference between a function Python can call and an *operator the framework understands*.

Verify with `torch.library.opcheck(...)` and `torch.autograd.gradcheck(..., dtype=torch.float64)`.
### 2.6.1 Why the schema is what stops the graph break — the mechanism

The claim "a registered op doesn't graph-break" is not a heuristic. It is two lines in `torch/_dynamo/trace_rules.py`:

```python
def is_aten_op_or_tensor_method(obj) -> bool:
    return obj in get_tensor_method() or isinstance(
        obj, (torch._ops.OpOverloadPacket, torch._ops.OpOverload))
```

and, as **step 1** of `_lookup_inner`:

```python
if obj is not None:
    if is_aten_op_or_tensor_method(obj):
        return TorchInGraphFunctionVariable
```

An `OpOverload`/`OpOverloadPacket` is *unconditionally* in-graph — it becomes a `call_function` FX node with the `OpOverload` as target, guarded by `GuardBuilder.BUILTIN_MATCH`. A raw pybind11 `builtin_function_or_method` matches nothing in steps 1–2, falls through to `check_file(getfile(obj))` where `inspect.getfile` raises `TypeError` on a builtin, and becomes a `SkipFunctionVariable` — which is exactly what a graph break is.

**The footgun to warn students about: `torch._dynamo.allow_in_graph` looks like the fix and is not.** It only adds `id(fn)` to `trace_rules._allowed_callable_ids`. Its own docstring says *"WARNING: this API can be a footgun, please read the documentation carefully."* The break disappears; the node stays an opaque Python callable, and four things downstream are now broken or silently wrong:

1. **AOTAutograd traces under `FakeTensorMode`.** Your function is called with `FakeTensor`s. It either dies on `data_ptr()` (no storage) or — worse — succeeds and has its output metadata *invented* rather than derived. There is no meta kernel to substitute, because the function is not in the dispatcher.
2. **No `grad_fn`.** Gradients silently stop. You don't even get the fallback warning below, because that fallback lives on `AutogradXXX` keys that were never consulted.
3. **Functionalization cannot see mutations.** A raw pointer write into a tensor's storage is invisible to `FunctionalTensorMode`, and the compiled graph may already have cloned or reused that buffer. This is a **silent-wrong-answer** class of bug, the worst kind.
4. **`torch.export` cannot serialise it** — export requires every `call_function` target to be a resolvable `OpOverload` with a schema.

### 2.6.2 Functionalization needs the schema's alias annotations — literally

`aten/src/ATen/FunctionalizeFallbackKernel.cpp`, verbatim, and it is the most direct possible answer to "why does the schema DSL have `Tensor(a!)` in it":

```cpp
void functionalizeFallback(const c10::OperatorHandle& op, c10::DispatchKeySet, torch::jit::Stack* stack) {
  const auto& schema = op.schema();
  TORCH_CHECK(
    !schema.hasAnyAliasInfo(),
    "Found a custom (non-ATen) operator whose output has alias annotations: ", op.schema(),
    ". We only support functionalizing operators whose outputs do not have alias annotations "
    "(e.g. 'Tensor(a)' is a Tensor with an alias annotation whereas 'Tensor' is a Tensor without...). "
    "Please check if (1) the output needs to be an output ..., (2) if the output doesn't share storage "
    "with any inputs, then delete the alias annotation. (3) if the output indeed shares storage with an "
    "input, then add a .clone() before returning it ...");
  ...
}
```

The fallback unwraps `FunctionalTensor`s off the stack, calls the op under `AutoDispatchSkipFunctionalize`, and re-wraps. Declared input mutations (`Tensor(a!)`) are handled by the `auto_functionalize` higher-order op — possible **only because the schema names which arguments are written.** A pybind function has no schema, so neither path can exist. Link this back to §2.1: the alias annotations in `native_functions.yaml` are not documentation, they are the input to a compiler pass.

### 2.6.3 The autograd fallback is already installed

A detail that changes the failure you actually observe. `aten/src/ATen/core/VariableFallbackKernel.cpp` registers `basicAutogradNotImplementedFallback()` as a **whole-column fallback** (§2.2) on `AutogradCPU`, `AutogradCUDA`, `AutogradXLA`, `AutogradOther`, … So an op you `TORCH_LIBRARY`-def'd but gave no `Autograd` kernel does not fail cleanly — it warns and continues:

> "…: an autograd kernel was not registered to the Autograd key(s) but we are trying to backprop through it. **This may lead to silently incorrect behavior.** … If your operator is not differentiable, or to squash this warning and use the previous behavior, please register `torch::CppFunction::makeFallthrough()` to `DispatchKey::Autograd`."

Default mode is `Warn` (`AutogradFallbackMode::{Nothing, Warn, Error}`; `Error` is `NYI`). Toggle with `torch._C._set_autograd_fallback_mode("nothing"|"warn")`.

So the correct declaration for a genuinely non-differentiable op is explicit, not empty:

```cpp
TORCH_LIBRARY_IMPL(myops, Autograd, m) { m.impl("myop", torch::CppFunction::makeFallthrough()); }
```

**Note the asymmetry, because it is a good exam question.** A *raw pybind function* has no `grad_fn` at all and `backward()` raises "does not require grad". A *dispatcher-registered op missing its Autograd cell* hits this fallback and merely warns. Same bug, two very different symptoms, and the second is more dangerous.

### 2.6.4 The Python-side API, precisely

`torch.library.custom_op` is the modern entry point:

```python
def custom_op(name, fn=None, /, *, mutates_args, device_types=None, schema=None, tags=None)
```

- `name` is `"{namespace}::{name}"`.
- **`mutates_args` is required** — an iterable of argument names, or the literal `"unknown"` for pessimistic all-mutating. The docs: *"This MUST be accurate, otherwise, the behavior is undefined."* It is load-bearing: the generated `ADInplaceOrView` kernel does `increment_version()` on each named argument and then `op.redispatch(keyset & _after_ADInplaceOrView_keyset, ...)`. Get it wrong and the version-counter machinery from §2.4 silently stops protecting you.
- `schema=None` (recommended) infers from type hints via `torch.library.infer_schema`; an explicit schema is cross-validated against `mutates_args` and mismatches raise.
- `device_types=None` maps to the **`CompositeExplicitAutograd`** key (all backends), not to a specific one.
- Every `custom_op` gets `torch.Tag.pt2_compliant_tag` prepended — the marker Dynamo and export use to know the op was authored under the contract.

Registering it also auto-wires the dispatcher entries: the schema `def`, a fake-impl check, `lib.impl(name, autograd_impl, "Autograd", with_keyset=True)`, and an `ADInplaceOrView` kernel if the schema is a view or is mutable.

`register_fake` (the **current** name — `impl_abstract` is deprecated with a `FutureWarning`):

```python
@torch.library.register_fake("myops::fused_gelu")
def _(x, bias):
    torch._check(x.shape[-1] == bias.shape[0])
    return torch.empty_like(x)
```

> *"The FakeTensor implementation must consist of only PyTorch operations (and may not directly access the storage or data of any input or intermediate Tensors)."*

Use `torch._check`, **not** `assert` — it lowers to a guard or runtime assert under dynamic shapes instead of being traced away.

For a **data-dependent output shape** (a `nonzero`-like op), the fake kernel mints an unbacked symint:

```python
@torch.library.register_fake("myops::custom_nonzero")
def _(x):
    ctx = torch.library.get_ctx()
    nnz = ctx.new_dynamic_size()                 # -> torch.SymInt
    return x.new_empty([nnz, x.dim()], dtype=torch.int64)
```

with the docstring's warning: *"It is important that the `min` and `max` (if not None) values are set correctly, otherwise, there will be undefined behavior under torch.compile."* Requires `torch._dynamo.config.capture_dynamic_output_shape_ops = True`. (`create_unbacked_symint` is the older name and defaulted `min=2`; `new_dynamic_size` defaults `min=0`.) **This is the compile-time counterpart of §2.5's "data-dependent output shape forces a sync"** — eager must synchronise to learn the size; compiled must carry it as an unbacked symbol. Teach the two together.

`register_autograd` refuses three things at registration time, and each refusal is informative: `torch.Tag.out` ops ("Out variants do not support autograd"), **any non-functional schema** ("Please create a functional operator and register an autograd formula for that"), and kwarg-only tensors. Note that the backward should call *other registered ops*, not raw kernels — that is what makes double-backward and `torch.compile` composability work.

**`torch.library.opcheck`** is the acceptance test, and it is explicitly *orthogonal* to `gradcheck`. Four suites: `test_schema` (does the impl actually mutate what the schema claims, and return fresh tensors when it says so), `test_autograd_registration`, `test_faketensor` (fake vs real metadata identical), `test_aot_dispatch_dynamic` (end-to-end eager-vs-compile, exercising functionalization and backward under fake tensors). Run both.

**Composite keys, in one table**, since they are the most common source of confusion:

| Key | Means |
|---|---|
| `CompositeImplicitAutograd` | A decomposition into differentiable ATen ops; **autograd falls out for free**. The default when no dispatch key is given. |
| `CompositeExplicitAutograd` | ≡ registering to every backend. **Inference only** — you still owe an `Autograd` registration for training. |
| `Meta` | Shape/dtype-only kernel. Registering `Meta` on an op that already has a `CompositeImplicitAutograd` kernel is a hard error ("we should let the operator decompose"). |
| `Autograd` | Alias over all `AutogradXXX`. Don't register per-backend `AutogradCUDA` unless the formulas genuinely differ — `opcheck` flags that as *"may lead to undefined behavior"*. |

Do **not** put both `CompositeExplicitAutograd` and `CompositeImplicitAutograd` on one op; the latter is silently dead.

### 2.6.5 Linkage, and the ABI-stable path

Two practical details that bite anyone shipping an extension.

**`libtorch_python` is linked unless you say otherwise.** `<torch/extension.h>` pulls `<torch/python.h>`, which pulls `libtorch_python` symbols and welds your `.so` to one Python version's PyTorch build. A `TORCH_LIBRARY`-only extension should include only `<torch/library.h>` + `<ATen/ATen.h>`. The docstring for `py_limited_api=True` states the rule outright: *"it is the user's responsibility … to only use APIs from libtorch (aten objects, operators and the dispatcher). **For example, to give access to custom ops from python, the library should register the ops through the dispatcher.**"*

Then the `.so` needs a Python entry point purely so that `import` will `dlopen` it and fire the static initialisers:

```cpp
extern "C" {
  /* Creates a dummy empty _C module that can be imported from Python.
     The import from Python will load the .so consisting of this file
     in this extension, so that the TORCH_LIBRARY static initializers
     below are run. */
  PyObject* PyInit__C(void) {
      static struct PyModuleDef module_def = { PyModuleDef_HEAD_INIT, "_C", NULL, -1, NULL };
      return PyModule_Create(&module_def);
  }
}
```

**`import mypkg._C` and `torch.ops.load_library` are not equivalent.** The latter wraps the load in:

```python
@contextmanager
def dl_open_guard():
    """Context manager to set the RTLD_GLOBAL dynamic linker flag while we open a shared library
    to load custom operators."""
```

`RTLD_GLOBAL` lets later `.so`s resolve against this one and makes cross-`.so` RTTI/`typeid` comparisons (used by dispatcher boxing) work. A plain `import` uses CPython's default `RTLD_LOCAL`. That is fine for `TORCH_LIBRARY` — registration reaches the shared `Dispatcher::singleton()` through `libtorch_cpu.so` — but it breaks cross-extension symbol sharing. Also worth knowing: `cpp_extension.py` emits **no `-fvisibility` flag at all**, so under `RTLD_GLOBAL` two extensions that both vendor the same helper symbol will interpose. Pass `-fvisibility=hidden` yourself if you vendor third-party code.

**How `torch.ops.myops.mymuladd` resolves** (from `torch/_ops.py`'s own docstring):

```
torch.ops       -> _Ops.__getattr__          creates _OpNamespace("myops"), setattr on self
  .myops        -> _OpNamespace.__getattr__  qualified = "myops::mymuladd"
                     torch._C._jit_get_operation(qualname)   # reads Dispatcher::singleton()
                     OpOverloadPacket(...);  setattr(self, op_name, packet)   # memoized
  .default      -> OpOverloadPacket.__getattr__ -> OpOverload
```

Both `__getattr__`s cache via `setattr`, so lookup happens once. Calling the **packet** resolves overloads at call time; calling `.default` calls a specific `OpOverload` — the latter is what you want in library code and what Dynamo puts in the graph.

**The stable-ABI path (new).** `torch/csrc/stable/library.h` adds `STABLE_TORCH_LIBRARY`, `STABLE_TORCH_LIBRARY_IMPL`, `STABLE_TORCH_LIBRARY_FRAGMENT` — the same static-init shape, but taking the dispatch key as a *string* and boxing through a header-only shim:

```cpp
STABLE_TORCH_LIBRARY(extension_cpp, m) { m.def("mymuladd(Tensor a, Tensor b, float c) -> Tensor"); }
STABLE_TORCH_LIBRARY_IMPL(extension_cpp, CUDA, m) { m.impl("mymuladd", TORCH_BOX(&mymuladd_cuda)); }
```

`TORCH_BOX` expands to a `boxer<>` template that unboxes `StableIValue*` → `std::apply` → reboxes, **crossing no `libtorch` C++ symbols**. Combined with `py_limited_api=True`, that is one wheel for every Python version *and* every PyTorch version. Note the direction of travel: **the modern recommendation is `TORCH_LIBRARY` first and pybind11 as the legacy path**, which is the opposite of what most tutorials still show.

> **Flagged.** The stable-ABI tutorial sets `-DPy_LIMITED_API=0x03090000` (3.9) while `cpp_extension.py` injects `0x030A0000` (3.10), and `_add_compile_flag` *appends*, so the injected 3.10 flag would land last and win. The ordering guarantee was not verified empirically. Pin and test before relying on a 3.9-tagged wheel.


# 3. TensorFlow and JAX — the define-and-run side

Brief but accurate. The pedagogical purpose of this section is **not** to teach TF or JAX. It is to make PyTorch's define-by-run choice visible by showing the alternative, and to give the student a vocabulary (*staging*, *tracing*, *program transformation*) that makes §2.6 (`torch.compile`) legible.

## 3.1 TF1: build a graph, then run it

`tf.Graph` holds `tf.Operation` nodes and `tf.Tensor` edges — *"Graphs are data structures that contain a set of `tf.Operation` objects, which represent units of computation; and `tf.Tensor` objects, which represent the units of data that flow between operations."*

```python
def run(self, fetches, feed_dict=None, options=None, run_metadata=None):
```

`fetches` is "a single graph element, or an arbitrarily nested list, tuple, namedtuple, dict, or OrderedDict containing graph elements at its leaves"; `feed_dict` "allows the caller to override the value of tensors in the graph". Returns a value shaped like `fetches`.

**Why anyone chose this.** Three payoffs, all documented and all real:

*(a) Whole-graph optimisation.* TF's Grappler `MetaOptimizer` passes, with the docs' own descriptions:

| Pass | What it does |
|---|---|
| Pruning | "Prunes nodes that have no effect on the output from the graph." |
| Constant folding | "Statically infers the value of tensors when possible by folding constant nodes." |
| Arithmetic | "eliminating common subexpressions and simplifying arithmetic statements" |
| Layout | "Optimizes tensor layouts to execute data format dependent operations such as convolutions more efficiently." |
| Remapper | "replacing commonly occurring subgraphs with optimized fused monolithic kernels" |
| Memory | "inserts CPU-GPU memory copy operations for swapping GPU memory to CPU to reduce the peak memory usage" |
| Dependency | "Removes or rearranges control dependencies to shorten the critical path" |
| Function | "inlines function bodies to enable other inter-procedural optimizations" |

The docs' own microbenchmark for constant folding alone: 0.002112719 s → 0.0007726810 s, ~2.7×.

*(b) Deployment.* *"You can use your TensorFlow graph in environments that don't have a Python interpreter, like mobile applications, embedded devices, and backend servers."* This is the whole reason `GraphDef`/SavedModel/TF-Serving exist.

*(c) Distribution.* *"graphs are extremely useful and let your TensorFlow run **fast**, run **in parallel**, and run efficiently **on multiple devices**."*

Note **Grappler ≠ XLA**: different IR levels, composable. Grappler rewrites the `GraphDef` at framework abstraction; XLA compiles a clustered subgraph through HLO to LLVM IR/PTX or a TPU backend. A `jit_compile=True` graph is Grappler-optimised first, then XLA-compiled.

**Why it hurt.** No `pdb` inside a graph — you are building a dataflow IR, not executing statements. Data-dependent control flow needs explicit `tf.cond`/`tf.while_loop`, because a bare Python `if` runs once at *construction* time on the Python truthiness of a symbolic tensor. And the "two languages in one" problem: the same `.py` file is simultaneously an eagerly-executed metaprogram that *builds* a graph and a description of per-step tensor math. **A C++ programmer will recognise this instantly as template metaprogramming's staging confusion** — say so; it lands. `tf.variable_scope`/`get_variable` with `reuse=AUTO_REUSE` existed only because there was no object-oriented variable ownership model to hang parameters off.

## 3.2 TF2: eager by default, `tf.function` to stage

`tf.function` "takes a regular function as input and returns a `tf.types.experimental.PolymorphicFunction` … a Python callable that builds TensorFlow graphs from the Python function." A `ConcreteFunction` "can be thought of as a wrapper around a `tf.Graph`" (a `FuncGraph`); the `PolymorphicFunction` "manages a cache of `ConcreteFunction`s and picks the right one for inputs."

Two stages: **tracing** (a fresh `tf.Graph`; Python runs normally but TF ops are *deferred* into the graph) and **execution** (the graph runs — "much faster than the tracing stage").

**The cache key is `tf.types.experimental.TraceType`, and this is where the retracing trap lives:**

- `Tensor` → parameterised by dtype + shape; ranked is a subtype of unranked, fixed dims a subtype of unknown dims.
- `Variable` → like Tensor plus a unique resource ID.
- **Python primitives → the TraceType *is the value*.** The TraceType of `3` is `LiteralTraceType<3>`, not `int`. **Every distinct Python int/float/str literal is a distinct type, hence a new trace.**
- Ordered containers are parameterised by element types (`[1,2]` ≠ `[2,1]`); mappings are order-insensitive.
- Other objects: `id()` first, then `==`.
- *"TraceType is based on the `tf.function` input parameters so changes to global and free variables alone will not create a new trace."*

Mitigations: `input_signature=(tf.TensorSpec(shape=[None], dtype=tf.int32),)`; `reduce_retracing=True` (*"Automatically identifies supertypes and traces generalized graphs"*); `get_concrete_function(...)`; or simply passing `tf.constant(10)` instead of Python `10`.

**Side-effect semantics**, verbatim, and this is the sentence to put on a slide:

> "Side effects, like printing, appending to lists, and mutating globals, can behave unexpectedly inside a `tf.function`, sometimes executing twice or not all. They only happen the first time you call a `tf.function` with a set of inputs. Afterwards, the traced `tf.Graph` is reexecuted, without executing the Python code."

So `f(1); f(1); f(2)` prints `Traced with 1 / Executed with 1 / Executed with 1 / Traced with 2 / Executed with 2`. `print()` fires at trace time; `tf.print()` is a graph op and fires every execution.

**Why it can trace *twice* on the first call** — a detail almost nobody knows, from the module docstring of `polymorphic_function.py`:

> "In order to support these variable initialization patterns, tf.function defines a variable subtype (UnliftedInitializerVariable) which collects the input subgraph. This type of variable replaces the regular variable type on the first tf.function trace. **To exclude initializers from the function body … tf.function traces a second time if it sees variables on the first call.**"

**Non-strict execution.** *"Graph execution only executes the operations necessary to produce the observable effects"*: the return value, documented side effects like `tf.print`, `tf.debugging` asserts, and `tf.Variable` mutations. Dead subgraphs simply do not run — a difference from eager that surprises people debugging with intermediate ops.

## 3.3 AutoGraph — an AST rewrite, verified

This is worth getting exactly right, because it is the closest thing in the ecosystem to what Dynamo does, done at a completely different level.

**AutoGraph is a `gast`-based source-to-source AST transformation**, in TF's `pyct` library ("Python Code Transformation"). Confirmed in `tensorflow/python/autograph/pyct/parser.py`: `module_node = gast.parse(src)`, round-tripping back via `gast.gast_to_ast(n)` → `ast.unparse(ast_n)`. `pyct/transformer.py`'s class `Base` is documented as *"Base class for general-purpose **Python-to-Python code transformation**… an extension of `ast.NodeTransformer`"*. `tf.function` "uses a library called AutoGraph (`tf.autograph`) to convert Python code into graph-generating code."

The emitted mapping:

```
foo(args)                  ->  ag__.converted_call(foo, args)
if                         ->  ag__.if_stmt        while -> ag__.while_stmt    for -> ag__.for_stmt
and / or / not             ->  ag__.and_ / ag__.or_ / ag__.not_
break / continue / return  ->  lowered into if-statements over control booleans
                               (`break_`, and for return: `do_return` + `retval_`)
```

**The dispatch is a runtime type test, not a static one.** Verbatim: *"Only statements that are conditioned on, or iterate over, a TensorFlow object such as `tf.Tensor`, are converted into TensorFlow ops."* The *generated code* unconditionally calls `ag__.if_stmt(cond, body, orelse, ...)`; `if_stmt`'s implementation checks **at trace time** whether `cond` is a Tensor, and only then builds a `tf.cond` node. Everything else executes as ordinary Python during tracing.

**That is the whole teaching point: lexically define-by-run Python source is rewritten at the AST level into an unconditional call whose runtime behaviour forks between "just run it" and "emit a static graph node."** Inspect it with `tf.autograph.to_code(f)`; raise the noise floor with `tf.autograph.set_verbosity(3)`.

The constraints follow mechanically from the fact that both branches must exist as graph structure:

- *"AutoGraph forbids variables to be defined in only one branch of a TensorFlow conditional, if the variable is used afterwards"*
- *"The dtypes across all code paths must be consistent in conditionals and loops"*
- *"AutoGraph will raise an error for TensorFlow control flow in which the return value is not known for all code paths"*
- *"variables must usually be defined before a TensorFlow loop"*, with consistent dtype/shape/structure at entry and exit (or declared in `shape_invariants`)
- *"tracing executes both branches of an if statement. Similarly, the body of loops is executed once (even if the loop would otherwise not iterate at all)"*
- *"If a symbol is modified in a TensorFlow control flow statement, then it becomes a `tf.Tensor`, even if it started off as a Python primitive value"*
- *"Modifying Python collections in TensorFlow control flow is not allowed"* — use `tf.TensorArray`
- AutoGraph "can only handle functions whose source code can be accessed at runtime" — no `exec`'d code

For-loop lowering: `tf.Tensor` → `tf.while_loop` over dim 0; `tf.range()` → range-based `tf.while_loop`; `tf.data.Dataset` without break/return → `Dataset.reduce`, with break/return → `scan`/`take_while`/`reduce`; plain Python iterables stay unconverted.

## 3.4 XLA

Pipeline (openxla.org/xla/architecture):

1. **StableHLO** in → converted to "an internal HLO dialect".
2. Target-independent passes: "CSE, target-independent operation fusion, and buffer analysis for allocating runtime memory".
3. Target-dependent HLO passes: the GPU backend does "GPU-specific operation fusions" and "partitions computation into streams".
4. Codegen: CPU and GPU "use LLVM for low-level IR, optimization, and code generation" (GPU → NVPTX). **TPU has a dedicated backend, no LLVM.**

IR: `HloModule` ⊃ `HloComputation` ⊃ `HloInstruction`, each carrying an opcode and a **static** shape.

```cpp
enum class FusionKind { kLoop, kInput, kOutput, kCustom };
```
- `kLoop` — root generates output "one element … at a time".
- `kInput` — "the primary node is the root of the fused instruction."
- `kOutput` — "the primary node is **not** the root… requires that one operand buffer of the fusion instruction be able to alias the output buffer."
- `kCustom` — "backend-specific fusions that don't fit into the above patterns."

**The bandwidth argument, in XLA's own words:**

> "fusion dramatically speeds up the execution by avoiding the writing of intermediate tensors to HBM and then reading them back"

with a hard invariant that is worth memorising:

> "No intermediate storage inside the fusion is materialized in HBM (it has to be all passed through either registers or shared memory)." … "**A fusion is always compiled to exactly one GPU kernel.**"

That is §2.5's roofline argument restated as a compiler invariant. Note it is the *same argument* as NumPy's BLAS-level story (§1.6) and as Inductor's fusion story — three systems, one idea.

> **Flagged.** OpenXLA's docs state the mechanism and the invariant but publish **no quantified fusion speedup number**. The roofline framing is Williams/Waterman/Patterson (CACM 2009), not an XLA citation.

**Static shapes.** XLA offers "a set of ~100 statically shaped instructions". `ShapeProto` = element type + dimensions; `LayoutProto` carries `repeated int64 minor_to_major` and `tail_padding_alignment_in_elements` — note that `minor_to_major` **is a stride-order permutation**, the same idea as §1.2, promoted into an IR-level type. Notation: `bf16[8,1,1280,16384]`, tiling `T(8,128)(2,1)`. Limited dynamism exists via `DynamicSlice`/`DynamicUpdateSlice` taking runtime *index* operands inside otherwise statically-shaped instructions.

> **Flagged.** The "new static shape ⇒ full recompile" rule is standard JIT behaviour and consistent with everything fetched, but no dedicated OpenXLA dynamic-shape page stating it verbatim was found.

Using it: `@tf.function(jit_compile=True)`; the first compile logs `"Compiled cluster using XLA! This line is logged at most once for the lifetime of the process."` Inspect with `f.experimental_get_compiler_ir(args)(stage='hlo' | 'optimized_hlo' | 'optimized_hlo_dot')`; dump with `--xla_dump_to`.

## 3.5 JAX

### Tracing

> "To get a view of your Python code that is valid for many different argument values, JAX traces it with the `ShapedArray` abstraction as input, where each abstract value represents the set of all array values with a fixed shape and dtype."

The Python body runs **once per (shape, dtype) signature**, producing a **jaxpr**, which is cached. The tracer under `jit` is `DynamicJaxprTrace`/`DynamicJaxprTracer` in `jax/_src/interpreters/partial_eval.py`.

> **Flagged.** `jax.core.ConcreteArray` **appears to be gone** from `main` — no such class, and it is not in the `_deprecations` shim table. It survives only as a teaching class inside `autodidax.py`. Pin your JAX version before teaching it.

The jaxpr grammar:

```
jaxpr ::= { lambda <binder> , ... .
            let <eqn> ...
            in ( <atom> , ... ) }
binder ::= <var>:<array_type>
atom   ::= <var> | <literal>
eqn    ::= <binder> , ... = <primitive> [ <params> ] <atom> , ...
```

```python
def func1(first, second):
   temp = first + jnp.sin(second) * 3.
   return jnp.sum(temp)
print(make_jaxpr(func1)(jnp.zeros(8), jnp.ones(8)))
```
```
{ lambda ; a:f32[8] b:f32[8]. let
    c:f32[8] = sin b
    d:f32[8] = mul c 3.0:f32[]
    e:f32[8] = add a d
    f:f32[] = reduce_sum[axes=(0,) out_sharding=None] e
  in (f,) }
```

**The exercise that teaches the whole idea in one minute:** wrap the same math behind an `if second.shape[0] > 4:` and a helper function call, and print the jaxpr again. It is **identical**. The Python is a staging metaprogram; its control flow and its call structure are resolved and *erased* at trace time. Nothing survives into the jaxpr except the tensor operations.

Higher-order primitives embed sub-jaxprs — `lax.switch` over three branches emits:

```
e:f32[] = cond[ branches=(
    { lambda ; f:f32[]. let g:f32[] = add f 1.0:f32[] in (g,) }
    { lambda ; h:f32[]. let i:f32[] = sub h 2.0:f32[] in (i,) }
    { lambda ; j:f32[]. let k:f32[] = add j 3.0:f32[] in (k,) } ) ] d b
```

**The classic failures**, and they are all the same failure: asking a question of an abstract value that only a concrete value can answer.

- `if x < 3:` → **`TracerBoolConversionError`**: *"Attempted boolean conversion of traced array with shape bool[]… This concrete value was not available in Python because it depends on the value of the argument x."*
- Boolean-mask indexing → `NonConcreteBooleanIndexError`: *"Array boolean indices must be concrete; got bool[5]"*
- A traced value used as a shape → `TypeError: Shapes must be 1D sequences of concrete values of integer type`
- `.shape` **works** (it lives in the aval); `.item()`/`bool()`/`float()` do not
- `print(x)` inside `jit` shows `JitTracer(~float32[])`; side effects *"appear during the first run… Subsequent runs with parameters of same type and shape may not show the side-effect"*

The escape hatch is `static_argnums`/`static_argnames`: *"By having jit trace on more refined abstract values, you can relax the traceability constraints"* — at the cost of one retrace per distinct static value, which is exactly TF's `LiteralTraceType` trap under another name.

### Transforms as functions of functions

```python
jax.grad(fun, argnums=0, has_aux=False, holomorphic=False, allow_int=False, reduce_axes=())
jax.jvp(fun, primals, tangents, has_aux=False)      # jvp :: (a -> b) -> a -> T a -> (b, T b)
jax.vjp(fun, *primals, has_aux=False, ...)          # vjp :: (a -> b) -> a -> (b, CT b -> CT a)
jax.linearize(fun, *primals, has_aux=False, in_nzs=None)
jax.vmap(fun, in_axes=0, out_axes=0, axis_name=None, axis_size=None, ...)
```

`jax.vjp`'s own docstring: **"`grad()` is implemented as a special case of `vjp()`."** Reverse mode = JVP + transpose: `linearize` partially evaluates the JVP into a tangent-only jaxpr, then `transpose_rules` run that linear jaxpr backwards.

The cost model, from the autodiff cookbook, and it is the cleanest statement of the forward/reverse trade anywhere:

> forward mode — "the FLOP cost of the jvp-transformed function is about 3x the cost of just evaluating the function… **memory cost is independent of the depth of the computation**"
> reverse mode — "the FLOPs are friendly, [but] **memory scales with the depth of the computation**"

That second line *is* the activation-memory problem, and it is why AOTAutograd's min-cut partitioner and activation checkpointing exist (§2.6).

`vmap` is **a per-primitive batching rule, not a loop**:

```python
def binop_batching_rule(op, axis_size, vals_in, dims_in):
  (x, y), (x_bdim, y_bdim) = vals_in, dims_in
  if x_bdim != y_bdim: ...  # move_batch_axis to align
  return [op(x, y)], [x_bdim]
vmap_rules[add_p] = partial(binop_batching_rule, add)
```

Doc benchmark: naive Python loop 439 µs, hand-batched `jnp.dot` 34.7 µs, `vmap`+`jit` **45.5 µs**. The point is not that `vmap` is fastest — it is that it gets within 30 % of hand-batching from an unbatched function.

Composition, verbatim: *"The jax.grad and jax.jit transformations compose and can be mixed arbitrarily"* — `grad(jit(grad(jit(grad(sum_logistic)))))(1.0)` evaluates fine.

### Primitives and interpreters — the load-bearing idea

From `autodidax`:

```python
class Primitive(NamedTuple):
  name: str
add_p = Primitive('add')

def bind(prim, *args, **params):
  top_trace = find_top_trace(args)
  tracers = [full_raise(top_trace, arg) for arg in args]
  outs = top_trace.process_primitive(prim, tracers, params)
  return [full_lower(out) for out in outs]
```

> "A `Primitive` is just an object with a name, to which we attach our interpretation rules (one for each transformation). The `bind` function is our interception point."

```python
class MainTrace(NamedTuple):
  level: int
  trace_type: type['Trace']
  global_data: Any | None
trace_stack: list[MainTrace] = []
```

> "We represent active interpreters as a stack… each element is a container with an integer level, an interpreter type (which we'll call a trace_type), and an optional field for any global data."

And the rules are literally per-primitive dicts:

```python
impl_rules[add_p]      = lambda x, y: [np.add(x, y)]
jvp_rules[add_p]       = add_jvp
vmap_rules[add_p]      = partial(binop_batching_rule, add)
transpose_rules[mul_p] = mul_transpose_rule
```

**This is the thesis: JAX's autodiff is a program transformation dispatched through per-primitive rule tables over a jaxpr. There is no runtime tape.** The "graph" *is* the jaxpr, built once by tracing; every transform is a jaxpr→jaxpr (or trace-stack) rewrite.

**And here is the structural parallel worth drawing explicitly in the lecture:** JAX's `trace_stack` of interpreter levels, with per-primitive rule tables looked up by `(primitive, trace_type)`, is *the same shape of design* as PyTorch's dispatcher — a stack of layered concerns, each with a per-operator kernel table, entered by a `bind`/`call` interception point, with an RAII-ish notion of which levels are currently active. PyTorch's version lives in C++ and dispatches on a bitset; JAX's lives in Python and dispatches on a stack of trace types. Two frameworks, independently, arrived at "layer the concerns, table the kernels, intercept at one point."

JAX's own jargon, worth teaching: *"we loosely use 'initial style' to mean 'build an AST and then transform it', and we use 'final style' to mean 'transform as we trace.'"* `jit` is initial-style (`make_jaxpr` up front, hence "can't support data-dependent Python control flow"); `jvp`/`vmap` are final-style (`process_primitive` fires live).

### Lowering to XLA, and TPU

The AOT documentation gives four explicit stages: trace/stage to a jaxpr → *"Lower this specialized, staged-out computation to the XLA compiler's input language, **StableHLO**"* → *"Compile the lowered HLO program to produce an optimized executable"* → execute.

```python
traced   = jax.jit(f).trace(x, y);  traced.jaxpr
lowered  = traced.lower();          lowered.as_text()
compiled = lowered.compile();       compiled.cost_analysis()['flops']
```
```mlir
module @jit_f attributes {mhlo.num_partitions = 1 : i32, mhlo.num_replicas = 1 : i32} {
  func.func public @main(%arg0: tensor<i32>, %arg1: tensor<i32>) -> (tensor<i32> {...}) {
    %c = stablehlo.constant dense<2> : tensor<i32>
    %0 = stablehlo.multiply %c, %arg0 : tensor<i32>
    %1 = stablehlo.add %0, %arg1 : tensor<i32>
    return %1 : tensor<i32>
  }
}
```

AOT-compiled callables are frozen: *"Cannot apply JAX transformations to a function lowered and compiled for a particular signature."*

**PJRT** is the device-plugin layer: *"PJRT is the uniform Device API that we want to add to the ML ecosystem"* — *"Frameworks (TF, JAX, etc.) will call PJRT, which has device-specific implementations that are opaque to the frameworks,"* each device implementing "PJRT APIs as PJRT plugins" via a C API header.

> **Flagged.** The page does not spell out PJRT's structural position relative to XLA/StableHLO. Architecturally it sits *below* the compiled-executable boundary (XLA produces the executable; PJRT loads, runs and manages device buffers), but that sentence is inference.

**TPU** (Google Cloud TPU system architecture docs):

- MXU systolic array: **128×128** for "TPU versions prior to v6e"; **256×256** for "TPU v6e and TPU7x".
- *"Each MXU is capable of performing 16K multiply-accumulate operations per cycle"* (128² = 16384).
- *"Each TensorCore consists of one or more matrix-multiply units (MXUs), a vector unit, and a scalar unit."*
- *"All multiplies take bfloat16 inputs, but all accumulations are performed in FP32 number format."*

**Why static shapes and fusion *fit* a systolic array** (synthesis, not a quotation, but it is the point of the section): an MXU is a fixed grid of MAC cells clocked in lockstep — no branch predictor, no dynamic scheduler, no data-dependent control. Static shapes let the compiler tile every matmul into MXU-sized blocks at compile time, statically schedule pipeline fill and drain, and fuse the surrounding elementwise work into the same kernel. **A device with no dynamic dispatch essentially requires a whole-program, statically-shaped compilation model.** JAX's trace→jaxpr→StableHLO pipeline is a consequence of the target, not an aesthetic preference. Students who have done the CUDA unit will feel this immediately: a GPU tolerates dynamism because it has a hardware scheduler; a TPU does not have one, so the compiler must be the scheduler.

### Purity, control flow, donation, PRNG

> "JAX transformation and compilation are designed to work only on Python functions that are functionally pure: all the input data is passed through the function parameters, all the results are output through the function results."

Internal mutable state is fine (a local dict). Iterators are not: `lax.fori_loop(0, 10, lambda i,x: x+next(iterator), 0)` silently returns `0` instead of `45` — a wonderfully instructive silent-wrong-answer bug.

The differentiability table:

```
construct      | jit | grad
if             |  ✗  |  ✓
for / while    |  ✓* |  ✓        (* argument-value-independent condition — unrolls)
lax.cond       |  ✓  |  ✓
lax.while_loop |  ✓  | fwd only
lax.fori_loop  |  ✓  | fwd only
lax.scan       |  ✓  |  ✓
```

with the reasons stated in the docstrings, and they are memory reasons:

- `lax.while_loop` — *"is not reverse-mode differentiable because XLA computations require static bounds on memory requirements."*
- `lax.fori_loop` — *"If the trip count is static … then the `fori_loop` is implemented in terms of `scan()` and reverse-mode autodiff is supported; otherwise, a `while_loop` is used and reverse-mode autodiff is not supported."*
- `lax.scan` — `scan :: (c -> a -> (c, b)) -> c -> [a] -> (c, [b])`; *"lowered to a single `WhileOp`… useful for reducing compilation times."*

**Read that table against §2.4's autograd engine and the contrast lands by itself:** PyTorch's tape can differentiate any loop because it simply *records* however many iterations actually ran. JAX cannot, because reverse mode needs a statically bounded activation buffer and a `while_loop`'s trip count is not statically known. Same mathematics, opposite constraint, and the constraint comes entirely from *when* the program is materialised.

`donate_argnums`/`donate_argnames`: *"XLA can make use of donated buffers to reduce the amount of memory needed, for example recycling one of your input buffers to store a result. You should not reuse buffers that you donate."* — i.e. manual in-place-ness, recovered by annotation, for a system that gave up mutation.

**PRNG.** Goals: *"reproducible, parallelizable, vectorisable."* Global state is rejected because *"for efficient execution, we want the JIT compiler to be free to reorder, elide, and fuse various operations"* and multi-process execution *"would be hampered by the need for each process to synchronize a global state."* JAX uses a *"modern **Threefry counter-based PRNG** that's splittable"* (`threefry2x32`).

```python
key = jax.random.key(seed)        # typed key, prints as key<fry>
k1, k2 = jax.random.split(key)
```

*"random functions consume the key, but do not modify it… The rule of thumb is: **never reuse keys**."* And deliberately: *"JAX does not provide a sequential equivalence guarantee, because doing so would interfere with the vectorization on SIMD hardware"* — though `jax.vmap(random.normal)(subkeys)` does reproduce the individually-split sequence.

> **Flagged.** `pmap` does not appear anywhere in the current canonical parallelism doc — strong evidence by omission that it is superseded by the Auto / Explicit / Manual (`jax.shard_map`) trio, but no literal deprecation sentence was found.

## 3.6 The contrast, stated crisply

This is the paragraph the whole section exists for.

**PyTorch = define-by-run.** Executing Python *is* the computation. The autograd graph is a **side effect** of that execution: each op on a `requires_grad` tensor appends a `Node` to a runtime tape, and `backward()` walks it. There is no program to inspect before you run it; the graph exists only for the extent of one forward pass and is rebuilt every iteration. Data-dependent control flow is free, because it is just Python control flow. The cost is that **no whole-program optimisation is possible** — you pay per-op dispatch (§2.2) and per-op kernel launch (§2.5), and every intermediate makes a round trip to HBM.

**JAX / TF-graph = define-and-run.** The Python is a **staging metaprogram**. Running it does not compute anything; it *emits* a program (jaxpr / `FuncGraph`). Autodiff is not a tape — it is a **program transformation on that emitted program**, dispatched through per-primitive rule tables (`jvp_rules`, `transpose_rules`, `vmap_rules`). Because the whole program is materialised before execution, the compiler can fuse, allocate and schedule globally. The cost is that everything the Python did at staging time is frozen into the emitted program: **control flow must be reified** (`lax.cond`, `tf.cond`), **side effects happen exactly once at trace time**, **shapes must be static**, and **functions must be pure**.

TF2's `tf.function` + AutoGraph is the interesting middle: it *syntactically preserves* define-by-run source while rewriting the AST so the same text emits a graph. JAX does not attempt this — it makes you write `lax.cond` and tells you why.

**And `torch.compile` is PyTorch retrofitting staging** — but by reading **bytecode**, not by tracing with abstract values. That is the subject of §2.6, and the reason it is a harder problem than either alternative is exactly that it refuses to change your program's semantics to get a graph.
# 4. The glue

## 4.1 CPython's C API and reference counting

### `PyObject` — and the fact that its layout changed twice recently

This matters more than it looks, because it is the concrete reason the stable ABI exists.

**3.12** (PEP 683, immortal objects — `ob_refcnt` becomes a union):

```c
struct _object {
    _PyObject_HEAD_EXTRA
    union {
       Py_ssize_t ob_refcnt;
#if SIZEOF_VOID_P > 4
       PY_UINT32_T ob_refcnt_split[2];
#endif
    };
    PyTypeObject *ob_type;
};
```

**3.14, default (GIL) build** — changed *again*; `ob_refcnt` is now **32-bit**, with siblings:

```c
struct _object {
    union {
#if SIZEOF_VOID_P > 4
        PY_INT64_T ob_refcnt_full;
        struct {
#  if PY_BIG_ENDIAN
            uint16_t ob_flags;  uint16_t ob_overflow;  uint32_t ob_refcnt;
#  else
            uint32_t ob_refcnt; uint16_t ob_overflow;  uint16_t ob_flags;
#  endif
        };
#else
        Py_ssize_t ob_refcnt;
#endif
    };
    PyTypeObject *ob_type;
};
```

**Free-threaded build (`Py_GIL_DISABLED`)** — biased reference counting, a completely different object header:

```c
struct _object {
    uintptr_t ob_tid;          // owning thread id (0 = unowned/immortal/merged)
    uint16_t ob_flags;
    PyMutex ob_mutex;          // per-object lock
    uint8_t ob_gc_bits;
    uint32_t ob_ref_local;     // thread-local refcount, NON-atomic
    Py_ssize_t ob_ref_shared;  // shared refcount, atomic
    PyTypeObject *ob_type;
};
```

Three layouts, all shipping, all called `PyObject`. Direct field access is documented as forbidden — use `Py_REFCNT()`, `Py_TYPE()`, `Py_SIZE()` (the latter two are `static inline` functions since 3.11).

**Immortal objects.** `None`, `True`, `False`, `Ellipsis`, `NotImplemented`, static `PyTypeObject`s, small ints and interned identifiers carry a saturated refcount; since 3.12 *"Immortal objects are not modified"* by `Py_INCREF`/`Py_DECREF`/`Py_SET_REFCNT`. **Consequence worth teaching: only `Py_REFCNT() == 0` and `== 1` comparisons are meaningful now.** Every "let me print the refcount of `True`" demo written before 3.12 is now misleading.

### The refcount API

| Call | Signature | Note |
|---|---|---|
| `Py_INCREF` | `void Py_INCREF(PyObject *o)` | `o` must not be NULL; no-op on immortals (3.12+) |
| `Py_XINCREF` / `Py_XDECREF` | | NULL-safe |
| `Py_DECREF` | `void Py_DECREF(PyObject *o)` | calls `tp_dealloc` at 0 |
| `Py_CLEAR` | macro | `Py_XDECREF` then `o = NULL`; **3.12: argument evaluated only once** |
| `Py_NewRef` / `Py_XNewRef` (3.10+) | `PyObject *Py_NewRef(PyObject *o)` | `Py_INCREF(o); return o;` — stable ABI since 3.10 |
| `Py_SETREF` / `Py_XSETREF` (3.6+) | macro | assigns **before** decref'ing the old value |

**The reentrancy hazard**, verbatim, and it is the reason `Py_CLEAR` and `Py_SETREF` exist at all:

> "The deallocation function can cause arbitrary Python code to be invoked (e.g. when a class instance with a `__del__()` method is deallocated). While exceptions in such code are not propagated, the executed code has free access to all Python global variables. **This means that any object that is reachable from a global variable should be in a consistent state before `Py_DECREF()` is invoked.**"

A C++ programmer will map this straight onto "don't call a virtual destructor while your invariants are broken", and that is the right intuition — but the blast radius is much larger, because the re-entered code can reach *anything*.

**Borrowed / new / stolen**, and the bug each convention causes:

| Convention | Examples | Failure mode if you get it wrong |
|---|---|---|
| **Borrowed** | `PyList_GetItem`, `PyTuple_GetItem`, `PyDict_GetItem`, `PyArg_ParseTuple` with `"O"` | You decref it → premature free → **use-after-free at some unrelated site**, which is the worst kind |
| **New** | `PyObject_GetAttrString`, `PyLong_FromLong`, `PyObject_CallObject` | You forget to decref → **leak** |
| **Stolen** | `PyList_SetItem`, `PyTuple_SetItem` (the *value* argument) | You pass a borrowed reference, or decref after → **double free** |

Nice detail worth quoting, because it forecloses a question every systems person asks: *"There's no chance that the reference count can overflow; at least as many bits are used to hold the reference count as there are distinct memory locations in virtual memory."*

### Cycles and the cyclic GC

Refcounting cannot free `A → B → A`; only the cyclic collector can, and it needs the *type* to cooperate:

```c
typedef int (*traverseproc)(PyObject *self, visitproc visit, void *arg);
```

> "If a type adds the `Py_TPFLAGS_HAVE_GC`, then it must implement at least a `tp_traverse` handler."

`tp_clear` breaks the cycle by dropping references while leaving the object valid. `Py_VISIT(o)` requires the traverse function's parameters be named exactly `visit` and `arg`. Lifecycle: `PyObject_GC_New` → `PyObject_GC_Track` (at the *end* of the constructor, once fields are valid) → `PyObject_GC_UnTrack` (in `tp_dealloc`, *before* invalidating fields) → `PyObject_GC_Del`.

**Any C extension type holding `PyObject*` members must implement `tp_traverse` or it leaks every cycle it participates in.** This is a real and common bug in hand-written bindings, and it is why PyTorch's `TensorImpl` carries a `PyObjectSlot` with careful GC integration rather than a raw pointer.

> **Correction to widely repeated folklore.** GC thresholds are **(2000, 10, 10)**, not (700, 10, 10). Verified in `Include/internal/pycore_interp_structs.h` on 3.14 and empirically (`gc.get_threshold()` → `(2000, 10, 10)` on 3.14.7):
>
> ```c
> #ifndef Py_GIL_DISABLED
> #define GC_GENERATION_INIT \
>     .generations = { { .threshold = 2000, }, { .threshold = 10, }, { .threshold = 10, }, }, ...
> #else
> #define GC_GENERATION_INIT \
>     .young = { .threshold = 2000, }, .old = { { .threshold = 10, }, { .threshold = 10, }, },
> #endif
> ```
>
> Also: the incremental young/old GC redesign landed in **3.14, not 3.12/3.13**, and was **reverted in 3.14.5** for the default build after reports of *"significant memory pressure in production environments"*. The free-threaded build kept young/old. Free-threaded builds add a memory check: *"If the memory usage has not increased by 10% since the last collection and the net number of object allocations has not exceeded 40 times threshold0, the collection is not run."*

> **Flagged.** The trashcan mechanism (`Py_TRASHCAN_BEGIN`/`END`) was not re-verified this pass. Known purpose: bound C-stack depth when deallocating deeply nested structures by deferring nested `tp_dealloc` calls onto a heap queue.

### Stable ABI / limited API

PEP 384's abstract states the problem exactly: each feature release *"introduces a new name for the Python DLL on Windows, and may cause incompatibilities for extension modules on Unix"*, because *"the primary source of ABI incompatibility are changes to the lay-out of in-memory structures."* Look back at the three `PyObject` layouts above and the motivation is self-evident — that is the lesson, and it is better taught by showing the structs than by asserting the rule.

Define `Py_LIMITED_API` to a `PY_VERSION_HEX` **before** `#include <Python.h>` — `0x030A0000` for "3.10 and up". The cost, verbatim: *"Without `Py_LIMITED_API` defined, some C API functions are inlined or replaced by macros. Defining `Py_LIMITED_API` disables this inlining."* **Concretely: `Py_INCREF`/`Py_DECREF` become real exported function calls (`Py_IncRef`/`Py_DecRef`)** — necessarily, since the struct layout is hidden. So the stable ABI trades per-refcount-operation inlining for cross-version binary compatibility. That is a *measurable* trade and a good exercise.

Wheels are tagged `mymodule.abi3.so`. *"Python will look for and load shared library files named with the abi3 tag… It does not check if such extensions conform to a Stable ABI"* — enforcement is on the packager, not the runtime.

Free-threaded builds are a **separate ABI** with their own tags (`cp313t` / `cp314t`).

> **Flagged.** Neither the stable-ABI docs nor the packaging platform-tags spec, as fetched, state the current stable-ABI-under-free-threading interop story either way. PEP 703's text implies stable-ABI extensions are not automatically free-threading-safe (they may still assume the GIL). PEP 697 and PEP 689 were not fetched.

## 4.2 Binding technologies

### Correcting the nanobind numbers

The circulating figure — "~4× smaller binaries, ~4× faster compile, ~8× lower runtime overhead" — is **wrong on two of three counts.** The current README's own TL;DR:

> "benchmarks show up to **~4× faster** compile time, **~5× smaller** binaries, and **~10× lower** runtime overheads compared to pybind11. nanobind also outperforms Cython in important metrics (**3-12×** binary size reduction, **1.6-4×** compilation time reduction, similar runtime performance)."

More granular, from the body:

- Compile time: ~2.7–4.4× vs pybind11; 1.6–4.4× vs Cython.
- Binary size (`-Os`): ~11× vs Boost.Python, **3–5×** vs pybind11, 3–12× vs Cython.
- Runtime: *"a ~**3× improvement** for simple functions, and an **~10× improvement** when classes are being passed around."*

**So: compile time ~4× is right; binary size is 3–5× (headline says 5×, not 4×); and "8× runtime" appears nowhere — the real figure is a range, 3× for plain functions and 10× for classes.** Treat 8× as folklore drift and do not teach it.

And teach the benchmark's provenance as part of the lesson, because it is a good example of how to read a vendor benchmark. It binds 720 trivial functions of the form:

```cpp
m.def("test_0050", [](uint16_t a, int64_t b, int32_t c, uint64_t d, uint32_t e, float f) {
    return a+b+c+d+e+f; });
```

on *"an AMD Ryzen 9 7950X workstation running Ubuntu 22.04.2 LTS. CPU boost was disabled, and all core clock frequencies were pinned. Reported timings are the median of five runs. Compilation used clang++ 15.0.7… Python 3.10.6, cppyy 1.12.13, **Cython 0.29.28**, and **nanobind 1.2.0**."* That is nanobind 1.2 (current is 2.x) against Cython 0.29 (current is 3.3), on a synthetic microbenchmark of trivial functions, run by the vendor. It is *evidence*, not *measurement of your workload*.

### The comparison

| | Mechanism | Build cost | Per-call overhead | Pick it when |
|---|---|---|---|---|
| **pybind11** | Header-only C++11 template metaprogramming; shared internals registry | Highest — `pybind11.h` alone pulls *"about 2.1 MiB of headers with Clang and libc++"*; often needs LTO for sane binary size | Baseline | Legacy/large C++ surface, exotic C++ features, ecosystem familiarity |
| **nanobind** | Same syntax, C++17, a **precompiled `libnanobind`**, PEP 590 vectorcall, `tsl::robin_map` registries, opt-in STL headers | ~3–4× faster than pybind11 | 3× (functions) to 10× (classes) lower | New projects where you control the C++; **and when you need abi3** |
| **Cython** | Generates C that calls the CPython C API directly | Moderate; needs a C compiler | Near-zero inside `cdef`/`nogil` loops | Tight numeric loops over NumPy buffers; incremental Python→C migration |
| **ctypes** | **libffi at runtime**, stdlib, no build step | Zero | Highest — per-call marshalling and type dispatch | One-off calls into an existing `.so`; no toolchain available |
| **cffi** | ABI mode = libffi at runtime; **API mode compiles** a real extension | Zero / moderate | High / low | C-only libraries. ABI mode *"will crash if you call some function or access some fields of a structure that was slightly misdeclared"*; API mode *"can be massively faster"* |
| **PyO3** | Rust proc-macros generating CPython C API calls; `maturin` builds wheels | Rust compile times | Comparable to nanobind | New native extension in Rust |

**pybind11 specifics.** `PYBIND11_MODULE(example, m, py::mod_gil_not_used())` — the third argument is new in 3.x (free-threading declaration). `py::call_guard<T>` *"allows any scope guard type T to be placed around the function call"*, chainable, *"most useful paired with `py::gil_scoped_release`"*. Since 3.0, the merged `py::class_<T, py::smart_holder>` handles two-way unique/shared conversion and `enable_shared_from_this`. Documented limitations: casts away const-ness (Python has no const); type casters are not recursively maintained. **Current release 3.1.0 (Aug 2026) dropped Python 3.8.**

**nanobind specifics.** Requires **C++17 and Python 3.10+** — the widely repeated "Python 3.8+" is outdated. Why it is smaller: per-instance overhead *"shrinks by a factor of 2.3x. (pybind11: 56 bytes, nanobind: 24 bytes.)"*; a precompiled support library replaces per-TU header-only dispatch machinery; STL support is opt-in per header; PEP 590 vectorcalls mean the *"dispatch loop no longer allocates heap memory"*. The design stance is the quotable bit, and it is a good general lesson about tool choice: *"pybind11 must deal with all of C++ to bind legacy codebases, while nanobind targets a smaller C++ subset. **The codebase has to adapt to the binding tool and not the other way around.**"* nanobind also uses **DLPack or the buffer protocol** for zero-copy ndarray exchange — the direct bridge to §4.4.

**Cython specifics.** Typed memoryviews: `cdef int[:] v`, `cdef int[:,:] buf`, with **contiguity spelled in the slice** — `int[:, ::1]` is C-contiguous, `int[::1, :, :]` is Fortran-contiguous. (Note this is §1.2's stride story promoted into the *type system*; point that out.) Directive defaults matter, because the fast path is opt-**in**: `boundscheck` **True**, `wraparound` **True**, `initializedcheck` **True**, `nonecheck` False, `cdivision` **False** (docs cite up to 35 % cost for leaving it off). Parallelism:

```
prange([start,] stop[, step][, nogil=False][, use_threads_if=COND]
       [, schedule='static'|'dynamic'|'guided'|'runtime'][, chunksize][, num_threads])
```

needs `-fopenmp` in **both** `extra_compile_args` and `extra_link_args`.

**ctypes/cffi.** `CDLL("libc.so.6")`, `fn.argtypes`, `fn.restype`, `Structure._fields_`, `byref()`. **No C++** unless symbols are `extern "C"` — mangled names are not resolvable by attribute lookup, which is the whole reason `ctypes` never became the binding layer for a C++ framework.

**The abi3 wheel story — a real decision driver:**

| Tool | abi3? | Since |
|---|---|---|
| nanobind | **Yes** | *"can target Python's stable ABI interface starting with Python 3.12 (or 3.10 in split mode)"* |
| **pybind11** | **No** | Grepping the full changelog 1.8.0 → 3.1.0 (Aug 2026) for `abi3` / `Py_LIMITED_API` gives **zero hits**; issue #1755 (2019) still open |
| Cython | **Yes** | 3.1 (3.0's support *"not practically useful"*) |
| PyO3 | **Yes**, plus `abi3t` | maturin ≥0.9.0 / ≥1.14 |

And JAX said out loud why this drove a migration — Peter Hawkins, quoted in the nanobind README: *"the main reason to do this for these bindings is because nanobind can target the Python Stable ABI starting with Python 3.12. This means that we will not need to ship per-Python version CUDA plugins starting with Python 3.12."* One ABI decision, N× fewer CUDA wheels. That is the kind of consequence students should learn to see.

## 4.3 The GIL

### What it protects, and the number

> "The Python interpreter is not fully thread-safe. In order to support multi-threaded Python programs, there's a global lock, called the global interpreter lock or GIL, that must be held by the current thread before it can safely access Python objects. Without the lock, even the simplest operations could cause problems in a multi-threaded program: **for example, when two threads simultaneously increment the reference count of the same object, the reference count could end up being incremented only once instead of twice.**"

> "**only the thread that has acquired the GIL may operate on Python objects or call Python/C API functions.**"

So it protects (a) the non-atomic `ob_refcnt++/--` of the GIL build and (b) interpreter-internal mutable state. **It is not a general memory-safety lock for your C code** — a point worth making explicitly, because people assume it is.

The switch interval, verified two ways — `Python/ceval_gil.c`:

```c
#define DEFAULT_INTERVAL 5000        /* microseconds */
gil->interval = DEFAULT_INTERVAL;
```

and empirically `sys.getswitchinterval() == 0.005`. The 5 ms folklore is, for once, correct.

Therefore N CPU-bound pure-Python threads share **one thread's worth** of bytecode execution, round-robined every ~5 ms. They *do* help I/O, because CPython's blocking-syscall wrappers release the GIL around the syscall.

### Releasing it

```c
#define Py_BEGIN_ALLOW_THREADS { \
                        PyThreadState *_save; \
                        _save = PyEval_SaveThread();
#define Py_END_ALLOW_THREADS    PyEval_RestoreThread(_save); \
                 }
```

**The rule between them: touch no `PyObject*` and call no Python/C API function.** For calling *into* Python from a foreign thread, the inverse:

```c
PyGILState_STATE gstate = PyGILState_Ensure();
/* Python actions here */
PyGILState_Release(gstate);
```

### Where the numeric stack releases it — verified sites

**NumPy** (`ndarraytypes.h`):

```c
#define NPY_BEGIN_THREADS do {_save = PyEval_SaveThread();} while (0);
#define NPY_END_THREADS   do { if (_save) { PyEval_RestoreThread(_save); _save = NULL;} } while (0);
#define NPY_BEGIN_THREADS_THRESHOLDED(loop_size) \
        do { if ((loop_size) > 500) { _save = PyEval_SaveThread();} } while (0);
```

**The `> 500` threshold is the whole lesson in one constant**: releasing and reacquiring the GIL is not free, so NumPy only bothers when the loop is long enough to pay for it.

**PyTorch** — three sites, all verified, and together they explain why a training loop scales:

1. **Every ATen dispatch from Python releases the GIL**, emitted by codegen (`tools/autograd/gen_python_functions.py`, in `emit_single_dispatch`):
   ```python
   auto dispatch_{name} = []({lambda_formals}) -> {lambda_return} {{
     pybind11::gil_scoped_release no_gil;
     return {dispatch_callee}({dispatch_args});
   }};
   ```
   *(Cite the template path `tools/autograd/templates/python_variable_methods.cpp`, not the generated file — the generated one does not exist in the git tree.)*
2. **The autograd engine runs GIL-free.** `torch/csrc/autograd/python_engine.cpp`:
   ```cpp
   // Create a PyThreadState, but release the GIL. This lets
   // pybind11::gil_scoped_acquire calls inside thread_main acquire the GIL
   // without having to create a new PyThreadState each time.
   auto gil = std::make_unique<pybind11::gil_scoped_acquire>();
   pybind11::gil_scoped_release no_gil;
   Engine::thread_init(device, ready_queue, false);
   ```
   and it enforces the contract with an error message that literally spells out the idiom: *"…GIL to be held so you should release it with 'pybind11::gil_scoped_release no_gil;'"*.
3. **The GIL is reacquired only for Python-defined nodes.** `torch/csrc/autograd/python_function.cpp`:
   ```cpp
   auto PyNode::apply(variable_list&& inputs) -> variable_list {
     pybind11::gil_scoped_acquire gil;
   ```

**Put together: the backward graph traversal and every ATen kernel run outside the GIL; only a custom `torch.autograd.Function` written in Python serialises.** That is why a PyTorch backward pass parallelises across device threads, and it is a precise, checkable answer to "but isn't Python single-threaded?"

**Cython**: `with nogil:` blocks and `cdef ... nogil` functions (which cannot take Python args or return Python objects); `with gil:` to re-enter. Cython 3.0+ permits `raise`/`assert`/`print` inside `nogil` with an implicit acquire around just that statement.

**pybind11**: `py::gil_scoped_acquire` / `py::gil_scoped_release` as scope guards, or attached to a binding via `py::call_guard<py::gil_scoped_release>()`.

### Consequences for how you actually parallelise

- **Intra-op**: `at::parallel_for` (OpenMP / TBB / native pool) and `torch.set_num_threads()` split one large op across cores — entirely inside GIL-released C++, so it scales with real cores.
- **Inter-op**: `torch.set_num_interop_threads()` for independent subgraphs, set before any inter-op work starts.
- **`DataLoader` uses processes, not threads** — verified: `import multiprocessing as python_multiprocessing`, `_MultiProcessingDataLoaderIter` builds `multiprocessing_context.Process(...)`, and the docstring reads `num_workers (int, optional): how many subprocesses to use for data loading`. **The reason is exactly the GIL**: worker code is user-supplied Python — `Dataset.__getitem__`, `collate_fn`, torchvision transforms — pure Python object manipulation that threads would fully serialise. So PyTorch pays pickling, IPC and process startup purely to escape the GIL. That cost is the single most legible price the GIL extracts from the ML stack, and it is a perfect exercise.

> **Flagged.** `at::parallel_for` / `set_num_interop_threads` semantics were not re-fetched from source this pass.

### PEP 703 free-threading

Mechanisms: **biased reference counting** (`ob_tid` names an owning thread doing non-atomic `ob_ref_local` updates while others use atomics on `ob_ref_shared`); **deferred reference counting** for hot objects (functions, code objects, modules) reconciled only during a stop-the-world GC pass — so they effectively *depend on* the cyclic collector; **immortalisation** of interned strings, small ints, static types and singletons to avoid cache-line contention; **mimalloc** replacing pymalloc; **per-object `ob_mutex`** on list/dict/set.

Build with `--disable-gil` → `python3.13t`, ABI tag `cp313t`. `PYTHONGIL` / `-X gil` can re-enable the GIL at runtime in such a build.

**Status:**
- 3.13 — **experimental** (Phase I).
- **PEP 779, "Criteria for supported status for free-threaded Python" — Status: Final, Python-Version: 3.14, resolved 2025-06-16.** Free-threading is now **Phase II: officially supported but still optional.** (Phase III would make it default.)
- 3.14 what's-new: *"The implementation described in PEP 703 has been finished, including C API changes… The specializing adaptive interpreter (PEP 659) is now enabled in free-threaded mode."*

**Overhead — three sources, three vintages, all real, and the spread is itself instructive:**

| Source | Single-thread penalty | Memory |
|---|---|---|
| PEP 703 (pyperformance 1.0.6) | 6 % Intel Skylake, 5 % AMD Zen 3 (8 %/7 % multithreaded) | — |
| PEP 779 at drafting | ~10 % (macOS ~3 %) | 15–20 % higher (geomean) |
| 3.14 release notes | *"roughly 5–10%, depending on the platform and C compiler used"* | — |

Phase II's hard targets are 15 % performance and 20 % memory.

**What it buys numeric code:** genuine single-process multithreaded CPU-bound Python over shared memory — i.e. exactly the DataLoader problem, which today burns processes and pickling *only* to dodge the GIL. That is the concrete stake, and it is worth stating, because "the GIL is going away" is otherwise an abstraction to a student.

## 4.4 DLPack

Current header is **v1.3** (`DLPACK_MAJOR_VERSION 1`, `DLPACK_MINOR_VERSION 3`).

```c
typedef struct { uint32_t major; uint32_t minor; } DLPackVersion;

typedef enum {
  kDLCPU = 1,  kDLCUDA = 2,  kDLCUDAHost = 3,  kDLOpenCL = 4,
  kDLVulkan = 7,  kDLMetal = 8,  kDLVPI = 9,  kDLROCM = 10,
  kDLROCMHost = 11,  kDLExtDev = 12,  kDLCUDAManaged = 13,
  kDLOneAPI = 14,  kDLWebGPU = 15,  kDLHexagon = 16,  kDLMAIA = 17,
  kDLTrn = 18,  kDLTPU = 19,  kDLTPUHost = 20,  kDLAscend = 21,
} DLDeviceType;                                  /* 5 and 6 are retired */

typedef struct { DLDeviceType device_type; int32_t device_id; } DLDevice;
typedef struct { uint8_t code; uint8_t bits; uint16_t lanes; } DLDataType;

typedef struct {
  void* data;
  DLDevice device;
  int32_t ndim;
  DLDataType dtype;
  int64_t* shape;
  int64_t* strides;      /* IN ELEMENTS, NOT BYTES  ← note the divergence from NumPy */
  uint64_t byte_offset;  /* in bytes */
} DLTensor;

typedef struct DLManagedTensor {          /* legacy; deprecated since v0.8 */
  DLTensor dl_tensor;
  void* manager_ctx;
  void (*deleter)(struct DLManagedTensor* self);
} DLManagedTensor;

#define DLPACK_FLAG_BITMASK_READ_ONLY              (1UL << 0UL)
#define DLPACK_FLAG_BITMASK_IS_COPIED              (1UL << 1UL)
#define DLPACK_FLAG_BITMASK_IS_SUBBYTE_TYPE_PADDED (1UL << 2UL)

typedef struct DLManagedTensorVersioned {  /* "the current standard DLPack exchange data structure" */
  DLPackVersion version;
  void *manager_ctx;
  void (*deleter)(struct DLManagedTensorVersioned *self);
  uint64_t flags;
  DLTensor dl_tensor;
} DLManagedTensorVersioned;
```

**Two corrections to what most tutorials say, both verified in the header:**

1. **"NULL strides means compact row-major" is no longer true.** Verbatim: *"strides of the tensor (in number of elements, not bytes), **can not be NULL if ndim != 0**… **Note**: Before DLPack v1.2, strides can be NULL to indicate contiguous data. This is not allowed in DLPack v1.2 and later. The rationale is to simplify the consumer handling."* `strides` may be NULL only when `ndim == 0`.
2. **The dtype list is far longer than the classic seven** — `kDLInt, kDLUInt, kDLFloat, kDLOpaqueHandle, kDLBfloat, kDLComplex, kDLBool`, then **eight float8 variants** (`e3m4, e4m3, e4m3b11fnuz, e4m3fn, e4m3fnuz, e5m2, e5m2fnuz, e8m0fnu`), **two float6**, **one float4**, and `kDLBcomplex`. If your curriculum touched FP8/FP4 in the numerics unit, this is where those formats show up in an interchange ABI.

**Also worth knowing and essentially undocumented outside the header:** a `DLPackExchangeAPI` C function-pointer table (`DLPackManagedTensorAllocator`, `DLPackManagedTensorFromPyObjectNoSync`, `DLPackCurrentWorkStream`, …) exposed as a type-level `PyCapsule` named `"dlpack_exchange_api"` under the attribute `__dlpack_c_exchange_api__` — a fast, stream-aware, no-sync path layered on the classic capsule protocol. No existing tutorial covers it.

**Ownership.** The producer creates a `PyCapsule` named `"dltensor"` (or `"dltensor_versioned"`). Consumption, verbatim:

> "the consumer must transfer ownership of the DLManagedTensor from the capsule to its own object. It does so by **renaming the capsule to `'used_dltensor'`** to ensure that PyCapsule_Destructor will not get called."

If nobody renames it, the capsule's own destructor invokes `deleter`. `manager_ctx` is opaque producer-side context threaded to the deleter so it can release the right underlying object (e.g. the owning `torch::Tensor`). **This rename-as-ownership-transfer trick is worth a slide** — it is a beautifully cheap protocol, and it explains exactly why consuming the same capsule twice is undefined.

**The Python protocol:**

```python
array.__dlpack__(*, stream=None, max_version=None, dl_device=None, copy=None) -> PyCapsule
array.__dlpack_device__() -> tuple[enum.Enum, int]
```

- `max_version` — "the maximum DLPack version that the consumer supports, in the form of a 2-tuple (major, minor)"
- `dl_device` — "Default is None, meaning the exported capsule should be on the same device as self"
- `stream` — "for CUDA and ROCm, a Python integer representing a pointer to a stream… provided by the consumer to the producer to instruct the producer to ensure that operations can safely be performed on the array (e.g., by inserting a dependency between streams via 'wait for event')."

**Stream semantics — and the CUDA/ROCm divergence, a genuine trap:**

| Value | CUDA | ROCm |
|---|---|---|
| `None` | legacy default stream (default) | legacy default stream (default) |
| `0` | **disallowed** — "due to its ambiguity" | **the default stream** |
| `1` | legacy default stream | not supported |
| `2` | per-thread default stream | not supported |
| `> 2` | stream pointer as a Python int | stream pointer as a Python int |
| `-1` | "may be used by the consumer to signal 'producer must not perform any synchronization'" | same |

**Who synchronises: the producer.** The consumer only *declares* which stream it will use; the producer must insert whatever event-wait or cross-stream dependency is needed before returning the capsule — unless the consumer opts out with `stream=-1`. Read that next to §2.5's `record_stream` discussion and it is the same problem with the same solution, standardised across frameworks.

**Consumers:**

```python
numpy.from_dlpack(x, /, *, device=None, copy=None) -> ndarray   # copy=False raises BufferError if a copy is needed
torch.from_dlpack(ext_tensor) -> Tensor                          # modern unified entry point
torch.utils.dlpack.{from_dlpack, to_dlpack}                      # to_dlpack is legacy
```

with the warning: *"Only call from_dlpack once per capsule produced with to_dlpack. Behavior when a capsule is consumed multiple times is undefined."*

**Why it beats the buffer protocol.** DLPack's stated rationale is minimalism: *"The main design rationale of DLPack is the minimalism. DLPack drops the consideration of allocator, device API and focus on the minimum data structure."* But the decisive difference is scope: **PEP 3118 has no device concept and no stream concept at all.** It describes CPU memory, full stop. DLPack has first-class `DLDevice`/`DLDeviceType` across CPU, CUDA, ROCm, Metal, Vulkan, OpenCL, WebGPU, TPU, Hexagon and Ascend, plus stream-aware handoff. That is why the Python array API standard adopted it and why `torch.from_dlpack(cupy_array)` works while `np.asarray(cupy_array)` cannot.

**The predecessor worth mentioning:** `__cuda_array_interface__` (Numba/CuPy) — a Python dict with `shape`, `typestr`, `data` (pointer int + read-only flag), `version`, optional `strides` (**byte offsets — the opposite convention from DLPack's elements**) and optional `stream`. CUDA-only, Python-attribute-only, no C struct, so nothing outside Python can consume it. DLPack generalises the same idea into a portable C ABI usable from any language.

> **Flagged.** "DLPack supersedes `__cuda_array_interface__`" is a reasoned conclusion from comparing the two specs' scope, not a quoted sentence.

## 4.5 The unifying observation

Worth stating at the end of the unit, because it retro-justifies everything in it:

**Every layer in this report is solving the same problem — how to describe a block of memory to someone who did not allocate it — and each layer adds exactly one field to the answer.**

```
raw pointer                                          "here it is"
+ shape, itemsize                     (PEP 3118)     "here is how to index it"
+ strides                             (PEP 3118)     "…and it need not be contiguous"
+ suboffsets                          (PEP 3118)     "…and it might be pointer-indirect"
+ device                              (DLPack)       "…and it might not be on this chip"
+ stream                              (DLPack)       "…and it might not be finished yet"
+ deleter / manager_ctx               (both)         "…and here is who is allowed to free it"
```

`PyArrayObject`, `Py_buffer`, `DLTensor` and `TensorImpl` are four spellings of that same list, differing only in how far down it they go. A student who sees that will never again have to memorise any of them.
# 5. What can be BUILT

Nine projects, dependency-ordered. Time estimates assume the stated prerequisite (fluent C++, comfortable in Linux, has written CUDA) and count *focused* hours, not calendar time. Each has a stated falsifiable success criterion — the thing that proves you understood it rather than typed it.

The design principle: **every project reimplements one layer of the real stack badly, then diffs its behaviour against the real thing.** The diff is the lesson. Never build in a vacuum; always end with "and here is where NumPy/PyTorch disagrees with me, and why they are right."

---

### P0 — `strided<T>`: an ndarray in C++ with views and broadcasting
**Teaches:** that shape is metadata, memory is flat, and strides are the entire interface between the two.
**Time:** 8–12 h. **Depends on:** C++ only.

Build a class holding exactly five things: `shared_ptr<T[]> storage`, `size_t offset`, `vector<int64_t> shape`, `vector<int64_t> strides`, `dtype` (or just template on `T`). Then implement, in this order:

1. `operator()(i, j, ...)` → `storage[offset + Σ idx_k * stride_k]`. Nothing else in the class is allowed to touch memory.
2. `transpose()` / `permute()` — permute `shape` and `strides` together. **Assert the data pointer is unchanged.**
3. `slice(dim, start, stop, step)` — `offset += start*stride[dim]`, `stride[dim] *= step`, `shape[dim] = ceil((stop-start)/step)`. Then support `step < 0` and watch reversal fall out for free.
4. `broadcast_to(shape)` — insert leading dims of stride 0, and set stride 0 on any axis of size 1 that expands. **This is the whole of broadcasting.** No loop, no copy.
5. `is_contiguous()` — compute it, don't cache it yet. Then find the two edge cases NumPy handles and you didn't: size-0 arrays, and axes of size 1 (whose stride is arbitrary and must be ignored).
6. `reshape()` — the interesting one. Return a **view** when the stride pattern permits it, and a **copy** when it does not. Getting the "permits it" predicate right (it is *not* simply `is_contiguous()`) is the hardest 30 lines in the project.
7. `contiguous()` — the copy path, via a generic n-dimensional iteration.

**Success criterion:** a test file that, for ~20 index/slice/transpose/broadcast expressions, asserts your `.shape` and `.strides` match NumPy's exactly (strides in bytes, to match NumPy's convention — then note that PyTorch chose elements and think about why). And asserts view-ness: same base pointer ⇒ mutating through the view is visible through the parent.

**The lesson to extract afterwards:** you wrote broadcasting without writing a loop. Stride 0 means "the index doesn't advance the pointer", i.e. *read the same element N times*. Broadcasting is not a feature, it is an emergent property of allowing stride 0.

---

### P1 — Zero-copy export: the buffer protocol, then DLPack
**Teaches:** what "zero copy" actually costs, and that the hard part is lifetime, not layout.
**Time:** 4–6 h. **Depends on:** P0.

Expose `strided<float>` to Python twice:

- **Via PEP 3118.** Implement `bf_getbuffer`/`bf_releasebuffer`, fill a `Py_buffer` (`buf`, `obj`, `len`, `itemsize`, `readonly`, `ndim`, `format`, `shape`, `strides`, `suboffsets`), honour the request flags (`PyBUF_SIMPLE` must *fail* for a non-contiguous array — implement that refusal correctly, it's the point), and confirm `np.asarray(obj)` shares memory. Then hand it a transposed array and watch NumPy accept a Fortran-ordered view with no copy.
- **Via DLPack.** Implement `__dlpack__`/`__dlpack_device__` returning a `DLManagedTensorVersioned` with a working `deleter`. Confirm `np.from_dlpack(x)` and `torch.from_dlpack(x)` both alias your buffer.

**Success criterion:** `arr[0] = 99` in C++ is visible from NumPy without a re-import; and the destructor does not run while NumPy still holds the buffer. Deliberately break the second one (release too early), run under ASan, and read the use-after-free. That failure is the entire reason the protocols have a release/deleter callback.

---

### P2a — Scalar autograd (`micrograd`, but reimplemented, not copied)
**Teaches:** that the tape is a side effect of the forward pass and `backward()` is a topological sort.
**Time:** 4–6 h. **Depends on:** nothing.

A `Value` class with `data`, `grad`, `_prev` (the parents), and `_backward` (a closure that pushes gradient into the parents). Implement `+`, `*`, `tanh`/`relu`, `**`. `backward()` = build the topological order by DFS post-order, seed `self.grad = 1`, walk in reverse, call each `_backward`.

Then answer three questions with code, not prose:
1. Why must gradients **accumulate** (`p.grad += ...`) rather than assign? Construct a diamond DAG (`d = a*b + a*c`) where assignment gives the wrong answer.
2. What is `detach()`? Implement it — one line: return a new `Value` with the same data and empty `_prev`.
3. What is `no_grad()`? Implement it — a module-global flag that makes the constructors skip recording `_prev`. Note that it is a *flag on the recorder*, not a property of the tensor. (In PyTorch it is a thread-local excluded dispatch key, which is the same idea with better plumbing.)

**Success criterion:** finite-difference gradcheck. For 100 random small expression graphs, `|analytic − (f(x+h) − f(x−h))/2h| < 1e-5`. This is `torch.autograd.gradcheck` in ten lines, and building it is what makes the real one stop being magic.

---

### P2b — Tensor autograd on top of P0
**Teaches:** the one thing scalar autograd cannot teach — that **broadcasting in the forward pass is summation in the backward pass**.
**Time:** 10–15 h. **Depends on:** P0, P2a.

Same engine, but `data` is a `strided<float>`. Implement backward for `add`, `mul`, `matmul`, `sum(dim)`, `transpose`, `reshape`, `relu`.

The whole project is one insight: if forward broadcast `(3,1) → (3,4)`, backward must `sum` the incoming gradient over the expanded axis and reshape back. Get this wrong and shapes silently mismatch or silently broadcast again. Write `unbroadcast(grad, original_shape)` once and use it everywhere.

Second insight, nearly as valuable: **which ops must save their inputs.** `add` saves nothing. `mul` must save both operands. `matmul` must save both. `relu` needs only a mask (1 bit/element, but everyone stores a float tensor). Tabulate the memory cost of your backward pass per op — this is exactly the table the min-cut partitioner in AOTAutograd is optimising over, and exactly why activation checkpointing works.

**Success criterion:** train a 2-layer MLP on a toy dataset to convergence, and match PyTorch's gradients to 1e-5 on the same weights and inputs.

---

### P3 — The GEMM ladder
**Teaches:** arithmetic intensity, the memory hierarchy, and why BLAS level 3 exists at all.
**Time:** 12–20 h. **Depends on:** cache/SIMD material from earlier units. Compiler Explorer for the inner-loop assembly.

Compute `C = A·B` for square fp32 matrices at N = 1024 and N = 2048, and report GFLOP/s (`2N³/t`) at every rung:

| Rung | What changes | What to look at |
|---|---|---|
| 0 | Pure Python triple loop | Run at N=128 only, extrapolate. Record the number; you will quote it for the rest of your life. |
| 1 | NumPy elementwise, no BLAS (`(A[:,:,None]*B[None,:,:]).sum(1)`) | Fast per-op, terrible overall — it materialises an N³ temporary. Memory-bound by construction. |
| 2 | C++ naive `i,j,k` | Baseline. |
| 3 | Loop reorder to `i,k,j` | Same FLOPs, same code size, several × faster. **Diff the inner loop's assembly on Compiler Explorer** — with `-O2` and unit stride the compiler now auto-vectorises; with `j` innermost over `B[k][j]` it could not. |
| 4 | `-O3 -march=native -ffast-math` | Read the asm again: `vfmadd231ps` on `ymm`/`zmm` registers. |
| 5 | Cache blocking (tile M, N, K so a tile of A, B and C fits in L2) | Now measure L1/L2 miss rate with `perf stat -e L1-dcache-load-misses,LLC-load-misses`. |
| 6 | Register blocking (4×4 or 6×8 micro-kernel accumulating in vector registers) | This is where you beat naive by ~50×. |
| 7 | OpenMP over the outer tile loop | Scaling should be near-linear until you saturate memory bandwidth. |
| 8 | OpenBLAS / MKL / Accelerate `sgemm` | The target. Expect to reach 50–80 % of it, and to respect the remaining gap. |

Then do the **decisive experiment**: for level-1 (`axpy`), level-2 (`gemv`) and level-3 (`gemm`) at the same total FLOP count, plot achieved GFLOP/s. Level 1 and 2 flatline at the DRAM roofline; level 3 climbs to the compute roofline. Compute arithmetic intensity for each (O(1), O(1), O(N) FLOPs per byte) and put all three on a roofline plot.

**Success criterion:** a single plot with eight bars and a stated speedup ratio from rung 0 to rung 8, plus the roofline plot. The MIT 6.172 lecture-1 result for N=4096 is roughly a 50,000× span from Python to hand-tuned AVX+parallel — reproduce the *shape* of that curve on your own machine and you have internalised more than any reading will give you.

**The lesson:** the interpreter is only the first factor of ~50. The other ~1,000× is entirely about the memory hierarchy and the vector units — which is why "just rewrite it in C" is a wrong answer, and why `A @ B` calls a library written by people who spent years on rung 6.

---

### P4 — A dispatcher
**Teaches:** that PyTorch's most intimidating subsystem is about 200 lines of ideas.
**Time:** 10–14 h. **Depends on:** P0, P2b.

Build a miniature version with these parts and no others:

- `enum class Key : uint8_t` — `Autocast, Autograd, Logging, CPU, CUDA` — five keys, ordered so that priority = numeric value.
- `struct KeySet { uint64_t bits; Key highest() const { return countl_zero…; } }` with `|`, `-`, `&`.
- `struct Stack = std::vector<IValue>` where `IValue` is a two-word tagged union (pointer-or-scalar + tag) — copy the real design.
- A registry: `std::unordered_map<std::string, std::array<BoxedKernel, NumKeys>>` plus `std::array<BoxedKernel, NumKeys> fallbacks`.
- `thread_local KeySet tls_included, tls_excluded;` plus RAII `IncludeGuard` / `ExcludeGuard`.
- The formula, verbatim from PyTorch: `((tensor_keys | tls_included) - tls_excluded) & mask`.
- Templated **boxing and unboxing adapters** so you can register a typed `Tensor add_cpu(const Tensor&, const Tensor&)` *and* a boxed `void logging_fallback(Stack&)`.

Then use it:
1. Register `add`/`mul`/`matmul` at `CPU`.
2. Register a **boxed whole-column fallback** at `Logging` that prints the op name and redispatches. Turn it on with an `IncludeGuard` and watch every op in your MLP print itself, with zero per-op code.
3. Move your P2b autograd to a kernel at the `Autograd` key that opens an `ExcludeGuard(Autograd)` and redispatches below itself.
4. Add a `CUDA` key with one real kernel and prove the *same* Python-level call routes differently based only on the tensors' key sets.
5. Add a fallthrough: register nothing at `Autocast` for `add`, and confirm the mask skips the bit with no call.

**Success criterion:** you can add a new cross-cutting feature (say, a `Profiling` key that times every op) in under 20 lines and without touching any kernel. If you can't, your layering is wrong. Then go read `aten/src/ATen/core/dispatch/Dispatcher.h` and find the ten things the real one does that yours doesn't (per-backend fallthrough masks, `BackendSelect`, alias-key expansion, schema parsing, …).

---

### P5 — A custom CUDA op, done twice: the wrong way and the right way
**Teaches:** the difference between "a C function Python can call" and "an operator the framework understands".
**Time:** 8–12 h. **Depends on:** CUDA unit, P4 (conceptually). Needs the Modal GPU runner.

Pick a fusable kernel with a non-trivial backward — fused *bias + GELU*, or a numerically-stable row softmax — and ship it three times:

**Round 1, the naive way.** A `.cu` file, `PYBIND11_MODULE(TORCH_EXTENSION_NAME, m) { m.def("fused_gelu", &fused_gelu); }`, built with `torch.utils.cpp_extension.load_inline`. Use `TORCH_CHECK` for input validation, `AT_DISPATCH_FLOATING_TYPES_AND2(kHalf, kBFloat16, ...)` for dtype, `packed_accessor32<scalar_t,2,RestrictPtrTraits>()` for indexing, `at::cuda::getCurrentCUDAStream()` for the launch, and `C10_CUDA_KERNEL_LAUNCH_CHECK()` after it. It works.

Now demonstrate its three failures, each as a runnable assertion:
- `loss.backward()` raises — the op has no gradient.
- `torch.compile(fullgraph=True)` raises — Dynamo cannot see through an opaque pybind call, so it is a **graph break**.
- `torch.func.vmap` / `FakeTensor` / `meta` device all fail — there is no shape rule.

**Round 2, the dispatcher way.** Re-register as:

```cpp
TORCH_LIBRARY(myops, m) {
  m.def("fused_gelu(Tensor x, Tensor bias) -> Tensor");
  m.def("fused_gelu_backward(Tensor grad, Tensor x, Tensor bias) -> (Tensor, Tensor)");
}
TORCH_LIBRARY_IMPL(myops, CUDA, m) { m.impl("fused_gelu", fused_gelu_cuda); }
TORCH_LIBRARY_IMPL(myops, CPU,  m) { m.impl("fused_gelu", fused_gelu_cpu);  }  // reference impl
TORCH_LIBRARY_IMPL(myops, Autograd, m) { m.impl("fused_gelu", fused_gelu_autograd); }
```

plus a `torch::autograd::Function` for the Autograd cell and a Python `@torch.library.register_fake("myops::fused_gelu")` meta kernel returning `torch.empty_like(x)`. Re-run all three failing assertions; they now pass.

**Round 3, prove it was worth it.** Benchmark the fused kernel against the unfused eager chain `x + bias` then `gelu` at several sizes, and explain the speedup **in bytes moved, not in FLOPs**: unfused reads x, writes tmp, reads tmp, writes out = 4 passes over HBM; fused = 2. Predicted speedup 2×; measure how close you get. Then `torch.compile` the *unfused* eager chain and observe Inductor find the same fusion by itself — and dump its generated Triton with `TORCH_COMPILE_DEBUG=1` to see what it wrote instead of what you wrote.

**Success criterion:** `torch.library.opcheck` passes all four suites (`test_schema`, `test_autograd_registration`, `test_faketensor`, `test_aot_dispatch_dynamic`), `torch.autograd.gradcheck` passes in float64, `torch.compile(fullgraph=True)` compiles without a graph break, and you can state the memory-traffic argument for the speedup before you measure it. Bonus round: try `torch._dynamo.allow_in_graph` on the Round-1 function instead of registering it properly — the graph break vanishes and the *silent* failures of §2.6.1 appear. Finding one of those is worth more than the whole rest of the project.

---

### P6 — A caching allocator, and a sync hunt
**Teaches:** why `cudaMalloc` is unusable in a training loop, quantitatively; and where your throughput actually went.
**Time:** 6–10 h. **Depends on:** CUDA unit. Modal GPU.

**Part A.** Write a benchmark that allocates and frees tensors in a realistic pattern (varying sizes, LIFO-ish, thousands of iterations) through (a) raw `cudaMalloc`/`cudaFree` and (b) a caching allocator you write: size-rounded free lists, a small pool (<1 MB) and a large pool, block splitting on allocate and coalescing on free, and a per-stream association. Report allocations/second for both. The gap is large and it is *the* justification for the subsystem — `cudaFree` implicitly synchronises the device, so in the raw version every free is a pipeline drain.

Then reproduce **fragmentation**: alternate large and small allocations until the caching allocator OOMs with plenty of free memory reported. Fix it with `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` on the real thing and explain why virtual-memory-backed expandable segments dissolve the problem that splitting created.

**Part B.** Take a small training loop that logs `loss.item()` every step. Profile it with Nsight Systems and with `torch.cuda.set_sync_debug_mode("warn")`. Find every implicit synchronisation: `.item()`, `print(tensor)`, `.cpu()`, `bool(t)`, `t.tolist()`, indexing with a boolean mask, `torch.nonzero`. Remove them (accumulate the loss on-device, `.item()` once every 100 steps) and measure the throughput change. On a small model this is routinely 10–30 %.

**Success criterion:** two numbers — allocator throughput ratio, and steps/sec before vs after the sync hunt — plus a one-paragraph explanation of why an *asynchronous* API makes a *read* the expensive operation.

---

### P7 — A toy Dynamo: bytecode-level graph capture
**Teaches:** what "graph capture" means mechanically, and therefore what a graph break really is.
**Time:** 10–16 h. **Depends on:** P2b (you need a graph to capture into). Python only.

Two levels, and the first is enough for the lesson:

**Level 1 (pure Python).** A `@trace` decorator that:
1. `dis.get_instructions(fn.__code__)` to get the bytecode.
2. Symbolically executes it against a model of the value stack. Every stack slot holds a `VariableTracker`: either a `TensorVar` (symbolic — knows shape/dtype, records ops into an FX-style graph) or a `ConstVar` (a real Python value, evaluated for real).
3. Handles enough opcodes to run a small MLP forward: `LOAD_FAST`, `LOAD_CONST`, `LOAD_GLOBAL`, `LOAD_ATTR`, `CALL`/`CALL_FUNCTION`, `BINARY_OP`, `STORE_FAST`, `RETURN_VALUE`, `POP_JUMP_IF_*`, `FOR_ITER`.
4. Emits **guards** — the observable properties it assumed. `x.shape == (32, 784)`, `x.dtype == float32`, `id(self.linear1) == 0x…`, `type(cfg) is dict`.
5. Caches the compiled graph keyed on the code object; on re-entry, check guards, hit or recompile.

Then deliberately provoke each kind of graph break and watch your tracer handle it:
- `if x.sum() > 0:` — a `POP_JUMP_IF_TRUE` on a **symbolic** value. You cannot pick a branch. This is *the* graph break, and building the tracer is what makes it obvious: the bytecode demands one bit that only the GPU knows.
- `if cfg["deep"]:` — a jump on a **concrete** value. No break; you just take the branch and bake it into a guard. Note the asymmetry: Python control flow over Python data is free, over tensor data is fatal.
- `print(x)` / `x.item()` — forces materialisation.
- A call into an opaque C extension (your P5 Round-1 pybind function).

Implement the recovery properly: compile the prefix, execute the offending instruction in real Python, and generate a `torch_dynamo_resume_in_*`-style continuation that resumes tracing after it. Doing this once explains every `TORCH_LOGS=graph_breaks` message you will ever read.

**Level 2 (optional, for the systems-minded).** A tiny C extension using PEP 523: `_PyInterpreterState_SetEvalFrameFunc` to install your own frame evaluator, `_PyCode_GetExtra`/`SetExtra` with a claimed extra index to cache per-code-object state. Now the interception is *transparent* — no decorator needed, exactly like the real Dynamo (`torch/csrc/dynamo/eval_frame.c`). Expect to spend most of the time on CPython version differences; that is itself a lesson in why this approach is maintenance-expensive and why PyTorch pays it anyway.

**Success criterion:** your tracer captures a 3-layer MLP forward as one graph with correct guards, correctly refuses to capture data-dependent control flow, and correctly recompiles when a guard fails. Then run `torch._dynamo.explain(fn)(x)` on the same function and compare your graph-break list to the real one.

---

### P8 — Capstone: an Inductor in miniature
**Teaches:** the payoff — that the compiler's job is deleting memory round-trips, and Triton is how you say that.
**Time:** 12–20 h. **Depends on:** P7, P3, P5. Modal GPU.

Take the graph P7 captured. Walk it, find maximal chains of elementwise ops with no intervening reduction, and for each chain emit **one Triton kernel** that loads the inputs once, does the whole chain in registers, and stores once:

```python
@triton.jit
def fused(in0, in1, out, n, BLOCK: tl.constexpr):
    pid = tl.program_id(0)
    offs = pid * BLOCK + tl.arange(0, BLOCK)
    mask = offs < n
    a = tl.load(in0 + offs, mask=mask)
    b = tl.load(in1 + offs, mask=mask)
    tl.store(out + offs, tl.maximum(a + b, 0.0), mask=mask)   # the whole chain
```

Benchmark against the unfused eager chain and against `torch.compile`. Predict the speedup from bytes moved *first*, then measure. Add `triton.autotune` over `BLOCK` and `num_warps` and see how much of the remaining gap is tuning.

Then extend to a reduction (a fused softmax: max, subtract, exp, sum, divide — five passes over memory unfused, one fused) and compare against `torch.softmax`. Finally, dump what Inductor generates for the same graph (`TORCH_COMPILE_DEBUG=1`) and read its kernel next to yours. Where it is better, find out why.

**Success criterion:** a table of (op chain, unfused ms, your fused ms, `torch.compile` ms, predicted-from-bandwidth ms) where your predicted column is within ~25 % of your measured column. Being able to *predict* is the whole point; being fast is a side effect.

---

### Sequencing and dependency graph

```
P0 strided ──┬── P1 buffer/DLPack
             │
             ├── P2b tensor autograd ── P4 dispatcher ──┐
P2a scalar ──┘                                          │
                                                        ├── P8 capstone
P3 GEMM ladder ─────────────────────────────────────────┤
                                                        │
CUDA unit ──┬── P5 custom op ──────────────────────────┤
            └── P6 allocator + sync hunt                │
                                                        │
P7 toy Dynamo ──────────────────────────────────────────┘
```

**If time is short, the irreducible three are P0, P2b and P3.** Strides, the tape, and the memory hierarchy. Everything else in this document is an elaboration of those three ideas at industrial scale.
# 6. Curriculum — six units in dependency order

Each unit states **the one idea**, its prerequisites, and machine-checkable exercises. Three checking backends are available:

- **[CE]** Compiler Explorer — compiles and *runs* C++ and shows the generated assembly. Checkable by program exit code / stdout assertion, **and** by asserting on the assembly text (instruction mnemonics present/absent, instruction counts).
- **[GPU]** Modal GPU runner — CUDA compile + run, plus `nsys`/`ncu` counters.
- **[PY]** Python output assertions — the student's script must print/return values the checker compares, or must pass `assert` statements the checker appends.

A note on exercise design that carries over from the CUDA unit: prefer checks on **structure** (strides, instruction mnemonics, graph node counts, byte counts) over checks on **wall-clock time**. Timing checks are flaky on shared infrastructure and teach the student to fear the checker. Where a timing claim is the point, check a *ratio* with a wide tolerance, and pair it with a structural check that fails deterministically.

---

## Unit 1 — Strides: an array is a view of flat memory

**The one idea:** *Memory is a flat byte array. Shape is metadata. Strides are the entire interface between them — and every zero-copy trick in the stack (transpose, slice, broadcast, reversal, channels-last) is a stride edit.*

**Prerequisites:** C++, pointers, the cache material from earlier units.

**Content.** `PyArrayObject` fields (`data`, `nd`, `dimensions`, `strides`, `descr`, `base`, `flags`) and the fact that the struct is opaque since NumPy 1.7 — you go through `PyArray_DATA/DIMS/STRIDES`. The address formula. Transpose as stride permutation. Slicing as pointer offset + stride scale. Broadcasting as stride 0. Negative strides. C order vs Fortran order and why the *ordering of the strides array*, not a flag, is what actually determines layout. The flags (`C_CONTIGUOUS`, `F_CONTIGUOUS`, `OWNDATA`, `WRITEABLE`, `ALIGNED`, `WRITEBACKIFCOPY`) and the fact that a 1-D array can be both C- and F-contiguous. When a copy is *forced*: advanced/fancy indexing always; non-contiguous reshape; `ascontiguousarray`. Then the same story in PyTorch — `TensorImpl` `sizes_and_strides_` / `storage_offset_` / `Storage`, with strides in **elements** not bytes, plus `contiguous()`, `view` vs `reshape`, `expand` vs `repeat`, and `channels_last` as a fifth contiguity.

**Build:** P0, P1.

**Exercises.**

1. **[PY] Predict the metadata.** Given 15 expressions (`a.T`, `a[::2, 1:]`, `a[:, None]`, `np.broadcast_to(a, ...)`, `a[::-1]`, `a.reshape(...)`, `a.T.reshape(-1)`, …) over a known base array, the student writes down `shape`, `strides`, `flags.C_CONTIGUOUS`, `flags.OWNDATA` and **whether it shares memory** — *before running anything*. Checker: compares the student's answer dict against the truth computed live, and additionally asserts `np.shares_memory(base, result)` matches the predicted view/copy verdict. Deterministic, no timing, and it is the single highest-value exercise in the unit.

2. **[PY] The copy detector.** Write `def is_view(base, derived) -> bool` using only `.base`, `__array_interface__['data'][0]` and `.strides` — no `np.shares_memory`. Checker: 30 hidden cases including the traps (a copy that happens to land at the same address after a GC cycle; a view with `OWNDATA=False` but a different base object; `a.view(np.int32)` on a float array).

3. **[CE] Implement `is_contiguous`.** Given a `{shape, strides}` pair in C++, return C-contiguous / F-contiguous / neither. Checker: hidden table of ~40 cases, including size-0 arrays, arrays with an axis of size 1 (whose stride must be ignored), and 0-d arrays (contiguous in both). Failing the size-1 case is expected and is the teaching moment.

4. **[CE] Broadcast without a loop.** Given two shapes, produce the broadcast shape and the two adjusted stride vectors, per NumPy's rules. Checker: compares against NumPy's `np.broadcast_shapes` and `np.broadcast_arrays(...)[i].strides` for hidden shape pairs, including the error cases (must return a failure code for incompatible shapes).

5. **[CE] The stride-order performance claim, verified two ways.** Write a 2-D sum in both `i,j` and `j,i` order. **(a)** Assert on the assembly that the unit-stride version vectorises (`vaddps`/`vfmadd` on `ymm`/`zmm` present) and the strided one does not, or uses gathers (`vgatherdps`). **(b)** Assert the runtime ratio exceeds 3× at N=4096 with generous tolerance. Part (a) is the deterministic check; part (b) is the motivation.

6. **[PY] Fifteen puzzles in stride tricks.** Implement a sliding-window view with `np.lib.stride_tricks.as_strided` (then rewrite it with `sliding_window_view` and compare), and *break* it deliberately by requesting a window that reads past the buffer. Checker: the correct version matches a reference; the broken version must be identified by the student as out-of-bounds and the checker verifies the claimed byte overrun matches the real one. Teaches that `as_strided` is unchecked and that the flags system is the only guardrail.

---

## Unit 2 — Where the compute goes: ufuncs, iterators, SIMD, BLAS

**The one idea:** *A Python loop does not lose because Python is slow. It loses because it forfeits the vector units and the memory hierarchy — and the second loss is ~20× larger than the first. Arithmetic intensity decides which loss dominates.*

**Prerequisites:** Unit 1; SIMD and cache material from earlier units.

**Content.** What a ufunc is: a set of typed 1-D inner loops with signature `void (*)(char **args, npy_intp const *dimensions, npy_intp const *steps, void *data)` plus a type-resolution step that picks one. Note that `steps` is per-operand and in bytes — *the inner loop is stride-aware, which is why ufuncs work on views without copying.* The iterator (`NpyIter`/`nditer`): broadcasting, buffering for non-contiguous or misaligned operands, axis coalescing and reordering so the innermost loop is the one with the best memory access. NumPy's universal-SIMD layer (`numpy/_core/src/common/simd/`, `*.dispatch.c.src`, runtime CPU feature dispatch, `np.show_config()`). Then the handoff: BLAS levels 1/2/3 with their FLOP-to-byte ratios (O(1), O(1), O(N)) — this is the entire argument. `np.dot`/`@` routing into `cblas_sgemm`/`dgemm`, and the conditions under which NumPy declines to call BLAS. OpenBLAS vs MKL vs Accelerate, and how to find out which one you actually linked.

**Build:** P3.

**Exercises.**

1. **[PY] Which BLAS am I running, and does it matter?** Print the linked BLAS from `np.show_config()` / `threadpoolctl`, then run the same `A @ B` at N=2048 with `OMP_NUM_THREADS` set to 1 and to `nproc`. Checker: asserts the reported library name is one of the known set, asserts GFLOP/s at 1 thread is within a plausible band for the machine, and asserts multi-thread ≥ 2× single-thread. Teaches that "NumPy is fast" is a statement about a linked library, not about NumPy.

2. **[PY] Force the copy.** Construct four cases where `A @ B` must copy before reaching BLAS (non-contiguous input, mixed dtype, non-native byte order, a strided view) and measure the overhead versus the pre-`ascontiguousarray` version. Checker: student reports for each case whether a copy occurred; verified against peak-memory instrumentation (`tracemalloc` on a memory-mapped array, or `np.shares_memory` on the intermediate). Deterministic.

3. **[CE] Write a ufunc inner loop by hand.** Given the real signature, implement `add` for `float32` respecting arbitrary `steps`. Checker: called with hidden `(args, dimensions, steps)` triples including negative steps (reversed views), zero steps (broadcast scalars) and overlapping in/out pointers. Almost everyone writes `for(i) out[i] = a[i] + b[i]` and fails on the first three. This single exercise makes the ufunc ABI permanently legible.

4. **[CE] The level-1/2/3 roofline.** Implement `axpy`, `gemv`, `gemm` naively. Report FLOPs, bytes moved, and arithmetic intensity for each, computed *from the source*, not measured. Checker: asserts the AI formulas are right symbolically (evaluated at several N), then asserts measured GFLOP/s ordering `gemm > gemv ≳ axpy` and that `axpy` and `gemv` are within 2× of each other (both DRAM-bound) while `gemm` is ≥ 5× either. The structural half (AI arithmetic) is the deterministic check.

5. **[CE] Loop order and blocking, checked on the assembly.** Rungs 2→6 of P3, each submitted separately. Deterministic checks: rung 3 must show packed FMA in the inner loop; rung 6 must show ≥ 8 distinct accumulator registers live across the inner loop (count `ymm`/`zmm` registers appearing as FMA destinations) — that is register blocking, provable statically. Timing checks are secondary.

6. **[PY] Quantify the ladder.** One table: pure-Python triple loop, NumPy elementwise-with-temporary, `np.dot`. Same N. Report GFLOP/s and the ratio. Checker: asserts the reported ratios are within an order of magnitude of the expected shape (Python:NumPy-elementwise:BLAS roughly 1 : 10² : 10³–10⁴ on modern hardware) and — the real check — asserts the student's written explanation names *memory traffic*, not *interpreter overhead*, as the dominant term between rungs 2 and 3. (Check by requiring a structured answer: the student submits the byte-count for each rung and the checker verifies the arithmetic.)

---

## Unit 3 — The glue: refcounts, the GIL, bindings, DLPack

**The one idea:** *A Python object is a refcounted C struct, and the GIL is the lock protecting that refcount. "Fast Python" therefore means one thing: spend as little time as possible being a Python object — cross into C once, release the GIL, and do a lot of work before coming back.*

**Prerequisites:** Unit 1 (you need something worth passing across the boundary). Threads/locks from the OS unit.

**Content.** `PyObject` = `{ob_refcnt, ob_type}`. `Py_INCREF`/`Py_DECREF`, new vs borrowed vs stolen references, and the three classic bugs each convention causes. Reference cycles and the generational cyclic GC (`tp_traverse`/`tp_clear`). What the GIL protects and why it makes pure-Python threading useless for CPU work. `Py_BEGIN_ALLOW_THREADS` / `pybind11::gil_scoped_release` / Cython `with nogil` — where NumPy and PyTorch release it, and the invariant that makes it safe (touch no `PyObject*` while it is released). Why `DataLoader(num_workers>0)` uses **processes**. The binding-technology comparison: ctypes/cffi (no build step, per-call marshalling, C only), Cython (generates C, great over typed memoryviews), pybind11 (header-only C++ template metaprogramming, big binaries, slow compiles), nanobind (the same idea rebuilt for size and speed), and the free-threaded (PEP 703) build's implications. DLPack: `DLTensor {data, device, ndim, dtype, shape, strides, byte_offset}` + `manager_ctx` + `deleter`, the `__dlpack__`/`__dlpack_device__` protocol, and why it supersedes the buffer protocol (which is CPU-only).

**Build:** P1.

**Exercises.**

1. **[PY] Refcount forensics.** Using `sys.getrefcount`, predict the refcount of an object at eight points in a script (after binding, after appending to a list, inside a function call, after `del`, inside a `try/except` that captures a traceback, …). Checker: exact integer match. Then explain the off-by-one from `getrefcount`'s own argument. Brutal, deterministic, and it makes refcounting concrete in twenty minutes.

2. **[CE / C build] Leak a reference on purpose.** Write a C extension function that returns a new reference correctly, then three broken variants: missing `INCREF` on a borrowed return, missing `DECREF` on an error path, and a `DECREF` on a stolen reference. Checker: runs each under a refcount-audit build (or asserts on `sys.gettotalrefcount()` deltas across 10⁵ calls) and requires each variant to be correctly *classified* by the student as leak / premature-free / double-free.

3. **[PY] Prove the GIL, then prove it released.** Run the same CPU-bound workload as (a) a pure-Python function in 1 vs 4 `threading.Thread`s, (b) a NumPy `A @ B` in 1 vs 4 threads. Checker: asserts (a)'s speedup is < 1.3× and (b)'s is > 1.8×, and asserts the student's stated reason names GIL release in the C code. Note in the material that on a free-threaded 3.13+/3.14 build (a) changes — and make that an optional bonus run, because it dates the lesson honestly.

4. **[PY] DLPack round-trip.** Move a tensor NumPy → PyTorch → back, asserting the data pointer is unchanged at every hop (`x.__array_interface__['data'][0]` vs `t.data_ptr()`). Then do it on CUDA and confirm the buffer protocol *cannot* (it raises), while DLPack can. Checker: pointer equality assertions, plus a mutation-visibility assertion in both directions.

5. **[PY] Deleter lifetime.** Construct a DLPack capsule whose producer is garbage-collected while the consumer still holds the tensor. Checker: asserts the consumer's data is still valid (i.e. the student wired `manager_ctx`/`deleter` correctly and the producer's memory is kept alive), and asserts that a deliberately-broken variant is detected by ASan/valgrind with a use-after-free. Ownership is the actual content of every interchange protocol; this is where to teach it.

6. **[CE] Binding cost, measured.** Expose the same trivial function (`float add(float,float)`) via ctypes, Cython and pybind11/nanobind. Measure nanoseconds per call from Python. Checker: asserts the *ordering* of per-call overhead matches expectation and that each measured value is within a wide band; the point is the order of magnitude (tens to hundreds of ns per crossing) versus the ~1 ns of the actual add. Which is exactly why you never put the boundary inside a loop.

---

## Unit 4 — The dispatcher: an operator is a table, not a function

**The one idea:** *In PyTorch, an operator is a row in a table and a cross-cutting feature is a column; a kernel is a cell. Every "how does X compose with Y" question — autograd with CUDA, autocast with sparse, vmap with a custom op — is answered by the ordering of bits in a 64-bit integer.*

**Prerequisites:** Units 1 and 3. (You need strides for `TensorImpl` and the C-API layer for the frontend.)

**Content.** The four layers (Python → `torch._C` bindings → dispatcher → ATen kernels, over c10). The codegen story: `native_functions.yaml` schemas, `derivatives.yaml`, `structured_delegate`, and the generated `RegisterCPU.cpp`/`VariableType_*.cpp` — hence *why you cannot grep for the body of `torch.add`*. `TensorImpl` field by field, `StorageImpl`, the device/layout/dtype trinity. Then the dispatcher proper: `DispatchKey` as a bit index, the backend-bits × functionality-bits encoding, `DispatchKeySet` as one `uint64_t`, priority as count-leading-zeros, TLS included/excluded sets, the formula `((ks | included) - excluded) & mask`, `after_autograd_keyset` as `FULL_AFTER`, fallthrough, `BackendSelect`, boxed vs unboxed and why boxing is what makes whole-column fallbacks affordable, `TORCH_LIBRARY`/`TORCH_LIBRARY_IMPL`, alias keys.

**Build:** P4, P5 (Rounds 1 and 2).

**Exercises.**

1. **[CE] Implement `computeDispatchKeySet` and `highestPriorityTypeId`.** Given a key ordering, implement the bitset ops and the formula. Checker: hidden `(tensor_keys, included, excluded, mask) → expected_key` table of ~50 cases, including exclusion-beats-inclusion, empty-result-is-Undefined, and fallthrough masking. Pure logic, fully deterministic, and it *is* the real code.

2. **[CE] The backend-bits encoding.** Implement `DispatchKey → (functionality_bit, backend_bit)` and the inverse, plus the runtime-table index computation `num_functionality_keys + numPerBackendFunctionalityKeys() * (num_backends - 1)`. Checker: round-trips every runtime key, and asserts your table size matches the formula. Teaches why `SparseCUDA` is not its own bit.

3. **[PY] Observe the dispatch.** Use `torch._C._dispatch_dump("aten::add.Tensor")` and `torch._C._dispatch_key_set(tensor)` to print the real table and the real key set for CPU/CUDA/sparse/`requires_grad` tensors. Then predict the key set for eight tensor configurations before printing. Checker: exact string/set match. *(Flagged: these private APIs exist but their exact spelling drifts between versions — pin the version in the exercise and verify at authoring time. `torch.__config__.show()` and `torch._C._dispatch_print_registrations_for_dispatch_key` are alternates.)*

4. **[PY] Build a whole column.** Using `TorchDispatchMode` (the Python-level equivalent of registering at the `Python` key), write a mode that logs every aten op a `nn.Linear` forward+backward invokes, with shapes. Checker: asserts the logged op sequence matches a reference list. This is the boxed-fallback idea, reachable in 15 lines of Python, and it makes the C++ version obvious.

5. **[CE] Redispatch without infinite recursion.** In your P4 dispatcher, register an `Autograd` kernel that calls back into `dispatch()`. Checker: asserts the call terminates, asserts the backend kernel ran exactly once, and — the interesting one — asserts that removing the `ExcludeGuard` produces a stack overflow (the checker expects a crash). Learning why the guard exists by deleting it is worth more than reading about it.

6. **[GPU] The three failures and their fix.** P5 Rounds 1→2. Checker: for Round 1, asserts `loss.backward()` raises, asserts `torch.compile(fullgraph=True)` raises with a graph-break error, asserts `.to("meta")` propagation fails. For Round 2, asserts all three now succeed and `gradcheck` passes in float64. Deterministic pass/fail on exception type, no timing at all.

---

## Unit 5 — Autograd: the tape is a side effect

**The one idea:** *PyTorch does not have a graph; it has a trail of breadcrumbs left by the forward pass. `backward()` is a topological traversal of that trail, and `no_grad` simply stops dropping breadcrumbs. Contrast: JAX's `grad` never runs the forward pass at all — it transforms the program.*

**Prerequisites:** Unit 4 (autograd is a dispatch key), Unit 1 (backward-through-broadcast needs strides).

**Content.** `AutogradMeta` hanging off `TensorImpl` (`grad_`, `grad_fn_`, `grad_accumulator_`, `requires_grad_`, `output_nr_`), and the fact that it is a nullable pointer so `requires_grad=False` is free. `Node` and its `next_edges_` of `Edge{function, input_nr}` — the graph is stored in the *outputs*, pointing backwards. `sequence_nr_`/`topological_nr_`. What `y = (a*b).sum()` builds, node by node, and where `AccumulateGrad` sits. The engine: `compute_dependencies` as an in-degree count, `ReadyQueue`, `InputBuffer` accumulating multiple incoming gradients before a node becomes ready, per-device worker threads, and why this is a topological traversal rather than a DFS. `GradMode` as a thread-local, `no_grad` vs `inference_mode` vs `detach()` — three different things people conflate. The version counter and the in-place-modification error. Custom `autograd.Function` with `save_for_backward` / `setup_context`, and `gradcheck`. Then, deliberately alongside: **JAX's `grad` as a program transformation** — `jvp`/`vjp`/`linearize`, transforms that compose (`jit(vmap(grad(f)))`), and the observation that PyTorch's `torch.func` is the same idea retrofitted.

**Build:** P2a, P2b.

**Exercises.**

1. **[PY] Draw the graph.** For `z = (a*b + a).sum()`, walk `z.grad_fn` and `next_functions` and print the DAG. Checker: asserts the printed node-type sequence and edge structure match a reference (`SumBackward0 → AddBackward0 → {MulBackward0 → {AccumulateGrad(a), AccumulateGrad(b)}, AccumulateGrad(a)}`). Note `a` appears twice — that is the diamond, and it is why gradients accumulate.

2. **[PY] Gradcheck your own engine.** P2a/P2b against `torch.autograd.gradcheck` semantics. Checker: 100 random expression graphs, `max|analytic − central_difference| < 1e-5` in float64.

3. **[PY] Unbroadcast.** Implement `unbroadcast(grad, target_shape)` and use it in the backward of `add` and `mul`. Checker: 40 hidden shape pairs, compared against PyTorch's own gradients for the same op. The failure mode (silently correct shape, wrong values, because you reshaped instead of summing) is caught by comparing values, not shapes — make sure the checker does.

4. **[PY] Three ways to stop a gradient, distinguished.** For `no_grad`, `detach()`, `requires_grad_(False)` and `inference_mode`, produce a table of: does the output have a `grad_fn`? does it share storage? can it later be used in a graph? does it bump the version counter? Checker: exact boolean table match, verified live. Most people cannot fill this in from memory and it takes ten minutes to derive experimentally.

5. **[PY] Trigger and explain the in-place error.** Write the minimal program that raises *"one of the variables needed for gradient computation has been modified by an inplace operation"*, then fix it three ways (clone, reorder, use the out-of-place op). Checker: asserts the first raises `RuntimeError` with that message and the three fixes produce identical gradients. Then a second version where the in-place op is *safe* (the saved tensor isn't needed) and no error is raised — asserting the student can predict which is which is the real check.

6. **[PY] Custom Function with a non-obvious backward.** Implement a straight-through estimator or a custom clipped activation as `torch.autograd.Function` with `setup_context`. Checker: `gradcheck` passes where mathematically expected and *fails* where the student's estimator is deliberately non-exact — with the student required to predict which. Teaches that autograd computes what you told it to, not what is true.

7. **[PY] The contrast, made concrete.** Same function `f`, differentiated three ways: PyTorch tape (`backward()`), `torch.func.grad`, and `jax.grad`. Print `jax.make_jaxpr(jax.grad(f))(x)` and `torch.fx` / `torch._dynamo.explain` output for the same. Checker: asserts numerical agreement to 1e-6 across all three, and asserts the student's structured answer correctly states which ran the Python body (a) once per call, (b) once per shape signature, (c) never. This is the unit's punchline and it needs to be an exercise, not a paragraph.

---

## Unit 6 — Asynchrony and its price; compilation as the answer

**The one idea:** *Eager mode's cost is two things: a few microseconds of dispatch and launch overhead per operator, and a round trip to HBM per operator. `torch.compile` exists to delete both — Dynamo captures a graph so there is something to optimise, and Inductor fuses so the memory traffic collapses. Everything about graph breaks and synchronisation points follows from that sentence.*

**Prerequisites:** Units 4 and 5; the CUDA unit.

**Content, in two halves.**

*Half A — the async machine.* Kernel launches are asynchronous with respect to the host; the CPU runs ahead enqueuing work. Streams and the current-stream TLS. The caching allocator: why `cudaMalloc`/`cudaFree` are unusable in a training loop (they synchronise), what the allocator does instead (pools, splitting, coalescing, stream association, `record_stream`), fragmentation, `expandable_segments`, `PYTORCH_CUDA_ALLOC_CONF`, `memory_snapshot`. Per-launch overhead of a few microseconds and the regime where it dominates (small tensors, many ops). CUDA graphs as the amortisation. Then the throughput killer: **any host read of device data drains the pipeline** — `.item()`, `print`, `.cpu()`, `bool(t)`, boolean-mask indexing, `nonzero` — and `set_sync_debug_mode` / `CUDA_LAUNCH_BLOCKING=1` as the tools.

*Half B — staging.* TorchDynamo's PEP 523 frame-evaluation hook: it replaces CPython's frame evaluator, symbolically executes the bytecode with `VariableTracker`s, emits an FX graph plus **guards**, caches on the code object, and rewrites the bytecode to call the compiled artifact. Graph breaks: what causes them, what the recovery looks like (`torch_dynamo_resume_in_*` continuations), why they cost you fusion and CUDA graphs. Dynamic shapes and recompilation limits. AOTAutograd: trace forward *and* backward ahead of time, functionalize, decompose to core ATen, and partition with a min-cut that decides save-vs-recompute (activation checkpointing, as a compiler pass). TorchInductor: lower to a loop-level IR, schedule and fuse, then **generate Triton for GPU and C++/OpenMP for CPU**. Triton itself: a block-level DSL where you write `tl.load`/`tl.store` with masks over a `BLOCK_SIZE` tile and the compiler handles intra-block scheduling. Modes: `reduce-overhead` (CUDA graphs), `max-autotune` (benchmark Triton GEMM templates against cuBLAS). Then the coda: **TF's `tf.function` + AutoGraph + XLA, and JAX's `jit`, reach the same destination by tracing with abstract values instead of reading bytecode** — cheaper to implement, but it changes the semantics of your Python (control flow must become `lax.cond`/`scan`), which is exactly the trade PyTorch refused.

**Build:** P5 (Round 3), P6, P7, P8.

**Exercises.**

1. **[GPU] Prove asynchrony.** Time a kernel launch loop with and without a trailing `torch.cuda.synchronize()`. Checker: asserts the un-synchronised timing is implausibly small (below the kernel's own measured duration), asserts the synchronised timing is ≥ the CUDA-event-measured duration, and asserts the student correctly labels the first number as meaningless.

2. **[GPU] The allocator, quantified.** P6 Part A. Checker: asserts allocations/sec for the caching path exceeds the raw `cudaMalloc` path by a large factor (assert ≥ 10×, expect far more), and — the deterministic half — asserts the student's allocator satisfies a behavioural spec: a free followed by a same-size alloc returns the *same pointer*; a split block's two halves coalesce on free; a `cudaMalloc` count that does not grow after warm-up. That last assertion is exact and is the real definition of "caching".

3. **[GPU] Hunt the syncs.** Given a deliberately-sabotaged training loop (seven implicit syncs hidden in it), find them all. Checker: asserts the student's list of line numbers matches, verified independently by running under `torch.cuda.set_sync_debug_mode("error")` and checking the loop completes after their fixes. Exact and satisfying.

4. **[GPU] Fusion, predicted then measured.** For `y = torch.relu(x * a + b)`, count HBM bytes moved eager (unfused) and fused, predict the speedup, then measure eager vs `torch.compile`. Checker: asserts the predicted byte counts are exactly right (they are computable: N elements × 4 bytes × number of passes) and the measured ratio is within 40 % of predicted. Byte counting is the deterministic check; timing is the confirmation.

5. **[PY] Read the generated Triton.** Compile the above with `TORCH_COMPILE_DEBUG=1` and extract the generated kernel. Checker: asserts the dumped Triton source contains exactly one `tl.store` for the chain (proving fusion) and the expected number of `tl.load`s. Structural, deterministic, and it forces the student to actually open the file.

6. **[PY] Graph breaks, caused and cured.** Given five functions, use `torch._dynamo.explain()` to report the break count and reason for each; then fix four of them and correctly argue the fifth (genuine data-dependent control flow) cannot be fixed without changing semantics. Checker: asserts break counts before and after, asserts `fullgraph=True` succeeds on the four, and asserts it still fails on the fifth.

7. **[PY] Recompilation.** Call a compiled function with 12 distinct input shapes and observe recompiles with `TORCH_LOGS=recompiles`; then enable dynamic shapes and observe the count collapse. Checker: asserts the static-shape recompile count hits the `cache_size_limit` and falls back, and asserts the dynamic version compiles ≤ 2 times.

8. **[PY] The staging contrast.** Write the same function three ways: eager PyTorch, `torch.compile`, and `jax.jit`. Insert a `print("tracing")` in the body. Checker: asserts the print count is (a) once per call under eager, (b) once per *guard set* under `torch.compile`, (c) once per shape signature under `jax.jit` — and asserts the student's explanation identifies *when* the Python body ran in each case. This closes the loop with Unit 5, exercise 7, and it is the cleanest way to feel the difference between define-by-run and define-and-run.

---

## Notes on the sequencing

- **Units 1 and 2 are NumPy-only and CPU-only on purpose.** Strides and arithmetic intensity are easier to see without a device in the way, and every idea in them survives unchanged into PyTorch.
- **Unit 3 sits in the middle, not at the end,** because Unit 4 needs it: you cannot honestly explain `THPVariable` or why the dispatcher exists without knowing what a `PyObject` is and what the GIL costs.
- **Unit 4 before Unit 5 is non-negotiable.** Autograd *is a dispatch key*. Teaching autograd first forces you to describe it as magic and then un-teach that.
- **Unit 6 unifies the two performance stories** (per-op overhead from Unit 4, memory traffic from Unit 2) and shows one system attacking both. Putting the compiler last is what makes it feel like a consequence rather than a product feature.
- **The JAX/TF material is deliberately not its own unit.** Split across Units 5 (grad as a transform) and 6 (jit as staging), it earns its place as a contrast at the exact moments the contrast is illuminating. As a standalone unit it becomes a survey, which is the failure mode to avoid.
