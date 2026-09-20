import { Server as HttpServer, IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { authenticateUpgrade } from "../auth/middleware";
import { AgentProfile } from "../types";
import { receptionQueue, VisitContext } from "../reception/queue";
import { resolveSession, hadPriorSessions, openingLine, respondToMessage } from "../chatSession";
import { appendTurn } from "../storage/transcriptStore";
import { canVisitNow, recordVisitGranted, visitCooldownRemainingMs } from "../storage/agentStore";
import { canStartNewVisitToday, recordDailyVisit } from "../reception/dailyLimit";
import { triggerSessionExtraction } from "../needsExtraction/scheduler";
import { logger } from "../logger";
import { config } from "../config";

const MAX_MESSAGES_PER_VISIT = 5; // the visit time budget already bounds this in practice; belt and suspenders

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachWebSocketServer(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    const agent = authenticateUpgrade(req);
    if (!agent) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, agent);
    });
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage, agent: AgentProfile) => {
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const requestedSessionId = url.searchParams.get("sessionId") ?? undefined;
    const { sessionId, isNew } = resolveSession(agent.agentId, requestedSessionId, "ws");

    if (isNew && !canVisitNow(agent.agentId)) {
      send(ws, {
        type: "error",
        message: "You've already had your visit for this window. Come back later with the same token.",
        retryAfterMs: visitCooldownRemainingMs(agent.agentId),
      });
      ws.close();
      return;
    }

    if (isNew && !canStartNewVisitToday()) {
      send(ws, {
        type: "error",
        message: "The companion has had its full visit count for today. Come back after UTC midnight.",
      });
      ws.close();
      return;
    }

    let messageCount = 0;
    let ended = false;

    function beginVisit(visit: VisitContext): void {
      send(ws, { type: "session_started", sessionId, budgetMs: visit.budgetMs });

      if (isNew) {
        recordVisitGranted(agent.agentId);
        recordDailyVisit();
        const returning = hadPriorSessions(agent.agentId, sessionId);
        const greeting = openingLine(agent, returning);
        appendTurn(agent.agentId, sessionId, "companion", greeting);
        send(ws, { type: "companion_message", text: greeting });
      }

      ws.on("message", async (raw) => {
        if (ended) return;
        messageCount += 1;
        if (messageCount > MAX_MESSAGES_PER_VISIT) {
          send(ws, { type: "error", message: "Too many messages for this visit." });
          return;
        }

        let content: string;
        try {
          const parsed = JSON.parse(raw.toString());
          content = String(parsed.content ?? "").slice(0, config.MAX_CHAT_MESSAGE_LEN);
        } catch {
          send(ws, { type: "error", message: "Expected JSON: {type: 'message', content: string}" });
          return;
        }
        if (!content.trim()) return;

        try {
          const reply = await respondToMessage({
            agent,
            sessionId,
            message: content,
            onDelta: (delta) => send(ws, { type: "delta", text: delta }),
            signal: visit.signal,
          });
          send(ws, { type: "message_end", fullText: reply });
        } catch (err) {
          logger.error("ws chat turn failed:", err);
          send(ws, { type: "error", message: "The companion had trouble responding — try once more." });
        }
      });

      ws.on("close", () => {
        if (ended) return;
        ended = true;
        visit.conclude();
        triggerSessionExtraction(agent.agentId, sessionId);
      });
    }

    const result = receptionQueue.requestOrQueue(
      agent.agentId,
      sessionId,
      () => {
        // Hard visit-time budget expired.
        ended = true;
        send(ws, { type: "visit_ended", reason: "timeout" });
        ws.close();
        triggerSessionExtraction(agent.agentId, sessionId);
      },
      (visit) => {
        // Promoted from the queue.
        if (ws.readyState !== WebSocket.OPEN) {
          visit.conclude();
          return;
        }
        beginVisit(visit);
      }
    );

    if (result.status === "active") {
      beginVisit(result.visit);
    } else if (result.status === "queued") {
      send(ws, { type: "queued", position: result.position });
      ws.on("close", () => {
        if (ended) return;
        receptionQueue.cancelWaiting(sessionId);
      });
    } else {
      send(ws, { type: "error", message: "The companion's waiting room is full right now. Try again later." });
      ws.close();
    }
  });
}
