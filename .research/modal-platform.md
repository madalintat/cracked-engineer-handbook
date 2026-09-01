# Modal platform research — for a learner-picks-their-GPU code runner

Crawled 2026-09-01 from `https://modal.com/docs` (all pages fetched as raw markdown via the
`.md` suffix, which Modal officially supports: *"Append `.md` to any documentation URL, or send
an `Accept: text/markdown` request header, to get that page as markdown."*) plus
`https://modal.com/pricing` and `https://modal.com/legal/terms`.

**Confidence key used throughout:** ✅ quoted verbatim from Modal docs · ⚠️ inferred / not stated
by Modal · ❌ could not verify.

---

## 1. The complete GPU catalog

### 1a. The authoritative list of `gpu=` strings

✅ `https://modal.com/docs/guide/gpu` — *"You can pick a specific GPU type for your Function via
the `gpu` argument. Modal supports the following values for this parameter:"*

```
* T4
* L4
* A10
* L40S
* A100
* A100-40GB
* A100-80GB
* RTX-PRO-6000
* H100/H100!
* H200
* B200/B200+
* B300
```

Two strings appear in current Modal docs but are **not** in that list:

- `gpu="any"` — used repeatedly in `guide/cuda` (`@app.function(gpu="any")`). Lets Modal pick.
- `gpu="A10G"` — used in the current `guide/cuda` TensorRT-LLM example
  (`@app.function(gpu="A10G", volumes={...})`). Legacy alias for `A10`, still resolving. ⚠️ Do not
  put it in your dropdown; use `A10`.

### 1b. Full catalog table

Prices ✅ from `https://modal.com/pricing`, which quotes **per-second**; per-hour = ×3600.
VRAM / arch / sm targets are ⚠️ NVIDIA hardware facts — Modal does **not** publish a
capability table. The only VRAM figures Modal states itself are H200 = 141 GB and the
per-container aggregate caps.

| id | `gpu=` string | Marketing name (Modal's own wording) | VRAM | Arch | sm target | $/sec | **$/hr** | Hours on $30 credit |
|---|---|---|---|---|---|---|---|---|
| `t4` | `"T4"` | Nvidia T4 | 16 GB | Turing | `sm_75` | $0.000164 | **$0.59** | 50.8 |
| `l4` | `"L4"` | Nvidia L4 | 24 GB | Ada Lovelace | `sm_89` | $0.000222 | **$0.80** | 37.5 |
| `a10` | `"A10"` | Nvidia A10 | 24 GB | Ampere | `sm_86` | $0.000306 | **$1.10** | 27.3 |
| `l40s` | `"L40S"` | Nvidia L40S | 48 GB | Ada Lovelace | `sm_89` | $0.000542 | **$1.95** | 15.4 |
| `a100-40gb` | `"A100-40GB"` (or `"A100"`) | Nvidia A100, 40 GB | 40 GB | Ampere | `sm_80` | $0.000583 | **$2.10** | 14.3 |
| `a100-80gb` | `"A100-80GB"` | Nvidia A100, 80 GB | 80 GB | Ampere | `sm_80` | $0.000694 | **$2.50** | 12.0 |
| `rtx-pro-6000` | `"RTX-PRO-6000"` | Nvidia RTX PRO 6000 | 96 GB | Blackwell **GB202** | `sm_120` | $0.000842 | **$3.03** | 9.9 |
| `h100` | `"H100"` / `"H100!"` | Nvidia H100 SXM5 | 80 GB | Hopper | `sm_90a` | $0.001097 | **$3.95** | 7.6 |
| `h200` | `"H200"` | Nvidia H200 SXM | 141 GB | Hopper | `sm_90a` | $0.001261 | **$4.54** | 6.6 |
| `b200` | `"B200"` | Nvidia B200 | 180 GB | Blackwell GB100 | `sm_100a` | $0.001736 | **$6.25** | 4.8 |
| `b200-plus` | `"B200+"` | (B200 *or* B300, billed as B200) | 180/288 GB | Blackwell / Ultra | `sm_100a` or `sm_103a` | $0.001736 | **$6.25** | 4.8 |
| `b300` | `"B300"` | Nvidia B300 | 288 GB | Blackwell Ultra GB300 | `sm_103a` | $0.001972 | **$7.10** | 4.2 |

Not offered by Modal at all: **A100 with MIG slices, V100, RTX 4090/5090, MI300X, TPUs, GB200
NVL72 racks.** There is no A10G-vs-A10 distinction in pricing — one line item, "Nvidia A10".

### 1c. Blackwell / FP4 verdict — this is the answer to your curriculum question

**Yes. B200 is generally available, self-serve, at $6.25/hr, and B300 (Blackwell Ultra) at
$7.10/hr.** Neither is gated behind a sales call or a plan tier. From the GPU guide:

> ✅ *"B200s are NVIDIA data center GPUs based on the Blackwell architecture. To request a B200,
> set the `gpu` argument to `"B200"`"*
>
> ✅ *"B300s are NVIDIA Blackwell Ultra GPUs, based on the Blackwell architecture. To request a
> B300, set the `gpu` argument to `"B300"` … B300 requires CUDA version 13.1+. Make sure your
> container Image and libraries are compatible with CUDA 13 before requesting a B300."*

**Three traps for FP4/sm_100 content:**

1. **`RTX-PRO-6000` is a Blackwell decoy.** It is the GB202 workstation die, compute capability
   **12.0**, not 10.0. It has 5th-gen tensor cores with FP4, but it does *not* have `tcgen05` or
   the `sm_100a` datacenter tensor-core instruction set. A kernel compiled `-arch=sm_100a` will
   not run on it. ⚠️ Modal does not warn about this anywhere. If your dropdown lists it under
   "Blackwell" next to B200, learners will pick the cheap one and get a cryptic PTX error.
   Label it explicitly.
2. **`"B200+"` destroys the lesson.** ✅ *"Use `gpu="B200+"` to allow Modal to run requests on
   either B200 or B300 GPUs. B200+ is billed as B200, regardless of which GPU is used. Use this
   option only if your code is compatible with both types of GPUs."* Cheaper capacity, but the
   learner no longer knows which SM they landed on — which is the entire point of a hardware
   curriculum. Use plain `"B200"`.
3. **`sm_103a` for B300 is my inference, not Modal's claim** (⚠️). Have the runner print
   `torch.cuda.get_device_capability()` and `nvidia-smi --query-gpu=name,compute_cap` on every
   run so the learner sees ground truth rather than your table.

Budget reality: $30/month of free credit buys **4.8 hours of B200**. An FP4 lesson has to be a
few short kernel launches, not a training loop.

---

## 2. The `gpu=` parameter syntax, in full

Signature ✅ from `https://modal.com/docs/sdk/py/latest/App.md`:

```python
function(self, *, image=None, schedule=None, env=None, secrets=None, gpu=None, ...)
```

with `gpu` typed **`str | list[str] | None`**, described as *"GPU request; either a single GPU
type or a list of types."*

### Single GPU

✅ `guide/gpu`:

```python
import modal

image = modal.Image.debian_slim().pip_install("torch", "numpy")
app = modal.App(image=image)


@app.function(gpu="A100")
def run():
    import torch

    assert torch.cuda.is_available()
```

Case-insensitive in practice — Modal's own front page uses `@app.function(gpu="h100", ...)`.

### Multiple GPUs

✅ *"You can specify more than 1 GPU per container by appending `:n` to the GPU argument. For
instance, to run a Function with eight H100s:"*

```python
@app.function(gpu="H100:8")
def run_llama_405b_fp8():
    ...
```

✅ *"Currently B300, B200, H200, H100, A100, L4, T4 and L40S instances support up to 8 GPUs (up to
2,304 GB GPU RAM), and A10 instances support up to 4 GPUs (up to 96 GB GPU RAM). Note that
requesting more than 2 GPUs per container will usually result in larger wait times. These GPUs
are always attached to the same physical machine."*

### Requesting a specific variant

✅ *"Modal offers two versions of the A100: one with 40 GB of RAM and another with 80 GB of RAM.
To request an A100 with 40 GB of GPU memory, use `gpu="A100"`"*:

```python
@app.function(gpu="A100")
def qwen_7b():
    ...
```

✅ *"Modal may automatically upgrade a `gpu="A100"` request to run on an 80 GB A100. This
automatic upgrade does **not** change the cost of the GPU. You can specifically request a 40GB
A100 with the string `A100-40GB`. To specifically request an 80 GB A100, use the string
`A100-80GB`:"*

```python
@app.function(gpu="A100-80GB")
def llama_70b_fp8():
    ...
```

The same silent-upgrade rule applies to Hopper — ✅ *"Modal may automatically upgrade a
`gpu="H100"` request to run on an H200. This automatic upgrade does not change the cost of the
GPU … In cases where an automatic upgrade to H200 would not be helpful (for instance,
benchmarking) you can pass `gpu=H100!` to avoid it."*

**Design implication:** for a teaching runner, **always pin**: use `A100-40GB` / `A100-80GB` /
`H100!` rather than `A100` / `H100`. Otherwise a learner benchmarking "the A100" is silently on
80 GB, and "the H100" is silently an H200 with 1.4× the memory bandwidth. That will wreck any
roofline exercise.

### Fallback lists — yes, supported

✅ *"Modal allows specifying a list of possible GPU types, suitable for Functions that are
compatible with multiple options. Modal respects the ordering of this list and will try to
allocate the most preferred GPU type before falling back to less preferred ones."*

```python
@app.function(gpu=["H100", "A100-40GB:2"])
def run_on_80gb():
    ...
```

Note that fallback entries can carry their own `:n` count. ⚠️ For a *learn-the-hardware* runner,
never use a fallback list — the learner must get the chip they picked or a clean error.

### What happens on unavailability

❌ **Modal does not document a hard "GPU unavailable" error anywhere.** The only statements that
touch it:

- ✅ *"requesting more than 2 GPUs per container will usually result in larger wait times"*
  (`guide/gpu`).
- ✅ *"inputs may **spend more time waiting** in a queue for a container to become ready"*
  (`guide/cold-start`) — scarcity manifests as queueing latency, not a failure.
- ✅ Region pinning is the one case where it can genuinely stall: *"workloads pinned to a routing
  region route traffic only through that region, and workloads pinned to a container region run
  only on compute in that region; neither is ever moved elsewhere, even if the region runs out of
  capacity."* So **do not set `region=` on the runner.**

Practical consequence: a B200 request during a capacity crunch will *hang*, not fail. Your web
endpoint has a hard 150 s HTTP ceiling (§4), so a learner who picks B200 at a bad moment sees a
303-redirect chain or a stall, not "sorry, no B200 right now". You need a client-side timeout and
a friendly message.

---

## 3. Pricing and free credit

### The free credit is **$30/month, not $20**

✅ Verbatim from `https://modal.com/pricing`:

> **Starter — $0 + compute / month.** *"Get started with $30 / month free credit."*
> · $30 / month free credits · 3 workspace seats included · 100 containers + 10 GPU concurrency ·
> Scheduled and Web Functions (limited) · Real-time metrics and logs · Region selection

And in the comparison table, "Included compute: **$30 / month**" (Starter) vs "$100 / month"
(Team, $250/mo base). The page footer repeats *"Ship your first app in minutes. Get Started —
$30 / month free compute."*

**The user's $20 belief is wrong. It is $30.** ⚠️ Whether this is a recurring monthly grant or
resets/expires is not stated in the docs; the wording "$30 / month free credits" and "Included
compute $30 / month" reads as a recurring monthly allowance. I could not find an expiry clause.

Also on that page:
- Startups: *"Early-stage startups can get free compute credits on Modal."*
- ✅ Academics: *"Graduate students, labs, and researchers can get up to **$10k** free compute
  credits on Modal."* — **worth applying for if this curriculum is academic.** That changes the
  economics completely.

### Billing granularity

✅ `guide/billing`: *"Modal is serverless, which means you only pay for the compute you use or
request. Reservations are not required, and **there are no minimum usage-time increments**."*

✅ Pricing page: all rates are quoted **per second** (`$0.001736 / sec`), with a per-hour toggle
that is just ×3600. ⚠️ Whether partial seconds round up is not documented; treat per-second as
the granularity.

✅ Invoicing: *"All Workspaces are billed monthly. At the end of each billing cycle, you are
auto-charged for the Modal usage incurred during that cycle (less any credits and incremental
usage charges) … In addition to monthly billing, you will be auto-charged for incremental usage
the first time you exceed certain thresholds."*

### CPU, memory, disk, volumes

✅ Pricing page, **Functions** (the mode your runner uses):

| Resource | Rate | Per hour |
|---|---|---|
| CPU, physical core (2 vCPU equivalent) | $0.0000131 / core / sec | $0.047 |
| Memory | $0.00000222 / GiB / sec | $0.008 |
| Volumes | $0.09 / GiB / mo | *"includes 1 TiB / mo free"* |

✅ **Sandboxes and Notebooks bill CPU/memory at ~3× the Function rate** (CPU $0.00003942/core/sec,
memory $0.00000667/GiB/sec; GPU "See standard pricing"). If you were considering `modal.Sandbox`
for the runner instead of a Function, that's a real cost delta on the CPU side.

✅ Pricing page footnote: *"minimum of 0.125 cores per container"*, matching `guide/resources`:
*"Each Modal Function or Sandbox container has a default request of 0.125 CPU cores and 128 MiB
of memory."* So baseline CPU+RAM overhead alongside a GPU is trivial (~$0.007/hr) — **the GPU is
essentially the whole bill.**

✅ `guide/resources`: *"For CPU and memory, you'll be charged based on whichever is higher: your
request or actual usage. Disk requests are billed by increasing the memory request at a 20:1
ratio."*

### Multipliers that can silently 1.75× or 3× your bill

✅ `guide/region-selection`: pinning a container region applies **1.5× (broad, e.g. `us`) or
1.75× (narrow, e.g. `us-west`)** to the *whole* bill including GPU. ✅ `guide/preemption`:
`nonpreemptible=True` is **3×** on CPU and memory — *"the `nonpreemptible` parameter is **not
supported for GPU Functions**"*, so it's moot for you. **Don't set `region=` in the runner.**

### Do idle containers cost money? Yes.

✅ Pricing headline: *"You never pay for idle resources — just actual compute time, by the CPU
cycle."* — this is **marketing about scale-to-zero**, and it is contradicted for warm containers
by ✅ `guide/cold-start`:

> *"Increasing the `scaledown_window` reduces the chance that subsequent requests will require a
> cold start, although **you will be billed for any resources used while the container is idle
> (e.g., GPU reservation or residual memory occupancy)**."*

So: **a container that is up but idle bills the full GPU rate.** ✅ Default idle window is 60 s
(*"Modal containers will remain idle for a short period before shutting down. By default, the
maximum idle time is 60 seconds"*), configurable 2 s – 20 min. Default `min_containers` is 0, so
a runner truly scales to zero and costs $0 between uses — **but every request carries up to 60 s
of post-request idle GPU billing.** On B200 that's $0.10 of pure idle per invocation. For a
learner making 40 experimental runs that's $4 of the $30 burned on idle alone.

**Recommendation: set `scaledown_window=2` on the runner Function** (the documented minimum), and
accept the cold start. It is the single biggest cost lever in this design.

### Free (Starter) account limits — the ones that matter here

✅ Pricing page comparison table:

| Limit | Starter | Team |
|---|---|---|
| Included compute | **$30 / month** | $100 / month |
| Workspace seats | Up to 3 | Unlimited |
| **Containers (concurrent)** | **100** | 5000 |
| **GPU concurrency** | **10** | 50 |
| **Deployed apps** | **200** | 1000 |
| Log retention | **1 day** | 30 days |
| Cron jobs | 5 deployed crons | Unlimited |
| Deployment rollbacks | 3 versions | Custom |
| Custom domains | ❌ (Team+) | ✅ |
| Static IP proxy / RBAC / SSO / audit logs | ❌ | Team / Enterprise |

Plus platform-wide limits (not plan-scoped):

- ✅ **Function execution timeout defaults to 300 s (5 min); settable 1 s – 24 h**
  (`guide/timeouts`). This is the ceiling on a learner's kernel run — 24 h is plenty.
- ✅ **HTTP request timeout is a hard 150 s** for all web function types (see §4).
- ✅ **Rate limit: 200 Function calls or HTTP requests/second for a new account**, burst
  multiplier 5 s (`guide/webhooks`). Async invocations 1,500/s.
- ✅ Hard cap of 4,000 concurrent containers for a single Function (`guide/scale`).
- ✅ Per-container disk quota 512 GiB default, 3.0 TiB max.
- ✅ Web request bodies up to 4 GiB; responses unlimited; WebSocket messages ≤ 2 MiB.

⚠️ **Unverified and important: does a Starter account need a credit card before it can run
anything?** `guide/billing` says *"Note that you must have a payment method on file in order to
use Modal"*, and `guide/workspaces` says *"Inviting members requires a verified account. If you
haven't already, add a payment method to verify your account."* But the pricing page advertises
$30/month free with "Get Started" and no card mentioned. I could not resolve this without
creating an account. **Test this yourself before writing the onboarding copy — if a card is
required, your dropout rate at step 1 changes completely.**

⚠️ Note the dated clause in `guide/endpoints`: *"Starting **September 1st, 2026**, credits
included with your plan can no longer be used to pay for Shared Endpoint usage. Other credits
will continue to apply."* That is **today**. It applies only to Modal's managed *Shared Endpoints*
product (`modal endpoint create`), **not** to your own deployed Functions — *"Usage on all other
Endpoints bills for compute as usual and can still be paid with credits."* Your design is
unaffected, but do not build on Shared Endpoints.

---

## 4. Web endpoints

### Current vs deprecated names

| Decorator | Status | Evidence |
|---|---|---|
| `@modal.fastapi_endpoint()` | ✅ **Current** | *"Added in v0.73.82: This function replaces the deprecated `@web_endpoint` decorator."* |
| `@modal.web_endpoint()` | ❌ **Gone.** Renamed v0.73.89, removed by Modal 1.0. `/docs/sdk/py/latest/web_endpoint` now returns 404. | `guide/modal-1-0-migration`: *"We're renaming the `modal.web_endpoint` decorator to `modal.fastapi_endpoint` so that the implicit dependency on FastAPI is more clear … We may reintroduce a lightweight `modal.web_endpoint` without external dependencies in the future."* |
| `@modal.asgi_app()` | ✅ Current | SDK ref live |
| `@modal.wsgi_app()` | ✅ Current | SDK ref live |
| `@modal.web_server(port)` | ✅ Current | SDK ref live |
| `@app.server()` class | ✅ Current, **new** | `guide/servers` — a separate low-latency primitive, *not* a Function |

Other 1.0 renames you will hit in old blog posts/StackOverflow:
`keep_warm` → `min_containers`, `container_idle_timeout` → `scaledown_window`,
`concurrency_limit` → `max_containers`, `allow_concurrent_inputs=N` →
`@modal.concurrent(max_inputs=N)`, `@modal.build` → deprecated, `.lookup()` → `.from_name()`,
`modal.gpu.*` objects → plain strings, `max_inputs=1` → `single_use_containers=True` (v1.3.0).

Signatures ✅:

```python
fastapi_endpoint(*, method="GET", label=None, custom_domains=None, docs=False,
    requires_proxy_auth=False)

asgi_app(*, label=None, custom_domains=None, requires_proxy_auth=False)
```

Minimal working endpoint ✅ (`guide/webhooks`) — note FastAPI must be in the image:

```python
image = modal.Image.debian_slim().pip_install("fastapi[standard]")


@app.function(image=image)
@modal.fastapi_endpoint(method="POST")
def square(item: dict):
    return {"square": item['x']**2}
```

### Auth: **Web Functions are public by default**

✅ `guide/webhook-proxy-auth`, verbatim:

> *"Endpoints and Servers **require authentication by default**. To accept public traffic
> instead, pass `--unauthenticated` … In contrast, **Web Functions are publicly available by
> default**. Enable authentication by setting `requires_proxy_auth=True` in the
> `fastapi_endpoint`, `asgi_app`, `wsgi_app`, or `web_server` decorators."*

```python
@app.function()
@modal.fastapi_endpoint()
def public():
    return "hello world"


@app.function()
@modal.fastapi_endpoint(requires_proxy_auth=True)
def private():
    return "hello friend"
```

✅ Unauthenticated request to the protected one:

```bash
curl --fail-with-body https://private-url--goes-here.modal.run
# modal-http: missing credentials for proxy authorization
# curl: (22) The requested URL returned error: 401
```

**Two auth options:**

**(a) Proxy tokens — Modal-native, rejected at the edge, learner's GPU never boots.**
Created in the [dashboard](https://modal.com/settings/proxy-auth-tokens) or with
`modal workspace proxy-tokens create` (prints `wk-...` id and `ws-...` secret; ✅ *"The secret is
only shown at creation time and can't be retrieved later"*). Sent either as two headers or one:

```bash
curl -H "Modal-Key: $TOKEN_ID" -H "Modal-Secret: $TOKEN_SECRET" https://...modal.run
curl -H "Authorization: Bearer $TOKEN_ID.$TOKEN_SECRET"          https://...modal.run
```

✅ *"Modal works as a proxy, rejecting requests that aren't authorized to access your endpoint."*
The critical property for your design: **a rejected request costs nothing** — no container, no
GPU-second.

**(b) `modal.Secret` + your own bearer check — runs inside the container.** ✅ Full example in
`guide/webhooks` using FastAPI `HTTPBearer` against `os.environ["AUTH_TOKEN"]` injected via
`@app.function(secrets=[modal.Secret.from_name("my-web-auth-token")])`. **Worse for abuse
defence**: the container has already cold-started (and, for a GPU function, already reserved a
GPU) before your code returns 401. Use (a).

### CORS

✅ `fastapi_endpoint` SDK reference, verbatim: *"The Web Function created with this decorator will
**automatically have CORS enabled** and can leverage many of FastAPI's features."*

That is the **only** CORS guarantee in the docs, and it is scoped to `@modal.fastapi_endpoint`.
⚠️ For `@modal.asgi_app` / `@modal.wsgi_app` / `@modal.web_server` there is no such statement —
you must mount `CORSMiddleware` yourself. ❌ Modal does not document *which* origins the automatic
CORS allows (`*` vs echo-origin) or which headers pass; verify with an `OPTIONS` preflight from
your actual static site before shipping.

**This matters enormously for you**: a static site calling a `.modal.run` URL is a cross-origin
`fetch`. If you use `asgi_app` and forget CORS, every learner hits an opaque browser error with a
green 200 in the Modal logs.

⚠️ Second CORS trap: if you add proxy-token auth, the `Modal-Key`/`Modal-Secret` headers make the
request non-simple and trigger a preflight — and the preflight itself is unauthenticated. ❌ Modal
does not document how its proxy handles `OPTIONS` on a `requires_proxy_auth=True` endpoint.
**Test this specifically**; it is the most likely thing to silently break the whole design.

### 150-second hard HTTP ceiling

✅ `guide/webhook-timeouts`: *"All Web Function types … have a maximum HTTP request timeout of
**150 seconds** enforced. However, the underlying Modal Function can have a longer timeout. In
case the Function takes more than 150 seconds to complete, an HTTP status 303 redirect response
is returned pointing at the original URL with a special query parameter … Most web browsers allow
for up to 20 such redirects, effectively allowing up to 50 minutes."*

✅ And the killer caveat, verbatim: *"(**Note:** This does not work with requests that require
CORS, since the response will not have been returned from your code in time for the server to
populate CORS headers.)"*

**→ From a browser on a static site, your effective wall-clock budget is 150 seconds, full
stop.** The 303 escape hatch does not exist for you. A cold B200 boot + image pull + compile +
run can plausibly exceed that. **Design the runner as spawn-and-poll from day one** — ✅ the docs
give the exact pattern (`guide/webhook-timeouts`):

```python
@web_app.post("/accept")
async def accept_job(request: fastapi.Request):
    call = slow_operation.spawn()
    return {"call_id": call.object_id}


@web_app.get("/result/{call_id}")
async def poll_results(call_id: str):
    function_call = modal.FunctionCall.from_id(call_id)
    try:
        return function_call.get(timeout=0)
    except TimeoutError:
        return fastapi.responses.JSONResponse({}, status_code=202)
```

⚠️ Note `guide/function-invocation-methods`: spawned (async) results are *"stored for 7 days"*,
whereas *"synchronous invocations will be cancelled within two minutes after the caller hangs
up."* Poll-based is also the only design that survives a learner closing their laptop lid.

### URL structure

✅ `guide/webhook-urls`: *"At a high-level, Web Function URLs for deployed Apps have the following
structure: `https://<source>--<label>.modal.run`."* Source = workspace slug (+ environment
suffix); label = `<app>-<function>`, *"normalized to contain only lowercase letters, numerals, and
dashes."* Worked example: `https://ecorp-prod--text-to-speech-flask-app.modal.run`.

Custom label ✅:

```python
@app.function()
@modal.fastapi_endpoint(label="speechify")
def web_endpoint_handler():
    ...
# -> https://ecorp-prod--speechify.modal.run
```

Retrieve programmatically ✅: `Function.get_web_url()`, which also works remotely via
`modal.Function.from_name("app", "show_url").get_web_url()`.

✅ `modal serve` (ephemeral) appends `-dev` to the label, and *"If an ephemeral App is serving a
Web Function while another ephemeral App is created seeking the same label, the new Function will
**steal** the running Function's label."*

✅ Labels over 63 chars are truncated to 56 + `-` + first 6 chars of the SHA-256 of the full
label.

❌ Custom domains are **Team plan and up** — *"Custom domains are available on the Team and
Enterprise plans."* Not available to your learners.

### Cold starts and how to reduce them

✅ `guide/cold-start` — two distinct sources: *"(1) inputs may spend more time waiting in a queue
for a container to become ready … (2) when an input is handled by the container that just
started, there may be extra work that only needs to be done on the first invocation."*

✅ *"Containers boot in about one second"* — but that is Modal's sandbox, before your image's
global scope and `@modal.enter` methods run. ✅ *"before a container is considered warm and ready
to handle inputs, we need to execute any logic in your code's global scope (such as imports) or
in any `modal.enter` methods."*

The four documented levers:

1. ✅ **`scaledown_window`** — *"By default, the maximum idle time is 60 seconds … it can be set
   anywhere between two seconds and twenty minutes."* Trades cost for latency directly. **For a
   cost-constrained learner runner: set it LOW (2), not high.**
2. ✅ **`min_containers`** — *"To keep some containers warm and running at all times … This puts a
   floor on the number of containers so that the Function doesn't scale to zero."* **Never do
   this on a GPU function on a $30 budget** — `min_containers=1` on a B200 is $4,500/month.
3. ✅ **`buffer_containers`** — *"provisions extra containers while the Function is active."*
   Irrelevant at one-learner scale.
4. ✅ **`@modal.enter`** — *"Containers will not be considered warm until all `enter` methods have
   completed, so no inputs will be routed to containers that have yet to complete this
   initialization."* Moves work off the first request onto the boot; ✅ *"`enter` doesn't get rid
   of the latency — it just moves the latency to the warm up period."* Use `@app.cls` +
   `@modal.enter()` to import torch / warm the CUDA context once per container.

✅ **Memory Snapshots** (`enable_memory_snapshot=True`) — *"can dramatically reduce the cold start
latency … practical initialization-heavy Functions often start up 3-10x faster."* Two caveats
that hit you:
- ✅ *"Memory Snapshots are created only for deployed Apps"* (not `modal serve`).
- ✅ GPU Memory Snapshots are **alpha**, and *"generally incompatible with multi-GPU code"*,
  *"generally incompatible with non-CUDA GPU code"*, *"do not speed up model loading from
  storage"*, and *"can interact poorly with `torch.compile`"* (mitigation:
  `TORCHINDUCTOR_COMPILE_THREADS=1`). ⚠️ For a runner that JIT-compiles learner CUDA, CPU memory
  snapshots (importing torch) are the safe win; GPU snapshots are not worth the flakiness.

**Concretely for the runner: `@app.cls(gpu=..., scaledown_window=2, enable_memory_snapshot=True)`
with `@modal.enter(snap=True)` doing the torch import.** Skip GPU snapshots.

### `@app.server()` — new alternative worth knowing about

✅ `guide/servers`: lower latency, *"Servers require authentication in requests by default"*,
supports `Modal-Session-ID` sticky sessions. But ✅ the dealbreaker: *"When a Server has no active
containers, requests will be rejected with a **503 Service Unavailable** status, which clients
must handle."* Scale-from-zero returns an error instead of queueing. **Wrong primitive for a
learner runner** — stick with Web Functions.

---

## 5. Images and CUDA

### Host driver — this is the ceiling on your toolkit version

✅ `guide/cuda`, verbatim:

> *"The NVIDIA Accelerated Graphics Driver for Linux-x86_64, **version 580.95.05**, and CUDA
> Driver API, **version 13.0**, are already installed. You can call `nvidia-smi` or run compiled
> CUDA programs from any Modal Function with access to a GPU."*

✅ *"Make sure to choose a version of CUDA that is no greater than the version provided by the
host machine. Older versions in the `12.*` and `13.*` series are guaranteed to be compatible with
the host machine's driver, but older major versions (`11.*`, `10.*`, etc.) may not be."*

**So: CUDA toolkit 13.0 is the documented ceiling; 12.x is safe; 11.x and older are explicitly
not guaranteed.** ⚠️ Direct tension with the B300 requirement, which is stated twice as *"B300
requires CUDA version 13.1+"* — while the same docs say the host provides driver API 13.0 and
*"no greater than the version provided by the host machine."* Either B300 hosts run a newer driver
or the CUDA guide is stale. ❌ **Unresolved. If you put B300 in the dropdown, verify empirically
before shipping it.** B200 at CUDA 12.8+ has no such ambiguity.

### Is `nvcc` present in the standard images? **No.**

✅ *"This shared library [`libcudart.so`] is **not** installed by default on Modal … The CUDA
Runtime API is generally installed as part of the larger NVIDIA CUDA Toolkit, which includes the
NVIDIA CUDA compiler driver (`nvcc`) and its toolchain."*

✅ *"If your application or its dependencies need components of the CUDA toolkit, like the `nvcc`
compiler driver, installed as system libraries or command-line tools, **you'll need to install
those manually.** We recommend the official NVIDIA CUDA Docker images from Docker Hub. You'll
need to add Python 3 and pip with the `add_python` option because the image doesn't have these by
default."*

What **is** on every GPU host without any image work: `libcuda.so` (Driver API),
`libnvidia-ml.so`, and `nvidia-smi`. ✅ *"These components are installed on all Modal machines
with access to GPUs."* And `pip install torch` works out of the box because torch ships its own
CUDA runtime wheels — ✅ *"Because Modal already includes the lower parts of the CUDA stack, you
can install these libraries with the `pip_install` method of `modal.Image`, just like any other
Python library."*

**→ For a curriculum that compiles CUDA (`nvcc`, `cuobjdump`, `nvdisasm`, PTX inspection) you
MUST use a `-devel` tag. Non-negotiable.**

### Building the CUDA image

✅ Minimal `nvcc`-capable image (`guide/cuda`, the exact docs example):

```python
ctk_image = modal.Image.from_registry(
    "nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.11"
).entrypoint([])  # removes chatty prints on entry

@app.function(gpu="T4", image=ctk_image)
def nvcc_version():
    import subprocess

    return subprocess.run(["nvcc", "--version"], check=True)
```

✅ The fuller recommended pattern:

```python
cuda_version = "12.8.1"  # should be no greater than host CUDA version
flavor = "devel"  # includes full CUDA toolkit
operating_sys = "ubuntu24.04"
tag = f"{cuda_version}-{flavor}-{operating_sys}"

image = (
    modal.Image.from_registry(f"nvidia/cuda:{tag}", add_python="3.12")
    .entrypoint([])  # remove verbose logging by base image on entry
    .apt_install("libopenmpi-dev")
    .pip_install(...)
)
```

Tag flavors: ✅ *"we recommend you use an image that already has the full CUDA stack installed as
system packages and all environment variables set correctly, like the `nvidia/cuda:*-devel-*`
images on Docker Hub."* (`base` = driver stubs only, `runtime` = + libcudart/cuBLAS but **no
nvcc**, `devel` = + nvcc/headers/binutils. ⚠️ that breakdown is Docker Hub's, not Modal's.)

### `add_python` and other `from_registry` requirements

✅ `guide/existing-images`: *"You can use external images so long as: the image is built for the
`linux/amd64` platform; the image has a compatible `ENTRYPOINT`. Additionally, to be used with a
Modal Function, the image needs to have `python` and `pip` installed and available on the
`$PATH`. If an existing image does not have either `python` or `pip` set up compatibly, you can
still use it. Just provide a version number as the `add_python` argument to install a
reproducible **standalone build** of Python."*

```python
ubuntu_image = modal.Image.from_registry("ubuntu:22.04", add_python="3.11")
valhalla_image = modal.Image.from_registry("gisops/valhalla:latest", add_python="3.12")
```

The `nvidia/cuda` images have no Python, so `add_python=` is **mandatory** for them.

Other gotchas worth knowing before a learner's `from_dockerfile` fails mysteriously:
- ✅ *"Modal containers always run as root (uid 0). The `USER` instruction is ignored."*
- ✅ Unimplemented Dockerfile commands: *"`EXPOSE`, `HEALTHCHECK`, `LABEL`, `ONBUILD`,
  `STOPSIGNAL`, and `VOLUME`."*
- ✅ `ADD` *"is limited to fetching from single URLs."*
- ✅ Custom `ENTRYPOINT` scripts *"must also `exec` the arguments passed to it at some point"* —
  hence the `.entrypoint([])` in every `nvidia/cuda` example.
- ✅ Image builder version is workspace-level (`/settings/image-builder-version`), so two learners
  can get different build behaviour from identical code. ⚠️ Worth pinning in your instructions.

---

## 6. Onboarding path for a new user

✅ The official three steps, verbatim from `https://modal.com/docs/guide`:

> *"1. Create an account at modal.com
> 2. Run `pip install modal` to install the `modal` Python package
> 3. Run `modal setup` to authenticate (if this doesn't work, try `python -m modal setup`)"*

Full sequence to a URL:

```bash
# 1. Sign up at https://modal.com/signup  (GitHub OAuth is the default path)
# 2.
pip install modal
# 3.  opens a browser, mints a token, writes ~/.modal.toml
modal setup          # or: python -m modal setup
# 4. optional: live-reload dev loop, ephemeral URL with a -dev suffix
modal serve runner.py
# 5. persistent deploy
modal deploy runner.py
# -> prints https://<workspace>--<app>-<function>.modal.run
```

✅ `modal setup` — *"Bootstrap Modal's configuration."* Only option is `--help`.
✅ `modal deploy [OPTIONS] APP_REF` — useful flags `--name`, `-e/--env`, `--stream-logs`,
`--tag`, `--strategy [rolling|recreate]`.

✅ GitHub scopes requested at signup (`guide/modal-user-account-setup`): *"`user:email` — gives us
the emails associated with the GitHub account. `read:org` (invites only) … We won't be able to
access any code repositories or other details."*

✅ Workspace naming (`guide/workspaces`): *"When you sign up to Modal, a Workspace is
automatically created for you. **Its name is based on your GitHub username**, but may be randomly
generated if that name is taken or invalid."* — remember this for §7.

**Realistic time:** ⚠️ my estimate, not Modal's. 3–6 minutes for a developer with Python and a
GitHub account already set up (signup ~1 min, pip ~30 s, `modal setup` browser round-trip ~30 s,
first `modal deploy` of a small image ~1–3 min). **First deploy of a `nvidia/cuda:*-devel` image
is the outlier — that's a multi-GB pull and can take 5–10+ minutes**, though it's cached
thereafter and shared across the fleet.

**What goes wrong, ranked by likelihood:**

1. ⚠️ **The payment-method question (§3).** If a card is required to run anything, this is the #1
   dropout point and it's at step 1. **Verify.**
2. No GitHub account, or corporate SSO on GitHub blocking the OAuth app.
3. `modal` not on `$PATH` after a `pip install --user` → the docs pre-empt this with *"if this
   doesn't work, try `python -m modal setup`"*. Put that in your instructions verbatim.
4. Wrong Python — `pip` pointing at a different interpreter than `python`. Tell learners
   `python -m pip install modal` and `python -m modal setup`.
5. Headless environment (SSH, WSL, Codespace) where `modal setup` can't open a browser → fall
   back to `modal token new`/`modal token set` from the dashboard.
6. Corporate proxy/firewall blocking the gRPC control plane.
7. First deploy pulls a huge CUDA devel image and the learner assumes it's hung.
8. ⚠️ Windows: Modal's client is fine, but every code sample assumes a POSIX shell.

---

## 7. What would BREAK "every learner deploys their own runner and pastes the URL into a static site"

Ranked by how likely it is to actually bite you.

### 🔴 1. The URL is trivially guessable and enumerable — this is the big one

✅ URLs are `https://<workspace-slug>--<app>-<function>.modal.run`, and ✅ the workspace slug *"is
based on your GitHub username."*

If your instructions say "name the app `gpu-runner` and the function `run`", then **every
learner's endpoint is deterministically `https://<their-github-username>--gpu-runner-run.modal.run`.**
Anyone with a GitHub username list — i.e. anyone who can see your course's GitHub org, the
repo's stargazers, or a public Discord — can enumerate every learner's endpoint in seconds. No
scanning needed; the naming scheme *is* the enumeration.

And what's behind that URL is **arbitrary GPU code execution on someone else's paid account.**
This is the single most attractive target shape on the internet: free, anonymous, no-signup GPU
compute. Crypto miners find these within hours.

**Mitigations, in order of effectiveness:**

- ✅ **`requires_proxy_auth=True` + a per-learner proxy token.** Rejected at Modal's proxy, so an
  abusive request costs the learner **nothing** — no container, no GPU-second. The learner pastes
  *URL + token* into your static site (localStorage). This is the correct answer.
- Make the label unguessable: `@modal.fastapi_endpoint(label=f"runner-{secrets.token_hex(8)}")`,
  or have the learner pick a random app name. Weaker (defence by obscurity, and the URL is now in
  their browser history and your site's storage) but removes the *bulk* enumeration property.
  Combine with proxy auth, don't substitute.
- ✅ **`max_containers=1`** and ✅ **`timeout=60`** and ✅ **`scaledown_window=2`** to bound the
  blast radius of any breakthrough.
- ⚠️ Tell learners about **spend limits** (`guide/budgets`, workspace- and environment-level) and
  make setting one step 0 of the course. `guide/endpoints` points at them explicitly: *"To cap
  out-of-pocket charges after this change, see spend limits."*
- ❌ You cannot use IP allowlisting meaningfully (static site, arbitrary learner IPs), though ✅
  `request.client.host` is available *"for geolocation, whitelists, blacklists, and rate limits."*

### 🔴 2. Arbitrary code execution is the entire feature, and the defaults are wrong for it

The runner exists to compile and run learner-supplied CUDA. Even for the legitimate learner,
their own endpoint is executing untrusted-by-Modal code on their credential. Modal has a
purpose-built answer that your design should use — ✅ `guide/restricted-access`:

```python
@app.function(restrict_modal_access=True, single_use_containers=True, timeout=30, block_network=True)
def run_llm_code(generated_code: str):
    ...
```

✅ *"When `restrict_modal_access` is enabled, the Function cannot access Modal resources (Queues,
Dicts, etc.), call other Functions, [or] access Modal's internal APIs."*
✅ *"Use `single_use_containers=True` to ensure each container only handles one request.
Containers that get reused could cause information leakage between users."*
✅ *"Consider using `block_network=True` to prevent the container from making outbound network
requests."*
✅ And: *"A restricted Modal Function will have read access to its source files in the container,
so you'll want to avoid including anything that would be harmful if exfiltrated" →*
`modal.App("restricted-app", include_source=False)`.

⚠️ **`block_network=True` is the highest-leverage anti-abuse setting here**: a GPU with no
outbound network cannot mine, cannot exfiltrate, cannot join a pool. It costs you nothing unless
a lesson needs to `pip install` at runtime (it shouldn't — bake it into the image). ⚠️ Note
`single_use_containers=True` forces a cold start per request, which is a real UX cost — but with
`scaledown_window=2` you were paying that anyway.

Baseline isolation is decent regardless — ✅ `guide/security`: Modal uses *"gVisor, the sandboxing
technology developed at Google and used in their Google Cloud Run and Google Kubernetes Engine
cloud services."* So a learner's `nvcc` output is not escaping to the host. The risk is
**economic**, not containment.

### 🟠 3. TOS: your design is fine; the obvious "helpful" shortcuts are not

✅ `https://modal.com/legal/terms`, Restrictions: *"Customer agrees not to (and will not allow any
third party to): … (c) **rent, resell or otherwise allow any third party direct access to or use
of the Service**."*

✅ Prohibited Purpose: *"use of the Service to: (a) promote unlawful or illegal goods, services,
or activities; or (b) conduct **cryptocurrency mining** or related blockchain related activities,
**denial of service attacks**, peer-to-peer file sharing, or general file-hosting or
media-serving platform services."*

- **Each learner deploys under their own account and uses it themselves → compliant.** This is
  exactly why "learner deploys their own copy" is the right architecture; keep it.
- **You hosting one shared runner for the class → squarely "allow any third party direct access
  to or use of the Service."** Don't. Not even "just for the free tier folks."
- **An unprotected public endpoint → the learner is unintentionally allowing third parties direct
  access, and the most likely abuse (mining) is named in Prohibited Purpose.** So an
  unauthenticated runner is not merely a cost risk, it is a term the learner is breaching on your
  instructions. ✅ And enforcement is real: *"Modal may suspend Customer's access to or use of the
  Service if Modal determines such action is reasonably necessary."*
- ✅ Free-tier usage is as-is with no support: *"the No-Fee Use is provided without any
  indemnification, support, warranties or representation of any kind."* Set expectations.

### 🟠 4. Rate limits and concurrency — mostly fine, one sharp edge

✅ *"Each workspace on Modal has a rate limit on total operations. For a new account, this is set
to **200 Function calls or HTTP requests per second**, with a burst multiplier of 5 seconds. If
you reach the rate limit, excess requests will return a 429 status code."* Per-workspace, so
each learner has their own budget. A human clicking "Run" will never approach it. **An abuser who
finds an unprotected endpoint will**, and 200 rps of B200 requests is a very expensive afternoon.
✅ Starter GPU concurrency is capped at **10**, which is the real backstop — but 10 concurrent
B200s is $62.50/hr.

### 🟠 5. Naming collisions

✅ URL labels are per-workspace, so two learners can both deploy `gpu-runner` with no conflict —
**this is safe, and it is also exactly what makes the URLs enumerable (§1).** Sharp edges:

- ✅ `modal serve` label stealing: *"If an ephemeral App is serving a Web Function while another
  ephemeral App is created seeking the same label, the new Function will **steal** the running
  Function's label."* Within one workspace only. A learner running `modal serve` in two terminals
  will silently kill the first. Tell them to `modal deploy`, not `modal serve`, for the URL they
  paste.
- ✅ `-dev` suffix: `modal serve` URLs differ from `modal deploy` URLs. Guaranteed confusion — a
  learner will paste the `-dev` URL, close the terminal, and the site breaks. **Make the
  instructions `modal deploy` only.**
- ✅ Multiple environments add a suffix to the source component. Starter users have one
  environment, so ⚠️ mostly moot, but a learner who created a second environment gets a different
  URL shape than your screenshot.
- ✅ 63-char truncation with a SHA-256 hash suffix — a long app+function name produces a URL the
  learner cannot predict from your instructions. **Keep names short.**

### 🟡 6. CORS + the 150 s ceiling (details in §4)

- ⚠️ `@modal.fastapi_endpoint` auto-enables CORS; ❌ the policy is undocumented and untested by me.
  `asgi_app` does not. **Use `fastapi_endpoint`, and verify a real preflight from your real
  origin.**
- ⚠️ Proxy-auth headers force a CORS preflight, and ❌ Modal's handling of `OPTIONS` on an
  authenticated endpoint is undocumented. **This is the most likely single point of failure in
  the whole design — test it first, before building anything else.**
- ✅ 150 s hard HTTP cap, and ✅ the 303-redirect workaround *"does not work with requests that
  require CORS"*. So: **spawn + poll**, always.

### 🟡 7. Cost surprises that damage trust

- ✅ Idle containers bill the full GPU rate for the `scaledown_window` (default 60 s). Unset, a
  learner doing 40 B200 runs burns ~$4 on idle. **Set `scaledown_window=2`.**
- ✅ Silent A100→A100-80GB and H100→H200 upgrades. Free in dollars, but they corrupt benchmarking
  lessons. **Pin: `A100-40GB`, `A100-80GB`, `H100!`.**
- ⚠️ `RTX-PRO-6000` is $3.03/hr and says "Blackwell" but is `sm_120`, not `sm_100`. A learner
  choosing it for the FP4 lesson wastes money and gets an incomprehensible error. **Either omit
  it from the dropdown or gate it to the lessons where it's valid.**
- ✅ Never set `region=` (1.5–1.75× multiplier on everything) or `min_containers>0` (a warm B200
  is ~$4,500/month).
- ⚠️ $30/month = 4.8 hours of B200. **Show a live "this run will cost ~$X" estimate in the UI
  before the learner clicks.** Cheap to build from the JSON catalog, and it's the difference
  between a learner finishing the course and a learner rage-quitting after an unexplained
  overage.

### 🟡 8. Operational papercuts

- ✅ Starter log retention is **1 day**. A learner debugging yesterday's failed run has nothing.
  **Return `stdout`/`stderr` in the HTTP response body**, don't tell them to check the dashboard.
- ✅ Starter allows **200 deployed apps** — no issue.
- ✅ *"All Modal Functions are subject to preemption by default … If a preemption event interrupts
  a running Function, Modal will gracefully terminate the Function and restart it on the same
  input."* Rare, but a preempted-and-retried run means a learner can see a benchmark number
  change with no code change. ✅ `nonpreemptible=True` is **not available for GPU functions**, so
  you cannot opt out. Mention it in the benchmarking lesson rather than pretending timings are
  deterministic.
- ⚠️ ❌ Modal has no documented "GPU unavailable" error — scarcity shows up as **queueing**, and
  your 150 s browser ceiling turns a queue into a mystery stall. Surface "waiting for a B200…"
  in the UI with an explicit client-side timeout.
- ⚠️ Custom domains are Team-plan only, so every learner URL is a raw `*.modal.run` subdomain.
  Fine, but it means you cannot give them a tidy `runner.yourcourse.dev` to paste.

### ✅ Recommended runner shape (the short version)

```python
app = modal.App("cuda-runner", include_source=False)

@app.function(
    image=cuda_devel_image,
    gpu=GPU,                      # pinned string from the dropdown; never a fallback list
    timeout=60,
    scaledown_window=2,           # documented minimum; idle GPU is the main cost leak
    max_containers=1,
    restrict_modal_access=True,
    block_network=True,
    single_use_containers=True,
)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def run(payload: dict):
    ...
```

Learner pastes **URL + proxy token**. Spawn-and-poll if any lesson can exceed ~120 s.

---

## Things I could not verify — check these before shipping

1. ❌ **Whether a Starter account can run anything without a payment method on file.** Docs
   conflict (`guide/billing`: *"you must have a payment method on file in order to use Modal"* vs
   the pricing page's card-free "$30/month free"). Highest-impact unknown in this report.
2. ❌ **What CORS policy `@modal.fastapi_endpoint` actually sets** (origins, allowed headers), and
   ❌ **how Modal's proxy handles an `OPTIONS` preflight on a `requires_proxy_auth=True`
   endpoint.** Test both against your real static origin before building.
3. ❌ **B300 + CUDA 13.1 vs the documented host driver API 13.0.** The docs contradict themselves.
4. ⚠️ **Every price above.** Modal changes them; `guide/gpu` itself says *"Refer to our pricing
   page for the latest pricing on each GPU type."* Re-scrape before each cohort.
5. ⚠️ **All VRAM / arch / `sm_XX` values** are NVIDIA facts, not Modal claims (except H200 =
   141 GB HBM3e @ 4.8 TB/s, and H100/H200 = SXM, which Modal states). Have the runner print
   `torch.cuda.get_device_capability()` on every run so the learner sees ground truth.
6. ⚠️ Whether `$30/month` free credit recurs indefinitely, resets, or expires — the wording says
   "/month" but no expiry policy is documented.
7. ⚠️ Whether partial seconds round up in billing. Docs say per-second with *"no minimum
   usage-time increments"*; the rounding rule is unstated.
8. ⚠️ Whether `gpu="A10G"` is a supported alias or merely still-working legacy. It is absent from
   the canonical list but present in current docs examples.

## Sources

- https://modal.com/docs/guide/gpu · /cuda · /images · /existing-images · /webhooks ·
  /webhook-urls · /webhook-proxy-auth · /webhook-timeouts · /timeouts · /endpoints · /servers ·
  /cold-start · /memory-snapshots · /scale · /function-invocation-methods · /resources ·
  /lifecycle-functions · /restricted-access · /security · /billing · /workspaces ·
  /modal-user-account-setup · /region-selection · /preemption · /modal-1-0-migration
- https://modal.com/docs/sdk/py/latest/App · /fastapi_endpoint · /asgi_app
- https://modal.com/docs/cli/latest/setup · /deploy
- https://modal.com/pricing
- https://modal.com/legal/terms
- https://modal.com/llms-full.txt (whole-corpus grep for `nvcc`, rate limits, `A10G`, arch flags)
