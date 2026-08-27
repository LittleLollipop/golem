/**
 * LlmClient — the seam that lets golem reuse "the agent's own model"
 * (req_memory_auto_extract: 无第二模型). This is intentionally DECOUPLED from
 * dsh: golem's only dsh touchpoint is adapter/dsh-seams.ts (C3), and we don't
 * fork dsh's internal llm package. Instead we talk OpenAI-compatible
 * chat-completions directly (DeepSeek by default — the same family the agent
 * uses), so the core stays testable and the host model is swappable.
 *
 * The LLM path is OPT-IN: the composition root only wires LlmExtractor /
 * LlmValence / LlmGrader when a client is provided (config.llm or an API key
 * in the environment). Without one, the heuristic defaults keep the system
 * fully runnable (#22/#23/#25 resolved behind seams, no forced dependency).
 */

export interface LlmClient {
  /** One chat completion. Implementations must not throw on transient errors. */
  complete(system: string, user: string): Promise<string>;
}

export interface HttpLlmOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
}

export class HttpLlmClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;

  constructor(opts: HttpLlmOptions = {}) {
    this.baseUrl =
      opts.baseUrl ?? process.env.FAKEREN_LLM_BASE_URL ?? "https://api.deepseek.com/v1";
    this.apiKey =
      opts.apiKey ??
      process.env.DEEPSEEK_API_KEY ??
      process.env.FAKEREN_LLM_API_KEY ??
      "";
    this.model = opts.model ?? process.env.FAKEREN_LLM_MODEL ?? "deepseek-chat";
    this.temperature = opts.temperature ?? 0.3;
    if (!this.apiKey) {
      throw new Error(
        "HttpLlmClient: no API key (set DEEPSEEK_API_KEY / FAKEREN_LLM_API_KEY or pass apiKey)",
      );
    }
  }

  async complete(system: string, user: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: this.temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as any;
    return json?.choices?.[0]?.message?.content ?? "";
  }
}

/** Strip ```json fences some models wrap around otherwise-valid JSON. */
export function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : raw).trim();
}
