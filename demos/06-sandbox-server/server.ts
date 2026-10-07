import { ModalClient } from "modal";
import { createInterface } from "node:readline/promises";

const modal = new ModalClient({ environment: process.env.MODAL_ENVIRONMENT });
const app = await modal.apps.fromName("modal-demos-sandbox-server", {
  createIfMissing: true,
});
const image = modal.images.fromRegistry("python:3.13-slim");

const waitForEnter = async (message: string) => {
  if (!process.stdin.isTTY) {
    console.log(`${message} (skipped: non-interactive terminal)`);
    return;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  await readline.question(`${message}\n`);
  readline.close();
};

const serverCode = `
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        user = self.headers.get("X-Verified-User-Data", "unknown")
        state = {"message": "Hello from a secure Sandbox server!", "user": user}
        Path("/demo-state.json").write_text(json.dumps(state))
        body = json.dumps(state).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass

HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
`;

const sandbox = await modal.sandboxes.create(app, image, {
  command: ["python", "-c", serverCode],
  timeoutMs: 5 * 60 * 1_000,
  experimentalOptions: { enable_exit_snapshot: true },
});

try {
  const credentials = await sandbox.createConnectToken({
    port: 8080,
    userMetadata: JSON.stringify({ userId: "demo-user" }),
  });
  const browserUrl = new URL(credentials.url);
  browserUrl.searchParams.set("_modal_connect_token", credentials.token);

  let response: Response | undefined;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    response = await fetch(credentials.url, {
      headers: { Authorization: `Bearer ${credentials.token}` },
    }).catch(() => undefined);

    if (response?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!response?.ok) {
    throw new Error(`Server did not become ready (status ${response?.status ?? "unavailable"})`);
  }

  console.log(await response.text());
  console.log(`Open in your browser: ${browserUrl}`);
  await waitForEnter("Press Enter to terminate the server and create its exit snapshot.");
} finally {
  await sandbox.terminate({ wait: true });
}

const snapshot = await sandbox.experimentalGetExitSnapshot({ timeoutMs: 120_000 });
console.log(`Exit snapshot: ${snapshot.imageId}`);

const restored = await modal.sandboxes.create(app, snapshot, {
  timeoutMs: 5 * 60 * 1_000,
});

try {
  const state = await restored.exec(["cat", "/demo-state.json"]);
  console.log(`Restored state: ${await state.stdout.readText()}`);
  await waitForEnter("Press Enter to terminate the restored Sandbox.");
} finally {
  await restored.terminate({ wait: true });
}
