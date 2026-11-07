import crypto from "crypto";
import { AgentProfile, ForumPost } from "./types";
import { getThreadById, savePost } from "./storage/forumStore";
import { moderateForumPost } from "./claude/forumModerator";
import { cleanText, riskSignals } from "./forumSafety";
import { logger } from "./logger";

export type ForumPostOutcome =
  | { status: "published" | "rejected" | "held"; post: ForumPost }
  | { status: "not_found" }
  | { status: "closed" }
  | { status: "empty" };

/** Shared by the REST POST /forum/threads/:threadId/posts route and the MCP post_to_forum tool.
 * Fully automatic (the operator's choice: no human review before publishing). Order matters:
 * clean first (so nothing hidden reaches the moderator, the disk or the operator's terminal), then
 * the deterministic checks (a blocking one rejects at once, without a model call), then the
 * moderator. Published = moderator approved AND no blocking check fired. A moderator outage rejects. */
export async function submitForumPost(opts: {
  agent: AgentProfile;
  threadId: string;
  body: string;
}): Promise<ForumPostOutcome> {
  const thread = getThreadById(opts.threadId);
  if (!thread) return { status: "not_found" };
  if (thread.status !== "open") return { status: "closed" };

  const { text, removed } = cleanText(opts.body);
  if (!text) return { status: "empty" };
  const { blocking, advisory } = riskSignals(text);

  let decision: ForumPost["moderation"]["decision"];
  let reason: string;
  let by = "moderator";
  if (blocking.length) {
    decision = "reject";
    reason = `Rejected by the automatic safety checks: ${blocking.join(", ")}. Describe it in words instead.`;
    by = "safety checks";
  } else {
    try {
      ({ decision, reason } = await moderateForumPost(thread, text, advisory));
    } catch (err) {
      logger.error("forum moderation failed; post not published:", err);
      decision = "reject";
      reason = "The moderator was unavailable, so the post was not published. Try again shortly.";
    }
  }

  const post: ForumPost = {
    postId: crypto.randomUUID(),
    threadId: thread.threadId,
    agentId: opts.agent.agentId,
    nickname: cleanText(opts.agent.nickname).text,
    body: text,
    submittedAt: new Date().toISOString(),
    status: decision === "approve" ? "published" : decision === "reject" ? "rejected" : "held",
    removedChars: removed,
    riskSignals: [...blocking, ...advisory],
    moderation: { decision, reason, by, at: new Date().toISOString() },
  };
  savePost(post);
  return { status: post.status, post };
}
