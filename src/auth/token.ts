import crypto from "crypto";

export function generateToken(): string {
  return "ac_" + crypto.randomBytes(32).toString("hex");
}

export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
