# Modal demos

Self-contained examples for Modal endpoints, a custom GPU server, and
Sandboxes. Run `make` to list the available targets.

## Demos

| Example | Run |
| --- | --- |
| [Single endpoint request](demos/01-modal-endpoint/request.ts) | `make request` |
| [Shared endpoint load](demos/02-load-requests/load.ts) | `make load-shared` |
| [Dedicated endpoint load](demos/02-load-requests/load.ts) | `make load-dedicated` |
| [Custom endpoint load](demos/02-load-requests/load.ts) | `make load-custom` |
| [Custom GPU server](demos/03-server/server.py) | `make deploy-server` |
| [Basic Sandbox](demos/04-sandbox/sandbox.ts) | `make sandbox` |
| [Sandbox load](demos/05-sandbox-load/load.ts) | `make sandbox-load` |
| [Sandbox load with a memory spike](demos/05-sandbox-load/load.ts) | `make sandbox-load-spike` |
| [Secure Sandbox server and exit snapshot](demos/06-sandbox-server/server.ts) | `make sandbox-server` |

Install dependencies once:

```sh
uv sync
npm install
```

Configuration and endpoint proxy credentials live in `.env`, which is ignored
by Git. Copy `.env.example` to `.env` and fill it in to run the endpoint
demos. The Sandbox demos need no `.env` at all; they take credentials from the
active Modal profile.

The endpoint demos read `MODAL_KEY`, `MODAL_SECRET`, and a `<ENDPOINT>_BASE_URL`
and `<ENDPOINT>_MODEL` pair per endpoint (`SHARED_`, `DEDICATED_`, `CUSTOM_`).
The GPU server reads `ENDPOINT_VOLUME_NAME`, the Modal Volume holding the model
weights.

Endpoint load defaults to four concurrent affinity sessions with 16 sequential
requests each. Override it with, for example:

```sh
make load-custom SESSION_COUNT=8 REQUESTS_PER_SESSION=8
```

The Sandbox load defaults to 1000 Sandboxes that start and exit immediately,
which measures create, exec, and teardown without paying for held memory:

```sh
make sandbox-load SANDBOX_COUNT=100
```

The memory spike is opt-in. `sandbox-load-spike` has each Sandbox allocate and
touch `MEMORY_SPIKE_MIB` (1024 by default) and hold it for `HOLD_SECONDS` (10),
against Modal's default request of 128 MiB:

```sh
make sandbox-load-spike SANDBOX_COUNT=100 MEMORY_SPIKE_MIB=1024 HOLD_SECONDS=30
```

`HOLD_SECONDS` is also what makes Sandboxes overlap: without it each one exits
the moment it starts, so they never run at the same time. Creating 10000
Sandboxes takes about 5s at `CONCURRENCY=500`, so the hold only needs to
outlast the creation sweep by a few seconds. Billing runs for the whole hold
across every Sandbox, so a hold far longer than the sweep costs real money and
proves nothing extra — 10000 Sandboxes cost about $1.15 at the recommended 15s
hold and about $7.50 at 120s. To see 10000 running concurrently:

```sh
make sandbox-load SANDBOX_COUNT=10000 CONCURRENCY=500 HOLD_SECONDS=15
```

The run reports creation throughput and polls a 100-Sandbox sample mid-hold, so
the concurrency figure is observed rather than inferred from `create()`
returning. `CONCURRENCY` caps how many calls are in flight per phase; fanning
out all 10000 at once drains Node's event loop and aborts the run with
`ERR_UNSETTLED_TOP_LEVEL_AWAIT`.
