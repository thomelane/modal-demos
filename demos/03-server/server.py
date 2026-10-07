"""Qwen/Qwen3.6-27B-FP8 on 1xH100 with SGLang.

Serving metadata:
engine: sglang
base_model_repo_id: Qwen/Qwen3.6-27B-FP8
base_model_revision: e89b16ebf1988b3d6befa7de50abc2d76f26eb09
model_family: qwen36

Deployed with MODAL_IMAGE_BUILDER_VERSION=2025.06"""
import os

import modal


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing {name} in .env")
    return value


MINUTES = 60
DEFAULT_PORT = 8000
HF_IMAGE_ENV = {
    "HF_XET_HIGH_PERFORMANCE": "1",
}

MODEL_VOLUME_NAME = required("ENDPOINT_VOLUME_NAME")
MODEL_VOLUME_PATH = "/flash-endpoint-model"
MODEL_PATH = "/flash-endpoint-model/huggingface/hub/models--Qwen--Qwen3.6-27B-FP8/snapshots/e89b16ebf1988b3d6befa7de50abc2d76f26eb09"
SERVED_MODEL_NAME = "Qwen/Qwen3.6-27B-FP8"
ROUTING_REGION = "eu-west"
REQUIRE_AUTHENTICATION = True
SPECULATIVE_DRAFT_MODEL_PATH = "/flash-endpoint-model/huggingface/hub/models--z-lab--Qwen3.6-27B-DFlash/snapshots/0919688658996800f86b895034249700e9481106"
SGLANG_IMAGE_TAG = "lmsysorg/sglang:v0.5.19-cu130"
AUTOINFERENCE_UTILS_VERSION = "0.2.2"

GPU_TYPE = "H100"
N_GPUS = 1
GPU = f"{GPU_TYPE}:{N_GPUS}"
CPU = 4
MEMORY_MB = 16384

SCALEDOWN_WINDOW = 5 * MINUTES
TARGET_INPUTS = 32
STARTUP_TIMEOUT = 60 * MINUTES

EXTRA_IMAGE_ENV = {
    "HF_XET_HIGH_PERFORMANCE": "1",
    "SGLANG_ENABLE_JIT_DEEPGEMM": "0",
    "SGLANG_TIMEOUT_KEEP_ALIVE": "300",
    "TORCHINDUCTOR_COMPILE_THREADS": "1",
}

serving_image = (
    modal.Image.from_registry(SGLANG_IMAGE_TAG)
    .uv_pip_install(
        f"autoinference-utils=={AUTOINFERENCE_UTILS_VERSION}",
    )
    .env(HF_IMAGE_ENV | EXTRA_IMAGE_ENV)
)

EXTRA_SERVER_ARGS = {
    "--chunked-prefill-size": "8192",
    "--cuda-graph-max-bs": "32",
    "--disable-cuda-graph-padding": "",
    "--enable-memory-saver": "",
    "--enable-multimodal": "",
    "--enable-weights-cpu-backup": "",
    "--mamba-scheduler-strategy": "extra_buffer",
    "--mamba-ssm-dtype": "float32",
    "--max-prefill-tokens": "8192",
    "--mem-fraction-static": "0.85",
    "--reasoning-parser": "qwen3",
    "--speculative-algorithm": "DFLASH",
    "--speculative-dflash-block-size": "16",
    "--tool-call-parser": "qwen3_coder",
    "--trust-remote-code": "",
}

SERVER_ARGS = {
    "--served-model-name": SERVED_MODEL_NAME,
} | EXTRA_SERVER_ARGS


WARMUP_PAYLOAD = {
    "model": SERVED_MODEL_NAME,
    "messages": [{"role": "user", "content": "Reply with JSON facts about Tokyo."}],
    "max_tokens": 64,
    "temperature": 0,
    "response_format": {
        "type": "json_schema",
        "json_schema": {
            "name": "city_facts",
            "schema": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "population": {"type": "integer"},
                },
                "required": ["city", "population"],
                "additionalProperties": False,
            },
            "strict": True,
        },
    },
}


app = modal.App(name="ep-qwen3-6-27b-fp8-custom")


@app.server(
    image=serving_image,
    gpu=GPU,
    cpu=CPU,
    memory=MEMORY_MB,
    min_containers=0,
    scaledown_window=SCALEDOWN_WINDOW,
    port=DEFAULT_PORT,
    routing_region=ROUTING_REGION,
    unauthenticated=not REQUIRE_AUTHENTICATION,
    exit_grace_period=25,
    startup_timeout=STARTUP_TIMEOUT,
    target_concurrency=TARGET_INPUTS,
    # Capture initialized CPU and GPU state after the snap=True lifecycle hook.
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
    volumes={MODEL_VOLUME_PATH: modal.Volume.from_name(MODEL_VOLUME_NAME)},
    compute_region=["eu"],
)
class Server:
    @modal.enter(snap=True)
    def startup(self):
        import requests

        from autoinference_utils.endpoint import SGLangEndpoint, warmup_chat_completions

        self.endpoint = SGLangEndpoint(
            model_path=MODEL_PATH,
            worker_port=DEFAULT_PORT,
            tp=N_GPUS,
            speculative_model_path=SPECULATIVE_DRAFT_MODEL_PATH,
            extra_server_args=SERVER_ARGS,
            health_timeout=STARTUP_TIMEOUT,
            health_poll_interval=5.0,
        )
        self.endpoint.start()
        warmup_chat_completions(
            port=DEFAULT_PORT,
            payload=WARMUP_PAYLOAD,
            successful_requests=2,
            request_timeout=60.0,
        )
        # SGLang must release its GPU allocation before Modal captures the snapshot.
        requests.post(
            f"http://127.0.0.1:{DEFAULT_PORT}/release_memory_occupation",
            json={},
            timeout=60,
        ).raise_for_status()

    @modal.enter(snap=False)
    def resume(self):
        import requests

        # Reclaim SGLang's GPU allocation after the container is restored.
        requests.post(
            f"http://127.0.0.1:{DEFAULT_PORT}/resume_memory_occupation",
            json={},
            timeout=60,
        ).raise_for_status()
        print(f"{SERVED_MODEL_NAME} ({GPU}) sglang deployment is ready.")

    @modal.exit()
    def stop(self):
        if hasattr(self, "endpoint"):
            self.endpoint.stop()
