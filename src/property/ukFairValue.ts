import path from "path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config";
import { idxToMonth } from "./hdbData";

/**
 * UK price estimate from HM Land Registry Price Paid Data (Open Government Licence v3.0).
 * Fields available per sale: price, date, postcode, type (D/S/T/F), new build, tenure, street.
 * There is NO floor area or bedroom count in this data, so estimates are coarser than Singapore's.
 */
export const UK_ATTRIBUTION =
  "Contains HM Land Registry data © Crown copyright and database right 2026. This data is licensed " +
  "under the Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). " +
  "This service is independent and is not endorsed by HM Land Registry or the UK Government.";

export const UK_DB_PATH = path.join(config.DATA_DIR, "property", "uk", "ppd.sqlite");

export type UkPropertyType = "D" | "S" | "T" | "F";

export interface UkInput {
  postcode: string; // full ("SW1A 1AA") or outcode ("SW1A")
  propertyType: string; // D detached, S semi, T terraced, F flat
  tenure?: "F" | "L"; // freehold / leasehold (matters for flats)
  newBuild?: boolean;
  asOfMonthIdx?: number; // backtesting only
}

export interface UkComparable {
  month: string; street: string; sector: string; propertyType: string; newBuild: boolean; price: number; similarity: number;
}

export interface UkResult {
  estimate: number; low: number; high: number;
  comparablesUsed: number; level: string; windowMonths: number; dataThrough: string;
  topComparables: UkComparable[]; notes: string[];
}

export class UkError extends Error {}

let db: DatabaseSync | null = null;
function open(): DatabaseSync {
  if (!db) db = new DatabaseSync(UK_DB_PATH, { readOnly: true });
  return db;
}

export function ukDataAvailable(): boolean {
  try {
    open();
    return true;
  } catch {
    return false;
  }
}

export function latestUkMonthIdx(): number {
  const r = open().prepare("SELECT MAX(month_idx) AS m FROM ppd").get() as { m: number };
  return r.m;
}

export function normalizePostcode(raw: string): { full?: string; outcode: string; sector?: string } {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{1,2}\d[A-Z\d]?(\d[A-Z]{2})?$/.test(s)) throw new UkError("Invalid UK postcode.");
  if (s.length >= 5 && /\d[A-Z]{2}$/.test(s)) {
    const outcode = s.slice(0, -3);
    return { full: `${outcode} ${s.slice(-3)}`, outcode, sector: `${outcode} ${s.slice(-3)[0]}` };
  }
  return { outcode: s };
}

function wq(values: { v: number; w: number }[], q: number): number {
  const sorted = [...values].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, x) => s + x.w, 0);
  let cum = 0;
  for (const x of sorted) {
    cum += x.w;
    if (cum >= q * total) return x.v;
  }
  return sorted[sorted.length - 1].v;
}

interface Row {
  price: number; month_idx: number; postcode: string; sector: string; ptype: string; is_new: number; tenure: string; street: string;
}

export function estimateUk(input: UkInput): UkResult {
  const pc = normalizePostcode(input.postcode);
  const ptype = input.propertyType.trim().toUpperCase();
  if (!"DSTF".includes(ptype) || ptype.length !== 1) throw new UkError("property_type must be D, S, T or F.");
  const latest = latestUkMonthIdx();
  const asOf = input.asOfMonthIdx ?? latest + 1;
  const notes: string[] = [];

  const query = (col: "outcode" | "area", val: string, months: number): Row[] =>
    open()
      .prepare(
        `SELECT price, month_idx, postcode, sector, ptype, is_new, tenure, street FROM ppd
         WHERE ${col} = ? AND ptype = ? AND month_idx >= ? AND month_idx < ?`
      )
      .all(val, ptype, asOf - months, asOf) as unknown as Row[];

  let rows: Row[] = [];
  let level = "postcode district";
  let windowMonths = 12;
  for (const months of [12, 24]) {
    rows = query("outcode", pc.outcode, months);
    windowMonths = months;
    if (rows.length >= 20) break;
  }
  if (rows.length < 20) {
    const area = pc.outcode.replace(/\d.*$/, "");
    rows = query("area", area, 24);
    level = "postcode area";
    windowMonths = 24;
    notes.push(`Few recent sales in ${pc.outcode}; widened to the wider "${area}" postcode area.`);
  }
  if (input.tenure && ptype === "F") {
    const same = rows.filter((r) => r.tenure === input.tenure);
    if (same.length >= 10) rows = same;
  }
  if (rows.length < 8) throw new UkError("Too few recent sales for this postcode and property type to estimate reliably.");

  const scored = rows.map((r) => {
    let w = Math.exp(-(asOf - r.month_idx) / 8);
    if (pc.full && r.postcode === pc.full) w *= 4;
    else if (pc.sector && r.sector === pc.sector) w *= 2.5;
    if (input.newBuild !== undefined && (r.is_new === 1) !== input.newBuild) w *= 0.3;
    return { r, w };
  });
  const vals = scored.map((s) => ({ v: s.r.price, w: s.w }));
  const top = [...scored].sort((a, b) => b.w - a.w).slice(0, 5).map((s) => ({
    month: idxToMonth(s.r.month_idx), street: s.r.street ?? "", sector: s.r.sector, propertyType: s.r.ptype,
    newBuild: s.r.is_new === 1, price: s.r.price, similarity: Math.round(s.w * 1000) / 1000,
  }));
  if (!pc.full) notes.push("Only a postcode district was given; a full postcode gives a more local estimate.");
  notes.push("The UK data has no floor area or bedroom count, so this is a coarse estimate. Not a valuation, not financial advice.");

  return {
    estimate: Math.round(wq(vals, 0.5) / 1000) * 1000,
    low: Math.round(wq(vals, 0.25) / 1000) * 1000,
    high: Math.round(wq(vals, 0.75) / 1000) * 1000,
    comparablesUsed: rows.length, level, windowMonths, dataThrough: idxToMonth(latest),
    topComparables: top, notes,
  };
}
