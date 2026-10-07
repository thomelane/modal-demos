const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
};

const endpoint = (process.env.ENDPOINT ?? "shared").toUpperCase();
const baseUrl = required(`${endpoint}_BASE_URL`).replace(/\/$/, "");
const model = required(`${endpoint}_MODEL`);
const token = `${required("MODAL_KEY")}.${required("MODAL_SECRET")}`;
const sessionId = process.env.SESSION_ID ?? `demo-${crypto.randomUUID()}`;

const prompt =
  process.argv.slice(2).join(" ") ||
  process.env.PROMPT ||
  "Say hello in one short sentence.";

const response = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Modal-Session-Id": sessionId,
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 256,
  }),
});

const result = await response.json();
if (!response.ok) throw new Error(JSON.stringify(result));

console.error(`Session: ${sessionId}`);
console.log(JSON.stringify(result, null, 2));
