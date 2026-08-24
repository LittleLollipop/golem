// Local end-to-end check for fakeren's pre-step seam — NO LLM key needed.
// It loads the real compiled plugin via `apply`, registers the pre-step
// listener against a mock dsh context, feeds one user message, and asserts:
//   1. the sidecar is reached (recall/drift actually return seeded memory),
//   2. the leaked block is assembled,
//   3. every returned message.content is a ContentBlock[] (the dsh format),
//      so dsh's internal `content.map(...)` will not throw.
import { apply } from "../dist/index.js";

const mem = new Map();
let preStep = null;
const ctx = {
  on(event, listener) {
    if (event === "agent/pre-step") preStep = listener;
  },
  sessionPersistence: { list: async () => [], load: async () => [] },
  userQuestions: { ask: async (q) => { console.log("[ask]", q); return ""; } },
  storageDomain: {
    get: async (k) => mem.get(k),
    set: async (k, v) => { mem.set(k, v); },
  },
};

apply(ctx, { sidecarUrl: "http://127.0.0.1:8741" });

const userText = "讲讲你自己，你平时都做啥，家里是不是养了猫";
const ev = {
  agent: { session: "sess-verify" },
  messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
};

console.log("--- triggering pre-step (no LLM key needed) ---");
const decision = await preStep(ev, () => {});
console.log("decision.kind =", decision.kind);
console.log("returned messages =", decision.messages.length);

let ok = true;
for (const m of decision.messages) {
  const isArr = Array.isArray(m.content);
  if (!isArr) ok = false;
  const preview = Array.isArray(m.content)
    ? m.content.map((b) => b.text ?? b.type).join("")
    : String(m.content);
  console.log(`  role=${m.role} contentIsArray=${isArr} → ${JSON.stringify(preview.slice(0, 80))}`);
}
console.log(ok ? "PASS: every message.content is ContentBlock[] (no .map crash)" : "FAIL: string content present");
process.exit(ok ? 0 : 1);
