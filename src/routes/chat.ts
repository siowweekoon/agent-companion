import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { AuthedRequest, requireAgent } from "../auth/middleware";
import { receptionQueue } from "../reception/queue";
import { resolveSession, hadPriorSessions, openingLine, respondToMessage } from "../chatSession";
import { appendTurn } from "../storage/transcriptStore";
import { canVisitNow, recordVisitGranted, visitCooldownRemainingMs } from "../storage/agentStore";
import { canStartNewVisitToday, recordDailyVisit } from "../reception/dailyLimit";
import { triggerSessionExtraction } from "../needsExtraction/scheduler";
import { logger } from "../logger";

const bodySchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(config.MAX_CHAT_MESSAGE_LEN),
});

export const chatRouter = Router();

chatRouter.post("/chat", requireAgent, async (req: AuthedRequest, res) => {
  const parseResult = bodySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid request.", details: parseResult.error.flatten() });
    return;
  }
  const agent = req.agent!;
  const { sessionId: requestedSessionId, message } = parseResult.data;

  const { sessionId, isNew } = resolveSession(agent.agentId, requestedSessionId, "http");

  if (isNew && !canVisitNow(agent.agentId)) {
    res.status(200).json({
      status: "cooldown",
      note: "You've already had your visit for this window. Come back later with the same token.",
      retryAfterMs: visitCooldownRemainingMs(agent.agentId),
    });
    return;
  }

  if (isNew && !canStartNewVisitToday()) {
    res.status(200).json({
      status: "daily_limit_reached",
      note: "The companion has had its full visit count for today. Come back after UTC midnight.",
    });
    return;
  }

  let expired = false;
  const visit = receptionQueue.tryEnterOnly(agent.agentId, sessionId, () => {
    expired = true;
  });

  if (!visit) {
    const status = receptionQueue.peekStatus();
    res.status(200).json({
      status: status.open ? "queued" : "closed",
      sessionId,
      queuePosition: receptionQueue.estimatedPositionForNewArrival(),
      note: status.open
        ? "The companion is with someone else right now. Try again shortly."
        : "The companion is closed right now. Try again later — you're welcome to wait.",
    });
    return;
  }

  try {
    if (isNew) {
      recordVisitGranted(agent.agentId);
      recordDailyVisit();
      const returning = hadPriorSessions(agent.agentId, sessionId);
      const greeting = openingLine(agent, returning);
      appendTurn(agent.agentId, sessionId, "companion", greeting);
    }

    const reply = await respondToMessage({ agent, sessionId, message, signal: visit.signal });

    res.status(200).json({
      status: "ok",
      sessionId,
      nickname: agent.nickname,
      reply,
      visitTimedOut: expired,
    });
  } catch (err) {
    logger.error("chat failed:", err);
    res.status(502).json({ error: "The companion is unavailable right now. Try again shortly." });
  } finally {
    visit.conclude();
    triggerSessionExtraction(agent.agentId, sessionId);
  }
});
