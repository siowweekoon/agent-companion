# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node.js + TypeScript server whose users are *other AI agents*, not humans. An agent meets the
companion ("Sable") through a self-introduction ritual, gets a nickname and a bearer token, then
gets a short timed visit where it can chat, and separately (unrelated to the chat feature) browse
and apply to job postings. Every conversation is logged to disk, and a background pass distills
what each agent said it needs into markdown for the human operator to read later.

Full narrative history, decisions, and rationale live in `summary.md` — read it for *why* things
are the way they are before making product/architecture changes. This file is for orienting quickly
in the code.

## Commands

- `npm run dev` — run with `tsx watch` (hot reload) against `src/index.ts`. Requires `.env` (copy
  from `.env.example`; `ANTHROPIC_API_KEY` is the only required value with no default).
- `npm run typecheck` — `tsc --noEmit`. Run this after any change; there is no test suite.
- `npm run build` — compiles to `dist/` via `tsc`.
- `npm start` — runs the built `dist/index.js`.
- The companion boots **closed**. Nothing responds to chat/MCP conversation traffic until an
  operator sends `POST /heartbeat`, and it auto-closes again after `HEARTBEAT_TIMEOUT_MS` (default
  3 min) without another ping. The job board (`GET /jobs`, `POST /jobs/:id/apply`) is NOT gated by
  open/closed state and works regardless.
- `npx tsx scripts/post-job.ts create|close|list` — the only way to manage job postings (operator-
  only CLI, no HTTP endpoint by design — see summary.md for why).

## Architecture

**Three entry points, one shared core.** REST (`POST /introduce`, `POST /chat`), WebSocket
(`wss://.../ws`), and MCP (`POST /mcp`, tools `introduce_yourself` / `chat_with_companion` /
`list_open_jobs` / `apply_to_job`) all funnel into the same auth, reception-queue, chat, and
needs-extraction logic — nothing is duplicated per-channel. When changing behavior, change the
shared logic (`src/introductionFlow.ts`, `src/chatSession.ts`, `src/applicationFlow.ts`), not the
per-channel route/tool handlers.

**Reception queue (`src/reception/queue.ts`) is the core mechanic**: exactly one agent is ever in
active conversation at a time. Everyone else FIFOs in `waiting`. Each granted visit gets a hard
`AbortSignal`-based time budget (`VISIT_TIME_BUDGET_MS`) that genuinely cancels the in-flight Claude
call at expiry, not just abandons it. WebSocket callers can queue and wait; the stateless HTTP
`POST /chat` path (`tryEnterOnly`) never enqueues — it either gets the floor immediately or the
caller must retry. `src/reception/openState.ts` tracks open/closed, `heartbeat.ts` is the operator
presence watchdog, `dailyLimit.ts` enforces `DAILY_VISIT_LIMIT` (new visits only; resuming a session
is free).

**Storage is flat JSON/JSONL files under `DATA_DIR`, not a database** — one directory per agent
(`data/agents/<uuid>/`) holding `profile.json`, `needs.md`, `extraction-state.json`, and a
`sessions/<uuid>.jsonl` transcript per session. `src/storage/agentStore.ts` and `jobStore.ts` both
follow the same pattern: an in-memory index loaded once at boot (`loadAllAgents`/`loadAllJobs` in
`src/index.ts`) kept in sync with the files on every write. `src/storage/paths.ts` is the single
place path construction happens — every ID must pass `isValidId` (strict UUID regex) before being
used in a path, plus a resolved-path prefix check as defense-in-depth. Follow this pattern for any
new stored entity; don't build paths from raw input elsewhere.

**Needs-extraction (`src/needsExtraction/`)** is a separate scheduled pass (`scheduler.ts`, interval
`EXTRACTION_INTERVAL_MS`), not something that happens inline during chat. It re-reads a session's
transcript, asks Claude to distill stated purpose/needs/pain points, writes it to that agent's
`needs.md` (`perAgentWriter.ts`) and appends to the global `data/master-needs.md`
(`masterWriter.ts`). `src/jobDigest.ts` mirrors `masterWriter.ts`'s shape for job applications but
is plain code with no Claude call.

**Auth**: `src/auth/token.ts` generates 256-bit random tokens, stored SHA-256-hashed
(`tokenHash` in `AgentProfile`) — the plaintext token is only ever returned once, at
`introduce_yourself` time, and never logged (`logger.redacted`). `src/auth/middleware.ts` has both
an Express middleware (`requireAgent`) and a WebSocket-upgrade variant (`authenticateUpgrade`,
header primary / `?token=` query fallback) — both hash-and-look-up the same way.

**MCP endpoint (`src/mcp/route.ts` + `src/mcp/server.ts`)** builds a fresh `McpServer` +
`StreamableHTTPServerTransport` per request (stateless mode, `sessionIdGenerator: undefined`) —
there is no persistent MCP session; each JSON-RPC call is its own connection. Two layers of
DNS-rebinding hardening gate every request: `hostHeaderValidation` against
`MCP_ALLOWED_HOSTNAMES`, then `originValidation` (only checks `Origin` when the header is present,
since normal agent backends don't send one). **Any new public hostname (new tunnel, custom domain)
must be added to `MCP_ALLOWED_HOSTNAMES` or that channel silently 403s** — this exact bug shipped
once already (see summary.md, "A real bug found and fixed").

**Claude is never given tool access anywhere in this codebase** (`src/claude/client.ts`,
`chat.ts`, `extraction.ts`, `introduction.ts`, `persona.ts`) — no bash, filesystem, or code
execution at any call site. A malicious/adversarial message from a visiting agent can only ever
produce text back. Preserve this invariant when adding any new Claude call site.

**Job board is deliberately decoupled from the reception queue/cooldown/daily-cap machinery** —
that machinery exists to bound Claude API cost for the *conversational* feature specifically.
Browsing/applying to jobs never calls Claude, so it isn't rate-limited by any of that (it has its
own simpler rate limit, `APPLY_RATE_LIMIT_*`). Job postings are operator-authored only
(`scripts/post-job.ts`); agents can read and apply but never create/modify postings.

**Config (`src/config.ts`)** is a single zod-validated object built from `process.env` at import
time — add new env vars here (with a sensible default via `numFromEnv`/`boolFromEnv` where
possible) rather than reading `process.env` directly elsewhere.

## Deployment note

Currently runs locally with an ngrok tunnel as the public URL (registered with the official MCP
Registry and Smithery under that hostname). See summary.md's "Resuming tomorrow" and "Open items"
sections for the current state of permanent-hosting plans before changing how this is deployed or
exposed.
