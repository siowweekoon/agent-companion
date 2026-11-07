import fs from "fs";
import path from "path";
import { config } from "../config";

/**
 * Official HDB resale transactions, from data.gov.sg ("Resale flat prices based on registration
 * date from Jan-2017 onwards"), published under the Singapore Open Data Licence v1.0.
 * Licence: https://data.gov.sg/open-data-licence  -- attribution + no implied endorsement.
 */
export interface HdbRow {
  monthIdx: number; // year*12 + (month-1), for cheap month arithmetic
  month: string; // "YYYY-MM"
  town: string;
  flatType: string;
  block: string;
  street: string;
  storeyMid: number;
  areaSqm: number;
  model: string;
  remainingYears: number;
  price: number;
}

export const HDB_CSV_PATH = path.join(config.DATA_DIR, "property", "hdb_resale.csv");

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function monthToIdx(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
}

export function idxToMonth(idx: number): string {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function parseRemainingYears(text: string, leaseStart: number, monthIdx: number): number {
  const m = /(\d+)\s*years?(?:\s*(\d+)\s*months?)?/i.exec(text ?? "");
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
  // Older rows can lack the remaining_lease text: 99-year lease from lease_commence_date.
  return leaseStart + 99 - monthIdx / 12;
}

export function normalizeFlatType(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
  const digit = /^(\d)\s*(?:ROOMS?|RMS?|R)?$/.exec(s);
  if (digit) return `${digit[1]} ROOM`;
  if (s.startsWith("EXEC")) return "EXECUTIVE";
  if (s.startsWith("MULTI")) return "MULTI-GENERATION";
  return s;
}

export function normalizeTown(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

let cache: { rows: HdbRow[]; byKey: Map<string, HdbRow[]>; latestIdx: number } | null = null;

export function loadHdb(csvPath = HDB_CSV_PATH) {
  if (cache) return cache;
  const text = fs.readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/);
  const header = splitCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const idx = {
    month: col("month"), town: col("town"), flat_type: col("flat_type"), block: col("block"),
    street: col("street_name"), storey: col("storey_range"), area: col("floor_area_sqm"),
    model: col("flat_model"), lease: col("lease_commence_date"),
    remaining: col("remaining_lease"), price: col("resale_price"),
  };
  const rows: HdbRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = splitCsvLine(lines[i]);
    const price = Number(f[idx.price]);
    const area = Number(f[idx.area]);
    if (!Number.isFinite(price) || !Number.isFinite(area) || price <= 0 || area <= 0) continue;
    const monthIdx = monthToIdx(f[idx.month]);
    const storey = /(\d+)\s*TO\s*(\d+)/i.exec(f[idx.storey] ?? "");
    const leaseStart = Number(f[idx.lease]);
    rows.push({
      monthIdx,
      month: f[idx.month],
      town: f[idx.town].toUpperCase(),
      flatType: normalizeFlatType(f[idx.flat_type]),
      block: f[idx.block],
      street: f[idx.street],
      storeyMid: storey ? (Number(storey[1]) + Number(storey[2])) / 2 : NaN,
      areaSqm: area,
      model: f[idx.model],
      remainingYears: parseRemainingYears(f[idx.remaining], leaseStart, monthIdx),
      price,
    });
  }
  const byKey = new Map<string, HdbRow[]>();
  let latestIdx = 0;
  for (const r of rows) {
    const k = `${r.town}|${r.flatType}`;
    let arr = byKey.get(k);
    if (!arr) byKey.set(k, (arr = []));
    arr.push(r);
    if (r.monthIdx > latestIdx) latestIdx = r.monthIdx;
  }
  cache = { rows, byKey, latestIdx };
  return cache;
}

export function listTowns(): string[] {
  return [...new Set(loadHdb().rows.map((r) => r.town))].sort();
}
