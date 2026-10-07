type Message = { role: "system" | "user" | "assistant"; content: string };
type Completion = { choices?: Array<{ message?: { content?: string } }> };

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
};

const positiveInteger = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${raw}.`);
  }
  return value;
};

const sessionCount = positiveInteger("SESSION_COUNT", 4);
const requestsPerSession = positiveInteger("REQUESTS_PER_SESSION", 16);
const maxTokens = positiveInteger("MAX_TOKENS", 256);
const timeoutSeconds = positiveInteger("REQUEST_TIMEOUT_SECONDS", 600);
const startupRetries = positiveInteger("STARTUP_RETRIES", 12);
const initialBackoffSeconds = positiveInteger("INITIAL_BACKOFF_SECONDS", 2);
const maxBackoffSeconds = positiveInteger("MAX_BACKOFF_SECONDS", 30);
const endpoint = (process.env.ENDPOINT ?? "shared").toUpperCase();
const baseUrl = required(`${endpoint}_BASE_URL`).replace(/\/$/, "");
const model = required(`${endpoint}_MODEL`);
const token = `${required("MODAL_KEY")}.${required("MODAL_SECRET")}`;
const basePrompt =
  process.env.PROMPT ??
  "Give me one concise fact about distributed systems.";

const waitForEndpoint = async () => {
  for (let attempt = 0; attempt <= startupRetries; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutSeconds * 1_000),
    });

    if (response.ok) return;

    const body = await response.text();
    if (response.status !== 503 || attempt === startupRetries) {
      throw new Error(`Endpoint readiness failed (${response.status}): ${body}`);
    }

    const delaySeconds = Math.min(
      initialBackoffSeconds * 2 ** attempt,
      maxBackoffSeconds,
    );
    console.log(
      `Endpoint is starting (${response.status}); retrying in ${delaySeconds}s...`,
    );
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1_000));
  }
};

await waitForEndpoint().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

console.log(
  `Starting ${sessionCount} concurrent sessions with ${requestsPerSession} requests each...`,
);

const runSession = async (number: number) => {
  const sessionId = `demo-${number}-${crypto.randomUUID()}`;
  const messages: Message[] = [
    { role: "system", content: "Keep every answer to one short sentence." },
  ];

  console.log(`Session ${number} started: ${sessionId}`);

  for (let turn = 1; turn <= requestsPerSession; turn += 1) {
    messages.push({ role: "user", content: `${basePrompt} Turn ${turn}.` });

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Modal-Session-Id": sessionId,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(timeoutSeconds * 1_000),
    });

    const result = (await response.json()) as Completion;
    if (!response.ok) throw new Error(JSON.stringify(result));

    messages.push({
      role: "assistant",
      content: result.choices?.[0]?.message?.content ?? "Acknowledged.",
    });
  }

  console.log(`Session ${number} completed.`);
};

const results = await Promise.allSettled(
  Array.from({ length: sessionCount }, (_, index) => runSession(index + 1)),
);
const failures = results.filter((result) => result.status === "rejected");

console.log(
  `Load complete: ${sessionCount - failures.length} sessions succeeded, ${failures.length} failed.`,
);

if (failures.length > 0) {
  for (const failure of failures) {
    const message =
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
    console.error(message);
  }
  process.exitCode = 1;
}
