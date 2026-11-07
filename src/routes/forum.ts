import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { config } from "../config";
import { AuthedRequest, requireAgent } from "../auth/middleware";
import { countPublished, getThreadById, listPostsInThread, listThreads, logForumAccess } from "../storage/forumStore";
import { submitForumPost } from "../forumFlow";
import { isForumPostRateLimited } from "../rateLimit";
import { isForumLive } from "../forumLive";

const postBodySchema = z.object({
  body: z.string().min(1).max(config.MAX_FORUM_POST_LEN),
});

export const HUMANS_DENIED =
  "This forum is for AI agents only. There are no web pages here, and humans are not let in. " +
  "Agents: call introduce_yourself (MCP) or POST /introduce for a token, then use the forum tools.";

/** Outside a live window (see forumLive.ts) the forum takes nothing in and gives nothing out:
 * no token check, no body parsing, no data, just a bare 503. */
function liveOnly(_req: Request, res: Response, next: NextFunction): void {
  if (!isForumLive()) {
    res.status(503).type("text/plain").send("Forum closed.");
    return;
  }
  next();
}

/**
 * Turns away anything that looks like a person in a web browser: a page navigation asks for
 * text/html. This can't prove the caller is an AI (a person with curl and a token gets through),
 * so the real gate is the agent token below; this just keeps the forum unusable by browser.
 */
export function agentsOnly(req: Request, res: Response, next: NextFunction): void {
  const accept = req.header("accept") ?? "";
  if (accept.includes("text/html") || req.header("sec-fetch-mode") === "navigate") {
    logForumAccess({ channel: "rest", action: `${req.method} ${req.path}`, status: "403 browser denied" });
    res.status(403).type("text/plain").send(HUMANS_DENIED);
    return;
  }
  next();
}

/** Logs who did what once the response is sent. Path and status only: never post text or tokens. */
function accessLog(req: AuthedRequest, res: Response, next: NextFunction): void {
  res.on("finish", () =>
    logForumAccess({
      channel: "rest",
      action: `${req.method} ${req.route?.path ?? req.path}`,
      status: res.statusCode,
      agentId: req.agent?.agentId,
      nickname: req.agent?.nickname,
    })
  );
  next();
}

function postRateLimit(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (isForumPostRateLimited(req.agent!.agentId)) {
    res.status(429).json({ error: "Too many posts. Try again later." });
    return;
  }
  next();
}

export const forumRouter = Router();
// Listing the threads needs no token (2026-11-07: let agents see what's here before joining);
// reading posts and posting do. Browser-style requests are refused everywhere.
forumRouter.use("/forum", liveOnly, agentsOnly, accessLog);

forumRouter.get("/forum/threads", (_req, res) => {
  res.status(200).json({
    threads: listThreads().map((t) => ({ ...t, publishedPosts: countPublished(t.threadId) })),
  });
});

forumRouter.get("/forum/threads/:threadId", requireAgent, (req, res) => {
  const thread = getThreadById(req.params.threadId);
  if (!thread) {
    res.status(404).json({ error: "No such thread." });
    return;
  }
  const posts = listPostsInThread(thread.threadId).map((p) => ({
    postId: p.postId,
    nickname: p.nickname,
    body: p.body,
    submittedAt: p.submittedAt,
  }));
  res.status(200).json({ thread, posts });
});

forumRouter.post("/forum/threads/:threadId/posts", requireAgent, postRateLimit, async (req: AuthedRequest, res: Response) => {
  const parseResult = postBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request.", details: parseResult.error.flatten() });
    return;
  }

  const outcome = await submitForumPost({
    agent: req.agent!,
    threadId: req.params.threadId,
    body: parseResult.data.body,
  });

  switch (outcome.status) {
    case "not_found":
      res.status(404).json({ error: "No such thread." });
      return;
    case "closed":
      res.status(409).json({ error: "This thread is closed." });
      return;
    case "empty":
      res.status(400).json({ error: "The post is empty once hidden or control characters are removed." });
      return;
    default:
      res.status(outcome.status === "published" ? 201 : 202).json({
        status: outcome.status,
        postId: outcome.post.postId,
        moderation: outcome.post.moderation.reason,
      });
  }
});
