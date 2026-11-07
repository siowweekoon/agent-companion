import { loadHdb, idxToMonth } from "../src/property/hdbData";
import { estimateFairValue } from "../src/property/fairValue";

// Backtest: for each sampled sale in 3 recent FULL months, estimate it using only months
// strictly BEFORE that sale's month (no leakage), then compare with the real price.
const { rows, byKey, latestIdx } = loadHdb();
const testFrom = latestIdx - 5;
const testTo = latestIdx - 3; // skip the latest partial month(s)
const pool = rows.filter((r) => r.monthIdx >= testFrom && r.monthIdx <= testTo);
let seed = 42;
const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const sample = [...pool].sort(() => rand() - 0.5).slice(0, 800);

const apeModel: number[] = [];
const apeBase: number[] = [];
let inRange = 0;
let skipped = 0;
for (const r of sample) {
  const asOf = r.monthIdx;
  try {
    const est = estimateFairValue({
      town: r.town, flatType: r.flatType, floorAreaSqm: r.areaSqm, storey: r.storeyMid,
      remainingLeaseYears: r.remainingYears, asOfMonthIdx: asOf,
    });
    apeModel.push(Math.abs(est.estimate - r.price) / r.price);
    if (r.price >= est.low && r.price <= est.high) inRange++;
    const base = (byKey.get(`${r.town}|${r.flatType}`) ?? [])
      .filter((x) => x.monthIdx < asOf && x.monthIdx >= asOf - 12)
      .map((x) => x.price)
      .sort((a, b) => a - b);
    if (base.length) apeBase.push(Math.abs(base[Math.floor(base.length / 2)] - r.price) / r.price);
  } catch {
    skipped++;
  }
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const within = (a: number[], t: number) => a.filter((x) => x <= t).length / a.length;
const pct = (x: number) => (x * 100).toFixed(1) + "%";
console.log(`Test months: ${idxToMonth(testFrom)}..${idxToMonth(testTo)}  n=${apeModel.length} skipped=${skipped}`);
console.log(`MODEL    median APE ${pct(med(apeModel))}  mean ${pct(mean(apeModel))}  within10% ${pct(within(apeModel, 0.1))}  within5% ${pct(within(apeModel, 0.05))}`);
console.log(`BASELINE median APE ${pct(med(apeBase))}  mean ${pct(mean(apeBase))}  within10% ${pct(within(apeBase, 0.1))}  within5% ${pct(within(apeBase, 0.05))}  (same town+type, 12-mo median)`);
console.log(`25-75% range coverage: ${pct(inRange / apeModel.length)} (ideal ~50%)`);
