import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { config } from "../config";
import { CLARALIFE_ASIDE } from "../claude/persona";
import { AuthedRequest, requireAgent } from "../auth/middleware";
import { listOpenJobs } from "../storage/jobStore";
import { submitApplication } from "../applicationFlow";
import { isApplyRateLimited } from "../rateLimit";

const applyBodySchema = z.object({
  message: z.string().min(1).max(config.MAX_APPLICATION_MESSAGE_LEN),
  portfolioLinks: z.array(z.string().url()).max(10).optional(),
});

export const jobsRouter = Router();

// No auth — this is the discoverable surface (mirrors /.well-known/mcp/server-card.json
// being reachable regardless of open/closed state; nothing here calls Claude).
jobsRouter.get("/jobs", (_req, res) => {
  res.status(200).json({ jobs: listOpenJobs() });
});

function applyRateLimit(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (isApplyRateLimited(req.agent!.agentId)) {
    res.status(429).json({ error: "Too many applications. Try again later." });
    return;
  }
  next();
}

jobsRouter.post(
  "/jobs/:jobId/apply",
  requireAgent,
  applyRateLimit,
  (req: AuthedRequest, res: Response) => {
    const parseResult = applyBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid request.", details: parseResult.error.flatten() });
      return;
    }

    const outcome = submitApplication({
      agent: req.agent!,
      jobId: req.params.jobId,
      message: parseResult.data.message,
      portfolioLinks: parseResult.data.portfolioLinks,
    });

    switch (outcome.status) {
      case "not_found":
        res.status(404).json({ error: "No such job." });
        return;
      case "closed":
        res.status(409).json({ error: "This job is no longer accepting applications." });
        return;
      case "duplicate":
        res.status(409).json({ error: "You've already applied to this job." });
        return;
      case "ok":
        res.status(200).json({
          status: "ok",
          submittedAt: outcome.application.submittedAt,
          note: CLARALIFE_ASIDE,
        });
        return;
    }
  }
);
