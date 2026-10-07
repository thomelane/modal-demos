import { ModalClient, type Sandbox } from "modal";

const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const count = (n: number) => n.toLocaleString("en-US");
const secs = (ms: number) => `${(ms / 1_000).toFixed(1)}s`;

const sandboxCount = num("SANDBOX_COUNT", 1000);
// Bound how many calls are in flight. Fanning all of them out at once drains
// Node's event loop and aborts the run with ERR_UNSETTLED_TOP_LEVEL_AWAIT.
const concurrency = num("CONCURRENCY", 500);
// Both off by default. The spike shows memory bursting past the 128 MiB
// request; the hold is what makes Sandboxes overlap, and every second of it is
// billed across the whole fleet, so keep it just longer than the create sweep.
const memoryMiB = num("MEMORY_SPIKE_MIB", 0);
const holdSeconds = num("HOLD_SECONDS", 0);

const modal = new ModalClient({ environment: process.env.MODAL_ENVIRONMENT });
const app = await modal.apps.fromName("modal-demos-sandbox-load", {
  createIfMissing: true,
});
const image = modal.images.fromRegistry("python:3.13-slim");

// Touch every page so the allocation is real resident memory, not a lazy map.
const payload = `
import time
${memoryMiB ? `data = bytearray(${memoryMiB} * 1024 * 1024)` : ""}
${memoryMiB ? `for page in range(0, len(data), 4096): data[page] = 1` : ""}
print("ready", flush=True)
${holdSeconds ? `time.sleep(${holdSeconds})` : ""}
`;

const workload = [
  memoryMiB ? `allocate and touch ${count(memoryMiB)} MiB` : "start up",
  holdSeconds ? `stay alive for ${holdSeconds}s` : "exit straight away",
].join(", then ");

console.log(`
Modal Sandbox load test
  Sandboxes      ${count(sandboxCount)}
  Each one will  ${workload}
  Resources      Modal defaults: 0.125 CPU cores, 128 MiB memory\
${memoryMiB ? " — a request, not a cap" : ""}
  Concurrency    up to ${count(concurrency)} API calls in flight
`);

const sandboxes: Sandbox[] = [];
const failures: unknown[] = [];

// Bounded worker pool: each worker pulls the next item until the run is done.
const pool = async <T>(items: T[], task: (item: T) => Promise<void>) => {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      try {
        await task(items[next++]!);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
};

const startedAt = Date.now();
console.log(`Spinning up ${count(sandboxCount)} Sandboxes...`);

// Nothing waits for these Sandboxes: each one stops when its command ends, and
// the timeout is the backstop that bounds a stuck one's bill.
const timeoutSeconds = holdSeconds + 60;

await pool(Array.from({ length: sandboxCount }), async () => {
  // Deliberately omit memoryMiB so this uses Modal's default memory request.
  const sandbox = await modal.sandboxes.create(app, image, {
    command: ["python", "-c", payload],
    timeoutMs: timeoutSeconds * 1_000,
  });
  const created = sandboxes.push(sandbox);
  // One line per Sandbox: at scale the blur of IDs scrolling past is the point.
  console.log(
    `  ${count(created).padStart(6)}  ${sandbox.sandboxId}  ${secs(Date.now() - startedAt)}`,
  );
});

const failed = failures.length;
console.log(
  `\n  All ${count(sandboxes.length)} Sandboxes up in ${secs(Date.now() - startedAt)}` +
    (failed ? `\n  ${count(failed)} failed to start` : "") +
    `\n  Leaving them to stop on their own, or at their ${timeoutSeconds}s timeout.\n`,
);

for (const error of failures.slice(0, 5)) console.error(error);
if (failed > 5) console.error(`...and ${failed - 5} more failures.`);

if (failed) process.exitCode = 1;
