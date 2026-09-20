import fs from "fs";
import { companionStatePath } from "../storage/paths";
import { config } from "../config";

interface CompanionState {
  open: boolean;
}

let state: CompanionState = { open: config.COMPANION_OPEN };

export function loadOpenState(): void {
  const p = companionStatePath();
  if (fs.existsSync(p)) {
    try {
      state = JSON.parse(fs.readFileSync(p, "utf8"));
      return;
    } catch {
      // fall through to default/env value
    }
  }
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

export function isOpen(): boolean {
  return state.open;
}

/** Operator control — flip via a small admin call, not exposed to agents. */
export function setOpen(open: boolean): void {
  state.open = open;
  fs.writeFileSync(companionStatePath(), JSON.stringify(state, null, 2));
}
