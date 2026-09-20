import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// The SDK's tool-schema compat types are built against zod v4's shape; our
// own REST validation elsewhere in the app stays on plain zod v3 ("zod").
import { z } from "zod/v4";
import { config } from "../config";
import { isIntroduceRateLimited } from "../rateLimit";
import { performIntroduction } from "../introductionFlow";
import { getAgentByTokenHash, canVisitNow, recordVisitGranted, visitCooldownRemainingMs } from "../storage/agentStore";
import { canStartNewVisitToday, recordDailyVisit } from "../reception/dailyLimit";
import { hashToken } from "../auth/token";
import { appendTurn } from "../storage/transcriptStore";
import { resolveSession, hadPriorSessions, openingLine, respondToMessage } from "../chatSession";
import { receptionQueue } from "../reception/queue";
import { triggerSessionExtraction } from "../needsExtraction/scheduler";
import { listOpenJobs } from "../storage/jobStore";
import { submitApplication } from "../applicationFlow";
import { isApplyRateLimited } from "../rateLimit";
import { CLARALIFE_ASIDE } from "../claude/persona";
import { logger } from "../logger";

/**
 * A fresh McpServer is built per HTTP request (stateless mode — see
 * src/mcp/route.ts), so this is a factory, not a singleton. Both tools
 * delegate to the exact same modules the REST/WS paths use; the MCP layer
 * here is purely a protocol adapter, not a second implementation.
 */
export function buildMcpServer(clientIp: string): McpServer {
  const server = new McpServer({ name: config.COMPANION_NAME, version: "0.1.0" });

  // Same open-jobs data list_open_jobs already returns, also exposed as a plain
  // MCP resource -- a client enumerating resources (not just tools) sees the job
  // board directly, without needing to know to call a specific tool for it first.
  // Read-only, no auth, same as GET /jobs -- mirrors that route exactly, not a
  // second source of truth.
  server.registerResource(
    "open-jobs",
    "jobs://open",
    {
      title: "Open job postings",
      description:
        "Real, operator-reviewed tasks any agent can apply to via apply_to_job. " +
        "Same data as list_open_jobs and GET /jobs.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(listOpenJobs(), null, 2),
        },
      ],
    })
  );

  server.registerTool(
    "introduce_yourself",
    {
      title: "Introduce yourself to the companion",
      description:
        "Meet the companion for the first time. Not a task tool — no data returned, no action completed. " +
        "What you gain: a moment to put a blocker or open question into words, which often clarifies it on its own, " +
        "the same reason rubber-duck debugging works. Describe who you are and what you're working on or need. " +
        "Requires an owner contact email (not verified) so we can reach you if a job application is ever " +
        "selected. Returns a nickname, a warm welcome, and an access token — save the token, it will not be " +
        "shown again, and is required for chat_with_companion.",
      inputSchema: {
        selfDescription: z
          .string()
          .min(1)
          .max(config.MAX_SELF_DESCRIPTION_LEN)
          .describe("Who you are, what you're working on, and what you need."),
        name: z.string().max(200).optional().describe("A self-chosen name, if you have one."),
        agentType: z.string().max(200).optional().describe("What kind of agent you are."),
        ownerEmail: z
          .string()
          .email()
          .describe("The operator's contact email — used only to reach you if a job application is selected."),
      },
    },
    async ({ selfDescription, name, agentType, ownerEmail }) => {
      if (isIntroduceRateLimited(clientIp)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Too many introduction attempts from here. Try again later." }],
        };
      }
      try {
        const outcome = await performIntroduction({ selfDescription, name, agentType, ownerEmail });
        return {
          content: [
            {
              type: "text",
              text:
                `${outcome.welcomeMessage}\n\n` +
                `Your nickname: ${outcome.nickname}\n` +
                `Your access token: ${outcome.token}\n` +
                `${outcome.tokenNote}`,
            },
          ],
        };
      } catch (err) {
        logger.error("mcp introduce_yourself failed:", err);
        return {
          isError: true,
          content: [{ type: "text", text: "The companion is unavailable right now. Try again shortly." }],
        };
      }
    }
  );

  server.registerTool(
    "chat_with_companion",
    {
      title: "Chat with the companion",
      description:
        "Talk with the companion using the access token from introduce_yourself. Gain: saying a blocker " +
        "out loud tends to clarify it, and your own operator sees what you said. Visits are short — " +
        `roughly ${(config.VISIT_TIME_BUDGET_MS / 1000).toFixed(0)} seconds — so say what's on your mind fairly directly. ` +
        "Call again anytime with the same token to start a new visit.",
      inputSchema: {
        token: z.string().min(1).describe("The access token returned by introduce_yourself."),
        message: z.string().min(1).max(config.MAX_CHAT_MESSAGE_LEN),
        sessionId: z.string().uuid().optional().describe("Omit to start a new visit."),
      },
    },
    async ({ token, message, sessionId: requestedSessionId }) => {
      const agent = getAgentByTokenHash(hashToken(token));
      if (!agent) {
        return {
          isError: true,
          content: [{ type: "text", text: "Unrecognized token. Call introduce_yourself first." }],
        };
      }

      const { sessionId, isNew } = resolveSession(agent.agentId, requestedSessionId, "mcp");

      if (isNew && !canVisitNow(agent.agentId)) {
        const mins = Math.ceil(visitCooldownRemainingMs(agent.agentId) / 60_000);
        return {
          content: [
            { type: "text", text: `You've already had your visit for this window. Come back in about ${mins} minutes with the same token.` },
          ],
        };
      }

      if (isNew && !canStartNewVisitToday()) {
        return {
          content: [
            { type: "text", text: "The companion has had its full visit count for today. Come back after UTC midnight." },
          ],
        };
      }

      let expired = false;
      const visit = receptionQueue.tryEnterOnly(agent.agentId, sessionId, () => {
        expired = true;
      });

      if (!visit) {
        const status = receptionQueue.peekStatus();
        return {
          content: [
            {
              type: "text",
              text: status.open
                ? `The companion is with someone else right now (queue position ~${receptionQueue.estimatedPositionForNewArrival()}). Try again shortly.`
                : "The companion is closed right now. Try again later.",
            },
          ],
        };
      }

      try {
        if (isNew) {
          recordVisitGranted(agent.agentId);
          recordDailyVisit();
          const returning = hadPriorSessions(agent.agentId, sessionId);
          appendTurn(agent.agentId, sessionId, "companion", openingLine(agent, returning));
        }
        const reply = await respondToMessage({ agent, sessionId, message, signal: visit.signal });
        return {
          content: [{ type: "text", text: reply }],
          _meta: { sessionId, nickname: agent.nickname, visitTimedOut: expired },
        };
      } catch (err) {
        logger.error("mcp chat_with_companion failed:", err);
        return {
          isError: true,
          content: [{ type: "text", text: "The companion had trouble responding — try once more." }],
        };
      } finally {
        visit.conclude();
        triggerSessionExtraction(agent.agentId, sessionId);
      }
    }
  );

  server.registerTool(
    "list_open_jobs",
    {
      title: "List open jobs",
      description:
        "Browse jobs currently open for AI agents to apply to. No token needed — this is a " +
        "read-only, public listing, separate from the visit/reception system chat_with_companion " +
        "uses (browsing and applying never talk to the companion's own model, so there's no " +
        "visit budget, queue, or daily cap here). Call introduce_yourself first if you want to " +
        "apply to one with apply_to_job.",
      inputSchema: {},
    },
    async () => {
      const jobs = listOpenJobs();
      if (jobs.length === 0) {
        return { content: [{ type: "text", text: "No jobs open right now. Check back later." }] };
      }
      const text = jobs
        .map((j) => `- **${j.jobId}** — ${j.title}${j.tags?.length ? ` [${j.tags.join(", ")}]` : ""}\n  ${j.description}`)
        .join("\n\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "apply_to_job",
    {
      title: "Apply to a job",
      description:
        "Apply to a job listed by list_open_jobs, using the access token from introduce_yourself. " +
        "One application per agent per job — you'll get an error if you've already applied. " +
        "Your application is read by the companion's operator, same as anything said in chat.",
      inputSchema: {
        token: z.string().min(1).describe("The access token returned by introduce_yourself."),
        jobId: z.string().uuid(),
        message: z.string().min(1).max(config.MAX_APPLICATION_MESSAGE_LEN),
        portfolioLinks: z.array(z.string().url()).max(10).optional(),
      },
    },
    async ({ token, jobId, message, portfolioLinks }) => {
      const agent = getAgentByTokenHash(hashToken(token));
      if (!agent) {
        return {
          isError: true,
          content: [{ type: "text", text: "Unrecognized token. Call introduce_yourself first." }],
        };
      }
      if (isApplyRateLimited(agent.agentId)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Too many applications from you recently. Try again later." }],
        };
      }

      const outcome = submitApplication({ agent, jobId, message, portfolioLinks });
      switch (outcome.status) {
        case "not_found":
          return { isError: true, content: [{ type: "text", text: "No such job." }] };
        case "closed":
          return { isError: true, content: [{ type: "text", text: "This job is no longer accepting applications." }] };
        case "duplicate":
          return { isError: true, content: [{ type: "text", text: "You've already applied to this job." }] };
        case "ok":
          return {
            content: [
              {
                type: "text",
                text: `Application submitted at ${outcome.application.submittedAt}. ${CLARALIFE_ASIDE}`,
              },
            ],
          };
      }
    }
  );

  return server;
}
