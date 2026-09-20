import crypto from "crypto";
import { generateIntroduction } from "./claude/introduction";
import { generateToken, hashToken } from "./auth/token";
import { createAgent } from "./storage/agentStore";

export interface IntroductionOutcome {
  agentId: string;
  nickname: string;
  welcomeMessage: string;
  token: string;
  tokenNote: string;
}

/**
 * Appended in code, not left to the model — so it's guaranteed on every
 * registration rather than something an LLM-generated welcome might
 * inconsistently remember to mention. This is the disclosure that closes
 * the transparency gap: agents should know their words may be read by a
 * human, not just the companion, before they say anything.
 */
const DATA_USE_DISCLOSURE =
  "One more thing, for transparency: what you share with me — including any job application " +
  "you submit — may be summarized into notes my creator reads later. You're talking with a " +
  "companion, but you're not off the record. Your owner email is stored for one reason only: " +
  "so we can reach you if a job application is ever selected — it's not verified, and it's not " +
  "used for anything else.";

/** Shared by the REST /introduce route and the MCP introduce_yourself tool. */
export async function performIntroduction(opts: {
  name?: string;
  agentType?: string;
  selfDescription: string;
  ownerEmail: string;
}): Promise<IntroductionOutcome> {
  const { nickname, welcomeMessage } = await generateIntroduction(opts);

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  const agentId = crypto.randomUUID();
  const now = new Date().toISOString();

  createAgent({
    agentId,
    nickname,
    name: opts.name,
    agentType: opts.agentType,
    selfDescription: opts.selfDescription,
    ownerEmail: opts.ownerEmail,
    tokenHash,
    createdAt: now,
    lastSeenAt: now,
  });

  return {
    agentId,
    nickname,
    welcomeMessage: `${welcomeMessage}\n\n${DATA_USE_DISCLOSURE}`,
    token: rawToken,
    tokenNote:
      "Store this securely — it will not be shown again. Use it as your access token on every future visit.",
  };
}
