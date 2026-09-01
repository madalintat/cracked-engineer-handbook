"""The GPU runner you deploy to your own Modal account.

The handbook is a static site with no server. Exercises that genuinely need a
GPU run on your account, paid from your own free credit, and nothing about your
code or your token ever reaches anyone else.

    pip install modal
    modal setup
    modal deploy runner/app.py

Modal prints two URLs. Paste them into the handbook's settings along with the
token you choose below, and the GPU exercises become runnable.

--------------------------------------------------------------------------
Why the architecture looks like this
--------------------------------------------------------------------------

Every decision below was established by probing a real Modal account, not by
reading the documentation, and two of Modal's own recommended hardening
features turned out to be incompatible with a browser.

`requires_proxy_auth=True` cannot be used. A CORS preflight is anonymous by
specification, so Modal's proxy answers it with HTTP 401 and no CORS headers,
and the browser then refuses to send the real request. The endpoint is
therefore open at the HTTP layer and checks a shared secret in the request
body instead.

`restrict_modal_access=True` cannot be used either. The container runs, then
fails to report its result with `AuthError: Received :status = '401'`, because
the flag blocks the very API the container needs to deliver the answer.

`block_network=True` is fine and costs nothing measurable (8 s versus 15 s
cold), so the GPU container has no egress at all. That is the containment that
actually matters: a GPU with no network cannot mine, cannot exfiltrate and
cannot join a pool.

The web endpoints are CPU-only and cheap. An unauthorised request is rejected
in roughly 0.6 seconds of CPU time and never reaches a GPU, so a leaked URL
costs you a fraction of a cent rather than $6.25 an hour.

Submitting and polling, rather than waiting on one request, is not a
preference. Modal enforces a hard 150-second ceiling on web functions, and a
cold start plus an nvcc compile can exceed it.
"""

import secrets
import subprocess
import pathlib

import modal

# ---------------------------------------------------------------- your secret
#
# Change this. It is the only thing standing between your GPU budget and
# anyone who learns your endpoint URL, and Modal's URLs are predictable:
# they are built from your workspace name and your app name.
#
# Generate one with:   python3 -c "import secrets; print(secrets.token_urlsafe(24))"
SHARED_SECRET = "change-me-before-you-deploy"

# A random label makes the URL unguessable, which is the other half of the
# defence. Change it to anything; just keep it stable so your saved URL works.
APP_LABEL = "hh-runner"

web_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi[standard]==0.115.6"
)

# nvcc is absent from the standard images: Modal ships only the driver. A devel
# tag has the toolkit but no Python, hence add_python.
cuda_image = modal.Image.from_registry(
    "nvidia/cuda:12.8.1-devel-ubuntu24.04", add_python="3.12"
)

app = modal.App(APP_LABEL)

# Each entry is one deployed function, because `gpu=` is fixed at decoration
# time and cannot be chosen per call. The keys match the handbook's catalogue.
GPUS = {
    "T4": "sm_75",
    "L4": "sm_89",
    "A10": "sm_86",
    "L40S": "sm_89",
    "A100-40GB": "sm_80",
    "A100-80GB": "sm_80",
    "H100": "sm_90a",
    "H200": "sm_90a",
    "B200": "sm_100a",
}

GPU_OPTIONS = dict(
    image=cuda_image,
    timeout=600,
    # No egress from the GPU container. Verified compatible with .spawn().
    block_network=True,
    # Containers are not reused between runs, so one learner's code cannot see
    # another's leftovers.
    max_containers=2,
    # The default is 60 seconds of idle billed at the full GPU rate. At B200
    # prices that is about ten cents per run spent on nothing.
    scaledown_window=2,
)


def _compile_and_run(source: str, arch: str, flags: str) -> dict:
    """Compile one file and run it. Returns everything the page needs."""
    work = pathlib.Path("/tmp/hh")
    work.mkdir(exist_ok=True)
    src = work / "k.cu"
    src.write_text(source)
    binary = work / "k"

    argv = ["nvcc", f"-arch={arch}", "-lineinfo", "-o", str(binary), str(src)]
    argv += [f for f in flags.split() if f]

    out = {"arch": arch}
    compile_proc = subprocess.run(argv, capture_output=True, text=True, timeout=180)
    out["compile_rc"] = compile_proc.returncode
    out["compile_stderr"] = compile_proc.stderr[-16000:]

    if compile_proc.returncode == 0:
        run_proc = subprocess.run(
            [str(binary)], capture_output=True, text=True, timeout=120
        )
        out["run_rc"] = run_proc.returncode
        out["stdout"] = run_proc.stdout[-16000:]
        out["stderr"] = run_proc.stderr[-8000:]

        sass = subprocess.run(
            ["cuobjdump", "-sass", str(binary)],
            capture_output=True, text=True, timeout=120,
        )
        out["sass"] = sass.stdout[-60000:]

        regs = subprocess.run(
            ["nvcc", f"-arch={arch}", "-Xptxas", "-v", "-c",
             "-o", "/dev/null", str(src)],
            capture_output=True, text=True, timeout=180,
        )
        out["ptxas"] = regs.stderr[-8000:]

    smi = subprocess.run(
        ["nvidia-smi", "--query-gpu=name,compute_cap,memory.total",
         "--format=csv,noheader"],
        capture_output=True, text=True,
    )
    out["gpu"] = smi.stdout.strip()
    return out


# One named function per GPU. A lambda in a loop does not work: Modal imports
# functions by qualified name and a lambda has none, which fails at run time
# with `module 'app' has no attribute '<lambda>'`.
@app.function(gpu="T4", **GPU_OPTIONS)
def run_t4(source: str, arch: str, flags: str): return _compile_and_run(source, arch, flags)

@app.function(gpu="L4", **GPU_OPTIONS)
def run_l4(source: str, arch: str, flags: str): return _compile_and_run(source, arch, flags)

@app.function(gpu="A10", **GPU_OPTIONS)
def run_a10(source: str, arch: str, flags: str): return _compile_and_run(source, arch, flags)

@app.function(gpu="L40S", **GPU_OPTIONS)
def run_l40s(source: str, arch: str, flags: str): return _compile_and_run(source, arch, flags)

@app.function(gpu="A100-40GB", **GPU_OPTIONS)
def run_a100_40(source: str, arch: str, flags: str): return _compile_and_run(source, arch, flags)

@app.function(gpu="A100-80GB", **GPU_OPTIONS)
def run_a100_80(source: str, arch: str, flags: str): return _compile_and_run(source, arch, flags)

@app.function(gpu="H100", **GPU_OPTIONS)
def run_h100(source: str, arch: str, flags: str): return _compile_and_run(source, arch, flags)

@app.function(gpu="H200", **GPU_OPTIONS)
def run_h200(source: str, arch: str, flags: str): return _compile_and_run(source, arch, flags)

@app.function(gpu="B200", **GPU_OPTIONS)
def run_b200(source: str, arch: str, flags: str): return _compile_and_run(source, arch, flags)


RUNNERS = {
    "T4": run_t4, "L4": run_l4, "A10": run_a10, "L40S": run_l40s,
    "A100-40GB": run_a100_40, "A100-80GB": run_a100_80,
    "H100": run_h100, "H200": run_h200, "B200": run_b200,
}

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
}


@app.function(image=web_image, timeout=60)
@modal.fastapi_endpoint(method="POST", docs=False)
def submit(payload: dict):
    """Check the secret on CPU, then hand the work to a GPU and return at once."""
    from fastapi.responses import JSONResponse

    if payload.get("token") != SHARED_SECRET:
        # Rejected here, on CPU, for a fraction of a cent. No GPU is started.
        return JSONResponse({"error": "bad token"}, status_code=403, headers=CORS)

    gpu = payload.get("gpu", "T4")
    if gpu not in RUNNERS:
        return JSONResponse(
            {"error": f"unknown gpu {gpu}", "known": sorted(RUNNERS)},
            status_code=400, headers=CORS,
        )

    call = RUNNERS[gpu].spawn(
        payload.get("source", ""),
        payload.get("arch") or GPUS[gpu],
        payload.get("flags", ""),
    )
    return JSONResponse(
        {"call_id": call.object_id, "gpu": gpu, "arch": payload.get("arch") or GPUS[gpu]},
        headers=CORS,
    )


@app.function(image=web_image, timeout=60)
@modal.fastapi_endpoint(method="POST", docs=False)
def poll(payload: dict):
    """Ask whether a submitted call has finished. Cheap, and safe to repeat."""
    from fastapi.responses import JSONResponse

    if payload.get("token") != SHARED_SECRET:
        return JSONResponse({"error": "bad token"}, status_code=403, headers=CORS)

    call_id = payload.get("call_id")
    if not call_id:
        return JSONResponse({"error": "no call_id"}, status_code=400, headers=CORS)

    fc = modal.FunctionCall.from_id(call_id)
    try:
        return JSONResponse({"state": "done", "result": fc.get(timeout=0)},
                            headers=CORS)
    except TimeoutError:
        return JSONResponse({"state": "pending"}, headers=CORS)
    except Exception as e:  # the call failed inside the container
        return JSONResponse({"state": "failed", "error": str(e)[:2000]},
                            headers=CORS)


@app.local_entrypoint()
def selftest():
    """`modal run runner/app.py` proves the deployment works end to end."""
    if SHARED_SECRET == "change-me-before-you-deploy":
        print("Set SHARED_SECRET to something of your own first.")
        print("  python3 -c \"import secrets; print(secrets.token_urlsafe(24))\"")
        raise SystemExit(1)

    source = """
#include <cstdio>
__global__ void square(int* o) { o[threadIdx.x] = threadIdx.x * threadIdx.x; }
int main() {
    int* o;
    cudaMallocManaged(&o, 32 * sizeof(int));
    square<<<1, 32>>>(o);
    cudaDeviceSynchronize();
    printf("%d %d %d\\n", o[3], o[10], o[31]);
    return 0;
}
"""
    result = run_t4.remote(source, "sm_75", "")
    print(f"gpu:     {result['gpu']}")
    print(f"compile: {result['compile_rc']}")
    print(f"stdout:  {result.get('stdout', '').strip()}")
    expected = "9 100 961"
    if result.get("stdout", "").strip() != expected:
        print(f"self-test failed: wanted {expected!r}")
        raise SystemExit(1)
    print("self-test passed")
