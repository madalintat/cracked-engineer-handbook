## Which lane am I

Fill in `lane` and `warp` from the thread index. The checks run one block of 96
threads and verify every thread agrees with the hardware about which warp it is
in.

@kind output
@concept A warp is 32 consecutive threads, and the boundary is arithmetic on
the thread index rather than anything the runtime tells you.
@backend modal
@lang cuda
@gpu sm_75
@flags -O2
@expect verdict nonzero-exit
@hint `warpSize` is available inside a kernel. Use it rather than writing 32.
@diagnose wrong verdict nonzero-exit
Read the index the check names. Lane is the position within the warp and warp
is which warp of the block, so both come from `threadIdx.x` and the warp width.
Writing 32 instead of `warpSize` gives the right answer here and the wrong one
on hardware where a warp is 64 wide.
@diagnose compile verdict compile-error
Read the line nvcc names. `warpSize` exists only inside device code.
@after 96 threads is three warps exactly. Try 100 and the fourth warp is mostly
idle lanes, which is why block sizes are multiples of 32.

```starter
__global__ void identify(int* lane, int* warp) {
    int t = threadIdx.x;
    lane[t] = 0;
    warp[t] = 0;
}
```

```tests
#include <cstdio>
int main() {
    const int N = 96;
    int *lane, *warp;
    cudaMallocManaged(&lane, N * sizeof(int));
    cudaMallocManaged(&warp, N * sizeof(int));
    identify<<<1, N>>>(lane, warp);
    cudaDeviceSynchronize();
    for (int t = 0; t < N; t++) {
        if (lane[t] != t % 32) { printf("lane[%d]=%d want %d\n", t, lane[t], t % 32); return 1; }
        if (warp[t] != t / 32) { printf("warp[%d]=%d want %d\n", t, warp[t], t / 32); return 1; }
    }
    printf("ok\n");
    return 0;
}
```

```solution
__global__ void identify(int* lane, int* warp) {
    int t = threadIdx.x;
    lane[t] = t % warpSize;
    warp[t] = t / warpSize;
}
```

## Both sides of the branch

Each thread increments one of two counters depending on its lane. Count how
many times each side of the branch actually ran, by having every thread record
whether it executed a given side.

@kind output
@concept A warp runs both sides of a divergent branch, masking lanes off, so
both paths cost their full time.
@backend modal
@lang cuda
@gpu sm_75
@flags -O2
@hint Every thread must write to both arrays, not only to the one its branch
takes.
@expect verdict nonzero-exit
@diagnose wrong verdict nonzero-exit
The check compares what your kernel recorded against what the hardware does.
Sixteen lanes take each side, and the warp issues both sides one after the
other. If your counts say only one side ran, your kernel recorded the
programming model rather than the execution.
@diagnose silent silent
Nothing complained and a check failed. Look at whether every thread writes to
both output arrays or only to the one on its own path.
@after Now change the condition to `threadIdx.x < 32`. The split lands on a warp
boundary, no warp diverges, and the same 50% of threads costs nothing.

```starter
__global__ void split(int* took_a, int* took_b) {
    int t = threadIdx.x;
    took_a[t] = 0;
    took_b[t] = 0;
    if (t % 2 == 0) took_a[t] = 1;
}
```

```tests
#include <cstdio>
int main() {
    const int N = 64;
    int *a, *b;
    cudaMallocManaged(&a, N * sizeof(int));
    cudaMallocManaged(&b, N * sizeof(int));
    split<<<1, N>>>(a, b);
    cudaDeviceSynchronize();
    for (int t = 0; t < N; t++) {
        int wa = (t % 2 == 0) ? 1 : 0, wb = (t % 2 == 0) ? 0 : 1;
        if (a[t] != wa || b[t] != wb) {
            printf("t=%d a=%d b=%d want a=%d b=%d\n", t, a[t], b[t], wa, wb);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
__global__ void split(int* took_a, int* took_b) {
    int t = threadIdx.x;
    took_a[t] = 0;
    took_b[t] = 0;
    if (t % 2 == 0) took_a[t] = 1;
    else            took_b[t] = 1;
}
```

## The guard is not optional

A vector add over 1000 elements, launched with a whole number of 256-thread
blocks. The starter writes past the end of the data. Nothing crashes.

@kind output
@concept Your grid is a whole number of blocks, so unless the size divides
exactly there are threads past the end of the data.
@backend modal
@lang cuda
@gpu sm_75
@flags -O2 -lineinfo
@hint 1000 is not a multiple of 256.
@expect verdict nonzero-exit
@diagnose wrong verdict nonzero-exit
Read which index the check names. Four blocks of 256 threads is 1024 threads
for 1000 elements, so 24 threads write past the end. The checks put a sentinel
in the 24 slots beyond the data and report the first one that moved.

Notice what did not happen. There was no crash, no CUDA error and no sanitizer
report, because the write landed inside the same managed allocation. Out of
bounds is only reliably loud when it leaves the mapping entirely, and the rest
of the time it quietly corrupts something you were not looking at.
@diagnose silent silent
Nothing complained and a check failed. That is this exercise's whole point:
the wrong answer arrives with no complaint at all.
@diagnose cuda verdict cuda-error
CUDA reported a fault, which means the write left the mapping rather than
landing next door. That is the loud version of the same bug.
@after A grid-stride loop removes the special case entirely, and lets you
launch any grid for any `n`. That is the next exercise.

```starter
__global__ void vadd(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    c[i] = a[i] + b[i];
}
```

```tests
#include <cstdio>
int main() {
    const int N = 1000, SLACK = 24;   // 4 blocks x 256 threads = 1024
    float *a, *b, *c;
    cudaMallocManaged(&a, (N + SLACK) * sizeof(float));
    cudaMallocManaged(&b, (N + SLACK) * sizeof(float));
    cudaMallocManaged(&c, (N + SLACK) * sizeof(float));
    for (int i = 0; i < N + SLACK; i++) { a[i] = i; b[i] = 2 * i; c[i] = -7.0f; }
    vadd<<<(N + 255) / 256, 256>>>(a, b, c, N);
    cudaError_t e = cudaDeviceSynchronize();
    if (e != cudaSuccess) { printf("cuda error: %s\n", cudaGetErrorString(e)); return 2; }
    for (int i = 0; i < N; i++) {
        if (c[i] != 3.0f * i) { printf("c[%d]=%f want %f\n", i, c[i], 3.0f * i); return 1; }
    }
    for (int i = N; i < N + SLACK; i++) {
        if (c[i] != -7.0f) {
            printf("wrote past the end: c[%d]=%f, and the array is %d long\n", i, c[i], N);
            return 1;
        }
    }
    printf("ok\n");
    return 0;
}
```

```solution
__global__ void vadd(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) c[i] = a[i] + b[i];
}
```

## One launch for any size

Rewrite the same addition as a grid-stride loop, so the kernel is correct for
any `n` and any grid. The checks launch it three times with deliberately silly
configurations.

@kind output
@concept Decoupling the grid from the problem lets you tune occupancy without
touching correctness.
@backend modal
@lang cuda
@gpu sm_75
@flags -O2
@hint The stride is the total number of threads in the grid.
@expect verdict nonzero-exit
@diagnose wrong verdict nonzero-exit
One of the three launches produced a wrong element. The stride must be every
thread in the grid, which is `blockDim.x * gridDim.x`, not the block size.
@diagnose silent silent
Nothing complained and a check failed. Work out by hand which elements a single
block of one thread visits with your stride.
@after The last launch is one block of one thread, and it still gives the right
answer. That is the property worth having: the same kernel debuggable serially
and fast in parallel.

```starter
__global__ void vadd(const float* a, const float* b, float* c, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) c[i] = a[i] + b[i];
}
```

```tests
#include <cstdio>
static int check(int blocks, int threads) {
    const int N = 1000;
    float *a, *b, *c;
    cudaMallocManaged(&a, N * sizeof(float));
    cudaMallocManaged(&b, N * sizeof(float));
    cudaMallocManaged(&c, N * sizeof(float));
    for (int i = 0; i < N; i++) { a[i] = i; b[i] = 2 * i; c[i] = -1; }
    vadd<<<blocks, threads>>>(a, b, c, N);
    cudaDeviceSynchronize();
    for (int i = 0; i < N; i++) {
        if (c[i] != 3.0f * i) {
            printf("<<<%d,%d>>> c[%d]=%f want %f\n", blocks, threads, i, c[i], 3.0f * i);
            return 1;
        }
    }
    return 0;
}
int main() {
    if (check(4, 256)) return 1;
    if (check(1, 32)) return 1;
    if (check(1, 1)) return 1;
    printf("ok\n");
    return 0;
}
```

```solution
__global__ void vadd(const float* a, const float* b, float* c, int n) {
    int stride = blockDim.x * gridDim.x;
    for (int i = blockIdx.x * blockDim.x + threadIdx.x; i < n; i += stride)
        c[i] = a[i] + b[i];
}
```

## Summing a warp without memory

Reduce 32 values to one using register exchange only. No shared memory, no
atomics, no loop over global memory.

@kind output
@concept Lanes in a warp can exchange registers directly, which costs log2(32)
steps and no memory at all.
@backend modal
@lang cuda
@gpu sm_75
@flags -O2
@hint Five halvings: 16, 8, 4, 2, 1.
@expect verdict nonzero-exit
@diagnose wrong verdict nonzero-exit
Lane 0 does not hold the total. `__shfl_down_sync(mask, v, d)` gives each lane
the value from the lane `d` above it, so adding at offsets 16, 8, 4, 2 and 1
leaves the full sum in lane 0 and partial sums elsewhere.
@diagnose compile verdict compile-error
Read the line nvcc names. The intrinsic takes a mask first: the plain
`__shfl_down` without it was removed, because after Volta the hardware no
longer promises lanes arrive together.
@diagnose silent silent
Nothing complained and a check failed. Print what each lane holds after each
step for a small input and the pattern will be obvious.
@after Five instructions, no memory traffic, and the same wires the graphics
pipeline used to compute derivatives against quad neighbours.

```starter
__global__ void warp_sum(const int* in, int* out) {
    int v = in[threadIdx.x];
    if (threadIdx.x == 0) out[0] = v;
}
```

```tests
#include <cstdio>
int main() {
    int *in, *out;
    cudaMallocManaged(&in, 32 * sizeof(int));
    cudaMallocManaged(&out, sizeof(int));
    int want = 0;
    for (int i = 0; i < 32; i++) { in[i] = i * 3 + 1; want += in[i]; }
    *out = -1;
    warp_sum<<<1, 32>>>(in, out);
    cudaDeviceSynchronize();
    if (*out != want) { printf("got %d want %d\n", *out, want); return 1; }
    printf("ok\n");
    return 0;
}
```

```solution
__global__ void warp_sum(const int* in, int* out) {
    int v = in[threadIdx.x];
    for (int d = warpSize / 2; d > 0; d /= 2)
        v += __shfl_down_sync(0xffffffff, v, d);
    if (threadIdx.x == 0) out[0] = v;
}
```

## The barrier you left out

This kernel reverses an array through shared memory. Every thread writes one
element and then reads a different one, and the starter does not wait in
between.

@kind output
@concept Threads in a block run concurrently, so a write by one thread is not
visible to another until they have both reached a barrier.
@backend modal
@lang cuda
@gpu sm_75
@flags -O2
@hint The read depends on a write performed by a different thread.
@expect verdict nonzero-exit
@diagnose wrong verdict nonzero-exit
A thread read a slot before the thread responsible for it had written. Warps
within a block are scheduled independently, so without a barrier there is no
ordering between them at all. This one may even pass sometimes, which is worse
than failing.
@diagnose silent silent
Nothing complained and a check failed. Add `__syncthreads()` between the write
and the read, and make sure every thread reaches it.
@after Note the rule: every thread in the block must reach the barrier. Putting
it inside an `if` that only some threads take hangs the kernel.

```starter
__global__ void reverse(int* d, int n) {
    extern __shared__ int s[];
    int t = threadIdx.x;
    s[t] = d[t];
    d[t] = s[n - 1 - t];
}
```

```tests
#include <cstdio>
int main() {
    const int N = 256;
    int* d;
    cudaMallocManaged(&d, N * sizeof(int));
    for (int i = 0; i < N; i++) d[i] = i;
    reverse<<<1, N, N * sizeof(int)>>>(d, N);
    cudaDeviceSynchronize();
    for (int i = 0; i < N; i++) {
        if (d[i] != N - 1 - i) { printf("d[%d]=%d want %d\n", i, d[i], N - 1 - i); return 1; }
    }
    printf("ok\n");
    return 0;
}
```

```solution
__global__ void reverse(int* d, int n) {
    extern __shared__ int s[];
    int t = threadIdx.x;
    s[t] = d[t];
    __syncthreads();
    d[t] = s[n - 1 - t];
}
```

## Blocks in any order

This kernel sums an array with one partial per block. The starter assumes block
0 finishes first, which nothing guarantees.

@kind output
@concept A correct kernel gives the right answer for every interleaving of its
blocks, including strictly one at a time in any order.
@backend modal
@lang cuda
@gpu sm_75
@flags -O2
@hint There is no barrier between blocks, and there cannot be one.
@expect verdict nonzero-exit
@diagnose wrong verdict nonzero-exit
The total is wrong or unstable. Blocks may run in any order, concurrently or
not, so a block cannot read a value another block is expected to have written.
Combine partials with an atomic, which needs no ordering.
@diagnose silent silent
Nothing complained and a check failed. Run it a few times: an answer that
changes between runs is a scheduling assumption, not a bug in the arithmetic.
@after The restriction is the mechanism. Because blocks are independent, this
kernel runs unchanged on a GPU with twenty SMs and one with a hundred and
forty, and gets faster on the larger one.

```starter
__global__ void total(const int* in, int* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (blockIdx.x == 0 && threadIdx.x == 0) *out = 0;
    if (i < n) *out += in[i];
}
```

```tests
#include <cstdio>
int main() {
    const int N = 4096;
    int *in, *out;
    cudaMallocManaged(&in, N * sizeof(int));
    cudaMallocManaged(&out, sizeof(int));
    long want = 0;
    for (int i = 0; i < N; i++) { in[i] = i % 7; want += in[i]; }
    for (int trial = 0; trial < 3; trial++) {
        *out = 0;
        total<<<(N + 255) / 256, 256>>>(in, out, N);
        cudaDeviceSynchronize();
        if (*out != want) { printf("trial %d: got %d want %ld\n", trial, *out, want); return 1; }
    }
    printf("ok\n");
    return 0;
}
```

```solution
__global__ void total(const int* in, int* out, int n) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) atomicAdd(out, in[i]);
}
```

## Uniform is free

Two kernels do the same amount of arithmetic. One divides work by lane, the
other by warp. Make the second one branch on the warp rather than the lane, and
the checks confirm both produce identical results.

@kind output
@concept A branch that splits on a warp boundary does not diverge at all, so
the same fraction of threads costs nothing.
@backend modal
@lang cuda
@gpu sm_75
@flags -O2
@hint Divide the thread index by the warp width before testing it.
@expect verdict nonzero-exit
@diagnose wrong verdict nonzero-exit
The two kernels disagree. Both must compute the same value for every thread;
only the shape of the branch changes. Test on `t / warpSize` rather than on `t`.
@diagnose silent silent
Nothing complained and a check failed. Compare what each kernel writes for a
thread near a warp boundary, such as 31 and 32.
@after Both cost the same instructions and only one of them diverges. That is
the whole difference between a branch that is expensive and one that is not,
and it is a property of where the split falls rather than how many threads take
it.

```starter
__global__ void by_lane(int* out) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    out[t] = (t % 2 == 0) ? t * 2 : t * 3;
}

__global__ void by_warp(int* out) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    out[t] = t * 2;
}
```

```tests
#include <cstdio>
int main() {
    const int N = 256;
    int *a, *b;
    cudaMallocManaged(&a, N * sizeof(int));
    cudaMallocManaged(&b, N * sizeof(int));
    by_lane<<<1, N>>>(a);
    by_warp<<<1, N>>>(b);
    cudaDeviceSynchronize();
    for (int t = 0; t < N; t++) {
        int want = ((t / 32) % 2 == 0) ? t * 2 : t * 3;
        if (b[t] != want) { printf("by_warp out[%d]=%d want %d\n", t, b[t], want); return 1; }
    }
    printf("ok\n");
    return 0;
}
```

```solution
__global__ void by_lane(int* out) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    out[t] = (t % 2 == 0) ? t * 2 : t * 3;
}

__global__ void by_warp(int* out) {
    int t = blockIdx.x * blockDim.x + threadIdx.x;
    out[t] = ((t / warpSize) % 2 == 0) ? t * 2 : t * 3;
}
```
