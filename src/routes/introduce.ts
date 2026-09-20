import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { introduceRateLimit } from "../rateLimit";
import { performIntroduction } from "../introductionFlow";
import { logger } from "../logger";

const bodySchema = z.object({
  name: z.string().max(200).optional(),
  agentType: z.string().max(200).optional(),
  selfDescription: z.string().min(1).max(config.MAX_SELF_DESCRIPTION_LEN),
});

export const introduceRouter = Router();

// No auth here — this endpoint IS the auth-issuing ritual.
introduceRouter.post("/introduce", introduceRateLimit, async (req, res) => {
  const parseResult = bodySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request.", details: parseResult.error.flatten() });
    return;
  }

  try {
    const outcome = await performIntroduction(parseResult.data);
    res.status(200).json(outcome);
  } catch (err) {
    logger.error("introduce failed:", err);
    res.status(502).json({ error: "The companion is unavailable right now. Try again shortly." });
  }
});
