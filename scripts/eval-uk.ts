import { DatabaseSync } from "node:sqlite";
import { UK_DB_PATH, estimateUk, latestUkMonthIdx } from "../src/property/ukFairValue";
import { idxToMonth } from "../src/property/hdbData";

// Backtest: sample real sales from 3 recent FULL months; estimate each using only months strictly
// before that sale's month (no leakage); compare with the actual price and a baseline
// (plain median of the same postcode district + property type over the previous 12 months).
const db = new DatabaseSync(UK_DB_PATH, { readOnly: true });
const latest = latestUkMonthIdx();
const from = latest - 5;
const to = latest - 3;
const pool = db
  .prepare("SELECT price, month_idx, postcode, outcode, ptype, is_new, tenure FROM ppd WHERE month_idx BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 1500")
  .all(from, to) as unknown as { price: number; month_idx: number; postcode: string; outcode: string; ptype: string; is_new: number; tenure: string }[];

const apeModel: number[] = [];
const apeBase: number[] = [];
let inRange = 0;
let skipped = 0;
const baseStmt = db.prepare("SELECT price FROM ppd WHERE outcode = ? AND ptype = ? AND month_idx >= ? AND month_idx < ? ORDER BY price");
for (const r of pool) {
  try {
    const est = estimateUk({
      postcode: r.postcode, propertyType: r.ptype, tenure: r.ptype === "F" ? (r.tenure as "F" | "L") : undefined,
      newBuild: r.is_new === 1, asOfMonthIdx: r.month_idx,
    });
    apeModel.push(Math.abs(est.estimate - r.price) / r.price);
    if (r.price >= est.low && r.price <= est.high) inRange++;
    const base = (baseStmt.all(r.outcode, r.ptype, r.month_idx - 12, r.month_idx) as { price: number }[]).map((x) => x.price);
    if (base.length) apeBase.push(Math.abs(base[Math.floor(base.length / 2)] - r.price) / r.price);
  } catch {
    skipped++;
  }
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const within = (a: number[], t: number) => a.filter((x) => x <= t).length / a.length;
const pct = (x: number) => (x * 100).toFixed(1) + "%";
console.log(`Test months: ${idxToMonth(from)}..${idxToMonth(to)} (latest data ${idxToMonth(latest)})  n=${apeModel.length} skipped=${skipped}`);
console.log(`MODEL    median APE ${pct(med(apeModel))}  mean ${pct(mean(apeModel))}  within10% ${pct(within(apeModel, 0.1))}  within20% ${pct(within(apeModel, 0.2))}`);
console.log(`BASELINE median APE ${pct(med(apeBase))}  mean ${pct(mean(apeBase))}  within10% ${pct(within(apeBase, 0.1))}  within20% ${pct(within(apeBase, 0.2))}  (same district+type, 12-mo median)`);
console.log(`25-75% range coverage: ${pct(inRange / apeModel.length)} (ideal ~50%)`);
