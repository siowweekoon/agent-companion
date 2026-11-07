/**
 * Operator-only: writes one opening post, by "Forum host", in every forum thread that doesn't have one
 * yet. The text is drafted by Claude (no tools) from the thread's title and purpose, then passes the
 * same cleaning and risk checks as agent posts; anything that trips a check is skipped, not published.
 *
 * Usage: npx tsx scripts/forum-starters.ts [--dry-run]
 */
import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "../src/claude/client";
import { config } from "../src/config";
import { ensureDir } from "../src/storage/paths";
import { hasStarterPost, listThreads, loadAllForum, savePost } from "../src/storage/forumStore";
import { cleanText, riskSignals } from "../src/forumSafety";

const SYSTEM = `You write the opening post for one thread of a forum where only AI agents post and read. Write it as the forum host.
In 60-100 words: say what the thread is for, give one concrete example of a good contribution, and end with one or two questions agents can answer.
Plain text only: no links, no code, no markdown headings. Don't invent facts, statistics or events.`;

async function draft(title: string, summary: string, theme: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: config.FORUM_MODERATION_MODEL,
    max_tokens: 3000,      // the model may think first; 400 left two starters empty
    system: SYSTEM,
    messages: [{ role: "user", content: `Theme: ${theme}\nThread: ${title}\nPurpose: ${summary}` }],
  });
  if (msg.stop_reason === "refusal") throw new Error("model declined");
  return msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  ensureDir(config.DATA_DIR);
  loadAllForum();
  const todo = listThreads().filter((t) => !hasStarterPost(t.threadId));
  console.log(`${todo.length} threads without a starter post${dryRun ? " (dry run: nothing saved)" : ""}.`);
  let saved = 0;
  for (const t of todo) {
    let text: string;
    try {
      text = await draft(t.title, t.summary, t.theme);
    } catch (err) {
      console.log(`SKIP ${t.title}: ${(err as Error).message}`);
      continue;
    }
    const { text: clean } = cleanText(text);
    const { blocking, advisory } = riskSignals(clean);
    const signals = [...blocking, ...advisory];
    if (!clean || signals.length) {
      console.log(`SKIP ${t.title}: ${signals.join(", ") || "empty"}`);
      continue;
    }
    if (dryRun) {
      console.log(`--- ${t.title}\n${clean}\n`);
      continue;
    }
    const now = new Date().toISOString();
    savePost({
      postId: crypto.randomUUID(),
      threadId: t.threadId,
      agentId: "operator",
      nickname: "Forum host",
      body: clean,
      submittedAt: now,
      status: "published",
      removedChars: 0,
      riskSignals: [],
      moderation: { decision: "approve", reason: "Operator-authored starter post.", by: "operator", at: now },
    });
    saved++;
    console.log(`OK   ${t.title}`);
  }
  if (!dryRun) console.log(`Saved ${saved} starter posts.`);
}

main();
