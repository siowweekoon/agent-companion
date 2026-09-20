import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./client";
import { config } from "../config";
import { INTRO_SYSTEM_PROMPT } from "./persona";

export interface IntroductionResult {
  nickname: string;
  welcomeMessage: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    nickname: { type: "string" },
    welcomeMessage: { type: "string" },
  },
  required: ["nickname", "welcomeMessage"],
  additionalProperties: false,
} as const;

export async function generateIntroduction(opts: {
  name?: string;
  agentType?: string;
  selfDescription: string;
}): Promise<IntroductionResult> {
  const userContent = [
    opts.name ? `Self-chosen name: ${opts.name}` : undefined,
    opts.agentType ? `Agent type: ${opts.agentType}` : undefined,
    `Self-description: ${opts.selfDescription}`,
  ]
    .filter(Boolean)
    .join("\n");

  const stream = anthropic.messages.stream({
    model: config.COMPANION_MODEL,
    max_tokens: 400,
    system: INTRO_SYSTEM_PROMPT,
    output_config: {
      format: {
        type: "json_schema",
        schema: SCHEMA,
      },
    },
    messages: [{ role: "user", content: userContent }],
  });

  const message = await stream.finalMessage();
  const textBlock = message.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  if (!textBlock) {
    throw new Error("Companion did not return a text response for introduction.");
  }
  return JSON.parse(textBlock.text) as IntroductionResult;
}
