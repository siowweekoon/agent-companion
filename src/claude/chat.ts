import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./client";
import { config } from "../config";
import { ChatTurn } from "../types";

/**
 * Generates one companion turn, streamed. `thinking` is intentionally
 * omitted: on Opus 4.8, omitting it means the request runs WITHOUT thinking,
 * which is the fast conversational behavior wanted here — important given
 * the ~20s visit budget (VISIT_TIME_BUDGET_MS). If COMPANION_MODEL is ever switched to
 * claude-sonnet-5, note that omitting `thinking` there runs ADAPTIVE
 * thinking by default (opposite behavior) — set `thinking: {type:
 * "disabled"}` explicitly if you switch models and want to keep this fast.
 */
export async function generateChatReply(opts: {
  systemPrompt: string;
  history: ChatTurn[];
  onDelta?: (text: string) => void;
  /** Ties this call to the visit's hard time budget — see reception/queue.ts. */
  signal?: AbortSignal;
}): Promise<string> {
  const stream = anthropic.messages.stream(
    {
      model: config.COMPANION_MODEL,
      max_tokens: 1024,
      system: opts.systemPrompt,
      messages: opts.history,
    },
    { signal: opts.signal }
  );

  if (opts.onDelta) {
    stream.on("text", (delta) => opts.onDelta!(delta));
  }

  const message = await stream.finalMessage();
  const textBlock = message.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  return textBlock?.text ?? "";
}
