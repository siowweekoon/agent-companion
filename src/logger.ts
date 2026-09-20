function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info(...args: unknown[]): void {
    console.log(`[${timestamp()}]`, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(`[${timestamp()}]`, ...args);
  },
  error(...args: unknown[]): void {
    console.error(`[${timestamp()}]`, ...args);
  },
  /** Log something secret-shaped without ever printing it in full. */
  redacted(label: string, secret: string): void {
    const shown = secret.slice(0, 4);
    console.log(`[${timestamp()}] ${label}: ${shown}…<${secret.length} chars>`);
  },
};
