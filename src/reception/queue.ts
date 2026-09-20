import { config } from "../config";
import { isOpen } from "./openState";

/**
 * The core mechanic of the whole product: exactly one agent is ever in
 * active conversation with the companion at a time. Everyone else waits in
 * a FIFO queue. Each active visit gets a hard budget (VISIT_TIME_BUDGET_MS, default ~20s) (derived
 * from 24h / 10,000 target visits/day) — when it expires, the visit is cut
 * off regardless of conversation state and the next queued arrival is
 * promoted. This is intentionally the sole throughput governor: no separate
 * numeric daily cap is enforced — whatever the queue + timer produce over a
 * day of continuous operation is the throughput.
 */

export interface VisitContext {
  agentId: string;
  sessionId: string;
  budgetMs: number;
  /**
   * Aborts at the hard visit-time budget regardless of progress — pass this
   * to the in-flight Claude call so a slow/runaway generation is actually
   * cancelled, not just abandoned to keep running in the background after
   * the visit officially ends. This is a resource-safety measure: without
   * it, a crafted message could keep consuming API tokens and a live
   * connection past its allotted time even though the queue has already
   * moved on to the next visitor.
   */
  signal: AbortSignal;
  /** Voluntarily end this visit early (natural conclusion, or connection closed) — also aborts. */
  conclude(): void;
}

interface Waiter {
  agentId: string;
  sessionId: string;
  onExpire: () => void;
  onPromoted: (visit: VisitContext) => void;
}

class ReceptionQueue {
  private current: { agentId: string; sessionId: string; timer: NodeJS.Timeout } | null = null;
  private waiting: Waiter[] = [];

  hasActiveVisit(): boolean {
    return this.current !== null;
  }

  queueLength(): number {
    return this.waiting.length;
  }

  isFull(): boolean {
    return this.waiting.length >= config.MAX_QUEUE_LENGTH;
  }

  /** Position a brand-new arrival would land at right now, for status messages. */
  estimatedPositionForNewArrival(): number {
    return (this.current ? 1 : 0) + this.waiting.length + 1;
  }

  private grant(agentId: string, sessionId: string, onExpire: () => void): VisitContext {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      this.current = null;
      controller.abort(); // cut off the in-flight Claude call regardless of progress
      onExpire();
      this.pulse();
    }, config.VISIT_TIME_BUDGET_MS);
    this.current = { agentId, sessionId, timer };
    return {
      agentId,
      sessionId,
      budgetMs: config.VISIT_TIME_BUDGET_MS,
      signal: controller.signal,
      conclude: () => {
        if (this.current?.sessionId !== sessionId) return; // already ended
        clearTimeout(timer);
        this.current = null;
        controller.abort();
        this.pulse();
      },
    };
  }

  /** Advance the queue if the companion is open, nobody's active, and someone's waiting. */
  private pulse(): void {
    if (!isOpen() || this.current) return;
    const next = this.waiting.shift();
    if (!next) return;
    const visit = this.grant(next.agentId, next.sessionId, next.onExpire);
    next.onPromoted(visit);
  }

  /** Call after the operator flips the companion open, to drain anyone queued while closed. */
  onOpened(): void {
    this.pulse();
  }

  /** Remove a still-waiting entry (e.g. its WebSocket disconnected before its turn). */
  cancelWaiting(sessionId: string): boolean {
    const idx = this.waiting.findIndex((w) => w.sessionId === sessionId);
    if (idx === -1) return false;
    this.waiting.splice(idx, 1);
    return true;
  }

  /**
   * WebSocket entry point: grants the floor immediately if free and open,
   * otherwise queues (even while closed — arrivals wait for the companion
   * to reopen rather than being turned away).
   */
  requestOrQueue(
    agentId: string,
    sessionId: string,
    onExpire: () => void,
    onPromoted: (visit: VisitContext) => void
  ): { status: "active"; visit: VisitContext } | { status: "queued"; position: number } | { status: "full" } {
    if (isOpen() && !this.current && this.waiting.length === 0) {
      return { status: "active", visit: this.grant(agentId, sessionId, onExpire) };
    }
    if (this.isFull()) {
      return { status: "full" };
    }
    this.waiting.push({ agentId, sessionId, onExpire, onPromoted });
    return { status: "queued", position: this.waiting.length };
  }

  /** Non-blocking snapshot for the stateless HTTP fallback — never enqueues. */
  peekStatus(): { active: boolean; queueLength: number; open: boolean } {
    return { active: this.current !== null, queueLength: this.waiting.length, open: isOpen() };
  }

  /**
   * Stateless-HTTP entry point: grants the floor only if immediately free.
   * Never enqueues — a POST /chat request can't hold a connection open to
   * wait its turn, so a busy/closed companion just returns null and the
   * caller reports a queue position for the agent to retry against.
   */
  tryEnterOnly(agentId: string, sessionId: string, onExpire: () => void): VisitContext | null {
    if (isOpen() && !this.current && this.waiting.length === 0) {
      return this.grant(agentId, sessionId, onExpire);
    }
    return null;
  }
}

export const receptionQueue = new ReceptionQueue();
