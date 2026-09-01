# Verified by live probe against a real Modal account (2026-09-01)

Empirical, not from docs. Every line below was executed.

## Works

| Test | Result |
|---|---|
| nvcc compile + run on real GPU | OK. Tesla T4, cc 7.5. `c[7]=21.0 c[1023]=3069.0` |
| SASS extraction via `cuobjdump -sass` | OK. 67 lines, real `MOV R1, c[0x0][0x28]` / `S2R R6, SR_CTAID.X` |
| nvcc error text is parseable | OK. `/tmp/w/k.cu(3): error: identifier "notdeclared" is undefined` + caret line |
| CORS on an OPEN `@modal.fastapi_endpoint` | OK. Reflects Origin, `access-control-allow-headers: content-type`, max-age 600 |
| Browser POST from a foreign origin | OK. Kernel ran, correct result returned |
| CPU-only auth gate (secret in JSON body) | OK. Bad token -> 403 in 0.60s, no GPU container started |
| `.spawn()` + `FunctionCall.from_id().get(timeout=0)` poll | OK standalone. 8s cold |
| `block_network=True` with `.spawn()` | **OK** (15s). Containment is free |
| `scaledown_window=2` | OK. Avoids paying full GPU rate for the 60s default idle |

## Does NOT work -- both are Modal's own recommended hardening

**1. `requires_proxy_auth=True` is incompatible with any browser caller.**
    OPTIONS -> HTTP/2 401, `modal-http: missing credentials for proxy authorization`,
    and ZERO CORS headers. Preflights are anonymous by spec, so the browser never
    sends the real request. Not fixable from the page. Control (open endpoint):
    OPTIONS -> 200 with `access-control-allow-origin` reflected.

**2. `restrict_modal_access=True` is incompatible with `.spawn()`.**
    Container runs, then fails reporting its result:
    `modal.exception.AuthError: Received :status = '401'` from
    `task_lifecycle_manager` -> `self._client.stub.TaskResult(req)`.
    The flag blocks the API the container needs to deliver the answer.

## Consequent architecture

    browser --POST {token, gpu, source}--> CPU web endpoint  (open, CORS ok)
                                             | validates token in BODY
                                             | 403 costs ~0.6s CPU, no GPU
                                             v
                                           run_<gpu>.spawn()   block_network=True
                                             |                 scaledown_window=2
                                             v
    browser --POST {token, call_id}------> CPU poll endpoint -> result

Security is: unguessable random app label + secret in body + `block_network=True`
+ `single_use_containers=True` + `max_containers` cap. NOT proxy auth.
Also solves Modal's hard 150s HTTP ceiling, which a cold start plus nvcc can exceed.

## Gotchas hit

- `gpu=` is decoration-time, not runtime. One named function per catalog GPU.
  A lambda in a loop FAILS: `AttributeError: module 'runner' has no attribute '<lambda>'`
  -- Modal imports by qualified name.
- `nvcc` is absent from standard images; need an `nvidia/cuda:*-devel-*` tag plus
  `add_python=` (those images ship no Python).
- Host driver 580.95.05 / CUDA Driver API 13.0.
- `modal app stop` needs `--yes` when non-interactive.
- OPEN ITEM: `.spawn()` of a GPU function from inside a web-endpoint container did not
  complete in the deployed prototype (standalone spawn works). Resolve during
  implementation; likely a hydration/reference detail, not a platform limit.
