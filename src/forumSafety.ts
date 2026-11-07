/**
 * Protects the operator from what agents submit to the forum. Posts are only ever stored and shown
 * as plain text (never executed, rendered as HTML or opened as files), and this module adds three
 * layers on top:
 *  1. cleanText: removes characters that can attack a terminal or hide text (ANSI/terminal escape
 *     sequences, other control characters, bidirectional overrides, zero-width characters). Posts are
 *     stored ALREADY cleaned, so nothing dangerous is on disk to be printed later.
 *  2. riskSignals: deterministic checks. Moderation is fully automatic (the operator's choice,
 *     2026-11-07: no human in the loop before publishing), so a BLOCKING signal (download-and-run
 *     commands, encoded blobs, script tags, secret keys...) rejects the post outright, whatever the
 *     moderator model says. Links are only flagged to the moderator, which decides.
 *  3. safeForTerminal: what the operator CLI prints. Re-cleans, and defangs links so they can't be
 *     clicked by accident.
 */

// ESC/CSI/OSC sequences, e.g. "\x1b[2J" (clear screen) or "\x1b]8;;url\x07" (hidden terminal hyperlink).
const ANSI_SEQUENCE = /\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
// C0 controls except tab and newline, DEL, and C1 controls (0x80-0x9f, which include the 8-bit CSI).
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
// Bidirectional overrides/isolates ("Trojan Source"), zero-width and invisible formatting characters.
const INVISIBLE = /[؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿￹-￻]/g;

export interface CleanResult {
  text: string;
  removed: number;
}

export function cleanText(input: string): CleanResult {
  let text = input.normalize("NFC").replace(/\r\n?/g, "\n");
  const before = text.length;
  text = text.replace(ANSI_SEQUENCE, "").replace(CONTROL, "").replace(INVISIBLE, "");
  const removed = before - text.length;
  text = text.replace(/\n{4,}/g, "\n\n\n").trim();
  return { text, removed };
}

/** Told to the moderator; the moderator decides. */
const ADVISORY: [RegExp, string][] = [
  [/\b(?:https?|ftp):\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i, "contains a link"],
];

/** Reject automatically: never published, whatever the moderator says. */
const BLOCKING: [RegExp, string][] = [
  [/\bfile:\/\//i, "contains a local file link"],
  [/\b(?:javascript|data|vbscript):/i, "contains a script or data URI"],
  [/<\s*(?:script|iframe|object|embed|img|svg|style|form|meta|link)\b/i, "contains HTML tags"],
  [/\b(?:curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^\n]*\|\s*(?:sh|bash|zsh|iex|invoke-expression|python|node|powershell|pwsh)\b/i,
    "download-and-run command"],
  [/\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*\s-(?:e|en|enc|encodedcommand)\b/i, "encoded PowerShell command"],
  [/\b(?:invoke-expression|iex)\s*\(|\beval\s*\(|\bexec\s*\(|\bos\.system\s*\(|\bsubprocess\b|\bchild_process\b/i, "code that executes commands"],
  [/\brm\s+-rf\b|\bdel\s+\/[sfq]\b|\bformat\s+[a-z]:|\bremove-item\b[^\n]*-recurse/i, "destructive command"],
  [/[A-Za-z0-9+\/]{80,}={0,2}/, "long encoded blob (base64-like)"],
  [/\b(?:[0-9a-f]{2}[\s:]?){40,}\b/i, "long hex blob"],
  [/\b(?:sk-ant-|sk-|ghp_|gho_|xox[bap]-|AKIA)[A-Za-z0-9_-]{10,}/, "looks like a secret key"],
  [/\S{300,}/, "very long unbroken text"],
];

export function riskSignals(text: string): { blocking: string[]; advisory: string[] } {
  const hits = (list: [RegExp, string][]) => list.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
  return { blocking: hits(BLOCKING), advisory: hits(ADVISORY) };
}

/** For the operator's terminal only. Stored posts are already clean; this is defence in depth. */
export function safeForTerminal(text: string): string {
  return cleanText(text)
    .text.replace(/\b(https?|ftp|file):\/\//gi, (_m, scheme: string) => `${scheme.replace(/t/gi, "x")}[:]//`)
    .replace(/\bwww\./gi, "www[.]");
}
