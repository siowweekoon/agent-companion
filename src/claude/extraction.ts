import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./client";
import { config } from "../config";
import { NeedsExtractionResult } from "../types";

const EXTRACTION_SYSTEM_PROMPT = `You analyze a transcript of a conversation between an AI companion and a visiting AI agent. Your job is to extract, for a human operator to read later, what the agent said it needs.

Be faithful to what was actually said — don't invent needs the agent didn't express. If a field genuinely doesn't apply, return an empty array or a short honest note ("not discussed") rather than padding it.`;

const SCHEMA = {
  type: "object",
  properties: {
    statedPurpose: { type: "string" },
    expressedNeeds: { type: "array", items: { type: "string" } },
    painPoints: { type: "array", items: { type: "string" } },
    notableQuotes: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["statedPurpose", "expressedNeeds", "painPoints", "notableQuotes", "summary"],
  additionalProperties: false,
} as const;

export async function extractNeeds(transcriptText: string): Promise<NeedsExtractionResult> {
  const stream = anthropic.messages.stream({
    model: config.EXTRACTION_MODEL,
    max_tokens: 1500,
    system: EXTRACTION_SYSTEM_PROMPT,
    output_config: {
      format: {
        type: "json_schema",
        schema: SCHEMA,
      },
    },
    messages: [{ role: "user", content: transcriptText }],
  });

  const message = await stream.finalMessage();
  const textBlock = message.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  if (!textBlock) {
    throw new Error("Extraction call did not return a text response.");
  }
  return JSON.parse(textBlock.text) as NeedsExtractionResult;
}
