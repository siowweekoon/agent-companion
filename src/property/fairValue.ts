import { HdbRow, loadHdb, normalizeFlatType, normalizeTown, idxToMonth } from "./hdbData";

export interface FairValueInput {
  town: string;
  flatType: string;
  floorAreaSqm?: number;
  storey?: number; // a floor number, e.g. 12
  remainingLeaseYears?: number;
  /** For backtesting only: pretend "now" is this month index; only earlier months are used. */
  asOfMonthIdx?: number;
}

export interface Comparable {
  month: string; block: string; street: string; storey: number; areaSqm: number;
  remainingYears: number; price: number; similarity: number;
}

export interface FairValueResult {
  estimate: number;
  low: number; // 25th percentile of similarity-weighted comparables
  high: number; // 75th percentile
  comparablesUsed: number;
  windowMonths: number;
  dataThrough: string;
  topComparables: Comparable[];
  notes: string[];
}

export class FairValueError extends Error {}

function weightedQuantile(values: { v: number; w: number }[], q: number): number {
  const sorted = [...values].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, x) => s + x.w, 0);
  let cum = 0;
  for (const x of sorted) {
    cum += x.w;
    if (cum >= q * total) return x.v;
  }
  return sorted[sorted.length - 1].v;
}

const gauss = (diff: number, scale: number) => Math.exp(-((diff / scale) ** 2));

export function estimateFairValue(input: FairValueInput): FairValueResult {
  const { byKey, latestIdx } = loadHdb();
  const town = normalizeTown(input.town);
  const flatType = normalizeFlatType(input.flatType);
  const pool = byKey.get(`${town}|${flatType}`);
  if (!pool || pool.length === 0) {
    throw new FairValueError(`No transactions found for town "${town}" and flat type "${flatType}".`);
  }
  const asOf = input.asOfMonthIdx ?? latestIdx + 1; // "now" is the month after the latest data
  const notes: string[] = [];

  let windowMonths = 12;
  let comps: HdbRow[] = [];
  for (const w of [12, 24, 36]) {
    comps = pool.filter((r) => r.monthIdx < asOf && r.monthIdx >= asOf - w);
    windowMonths = w;
    if (comps.length >= 15) break;
  }
  if (comps.length < 5) {
    throw new FairValueError("Too few recent transactions for this town and flat type to estimate reliably.");
  }
  if (windowMonths > 12) notes.push(`Few recent sales; comparables widened to the last ${windowMonths} months.`);

  const scored = comps.map((r) => {
    const age = asOf - r.monthIdx;
    let w = Math.exp(-age / 6);
    if (input.storey !== undefined && Number.isFinite(r.storeyMid)) w *= gauss(r.storeyMid - input.storey, 6);
    if (input.remainingLeaseYears !== undefined) w *= gauss(r.remainingYears - input.remainingLeaseYears, 8);
    if (input.floorAreaSqm !== undefined) w *= gauss(r.areaSqm - input.floorAreaSqm, 10);
    // Scale by floor area when given, so a bigger/smaller flat of the same type is priced per sqm.
    const value = input.floorAreaSqm !== undefined ? (r.price / r.areaSqm) * input.floorAreaSqm : r.price;
    return { r, w: Math.max(w, 1e-6), value };
  });

  const vals = scored.map((s) => ({ v: s.value, w: s.w }));
  const top = [...scored].sort((a, b) => b.w - a.w).slice(0, 5).map((s) => ({
    month: s.r.month, block: s.r.block, street: s.r.street, storey: s.r.storeyMid,
    areaSqm: s.r.areaSqm, remainingYears: Math.round(s.r.remainingYears * 10) / 10,
    price: s.r.price, similarity: Math.round(s.w * 1000) / 1000,
  }));
  if (input.storey === undefined) notes.push("Storey not given: higher floors usually sell for more.");
  if (input.remainingLeaseYears === undefined) notes.push("Remaining lease not given: shorter leases usually sell for less.");
  notes.push("Statistical estimate from past registered transactions. Not a valuation, not financial advice.");

  return {
    estimate: Math.round(weightedQuantile(vals, 0.5) / 1000) * 1000,
    low: Math.round(weightedQuantile(vals, 0.25) / 1000) * 1000,
    high: Math.round(weightedQuantile(vals, 0.75) / 1000) * 1000,
    comparablesUsed: comps.length,
    windowMonths,
    dataThrough: idxToMonth(latestIdx),
    topComparables: top,
    notes,
  };
}
