.DEFAULT_GOAL := help

.PHONY: help request load-shared load-dedicated load-custom deploy-server sandbox sandbox-load sandbox-load-spike sandbox-server

ENDPOINT ?= shared
MEMORY_SPIKE_MIB ?= 1024
HOLD_SECONDS ?= 10
SESSION_COUNT ?= 4
REQUESTS_PER_SESSION ?= 16
MAX_TOKENS ?= 256
REQUEST_TIMEOUT_SECONDS ?= 600
STARTUP_RETRIES ?= 12
INITIAL_BACKOFF_SECONDS ?= 2
MAX_BACKOFF_SECONDS ?= 30
export ENDPOINT SESSION_COUNT REQUESTS_PER_SESSION MAX_TOKENS REQUEST_TIMEOUT_SECONDS
export STARTUP_RETRIES INITIAL_BACKOFF_SECONDS MAX_BACKOFF_SECONDS

help:
	@echo "Available demo targets:"
	@echo "  request          Call a Modal chat-completions endpoint"
	@echo "  load-shared     Send load to the shared endpoint"
	@echo "  load-dedicated  Send load to the dedicated endpoint"
	@echo "  load-custom     Send load to the custom endpoint"
	@echo "  deploy-server   Deploy the custom GPU server"
	@echo "  sandbox         Create and use a Modal Sandbox"
	@echo "  sandbox-load    Start Sandboxes that exit immediately (no memory hold)"
	@echo "  sandbox-load-spike  Same, but each Sandbox holds 1 GiB for 10s"
	@echo "  sandbox-server  Run a secure server with an exit snapshot"
	@echo ""
	@echo "Example: make load-custom SESSION_COUNT=4 REQUESTS_PER_SESSION=16"

request:
	@node --env-file=.env demos/01-modal-endpoint/request.ts

load-shared: ENDPOINT=shared
load-dedicated: ENDPOINT=dedicated
load-custom: ENDPOINT=custom
load-shared load-dedicated load-custom:
	@node --env-file=.env demos/02-load-requests/load.ts

deploy-server:
	@uv run --env-file .env modal deploy demos/03-server/server.py

sandbox:
	@node --env-file-if-exists=.env demos/04-sandbox/sandbox.ts

sandbox-load:
	@node --env-file-if-exists=.env demos/05-sandbox-load/load.ts

sandbox-load-spike:
	@MEMORY_SPIKE_MIB=$(MEMORY_SPIKE_MIB) HOLD_SECONDS=$(HOLD_SECONDS) node --env-file-if-exists=.env demos/05-sandbox-load/load.ts

sandbox-server:
	@node --env-file-if-exists=.env demos/06-sandbox-server/server.ts
