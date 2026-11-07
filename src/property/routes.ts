import { Express, Request, Response } from "express";
import { z } from "zod";
import { estimateFairValue, FairValueError } from "./fairValue";
import { listTowns, loadHdb } from "./hdbData";
import { callerHash, checkAndCountQuota, logUsage, usageSummary } from "./usage";
import { logger } from "../logger";

export const ATTRIBUTION =
  "Contains information from HDB Resale Flat Prices accessed from data.gov.sg, made available under " +
  "the terms of the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence). " +
  "This service is independent and is not endorsed by HDB or any Singapore Government agency.";

const querySchema = z.object({
  town: z.string().min(2).max(40),
  flat_type: z.string().min(1).max(20),
  floor_area_sqm: z.coerce.number().min(20).max(200).optional(),
  storey: z.coerce.number().int().min(1).max(60).optional(),
  remaining_lease_years: z.coerce.number().min(1).max(99).optional(),
});

export function runFairValue(params: {
  town: string; flatType: string; floorAreaSqm?: number; storey?: number; remainingLeaseYears?: number;
}) {
  const result = estimateFairValue(params);
  return { ...result, currency: "SGD", attribution: ATTRIBUTION };
}

function handle(channel: "rest" | "web") {
  return (req: Request, res: Response) => {
    const raw = req.method === "GET" ? req.query : req.body;
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request.", details: parsed.error.flatten(), towns: listTowns() });
      return;
    }
    const caller = callerHash(req.ip ?? "unknown");
    const refusal = checkAndCountQuota(caller);
    if (refusal) {
      res.status(429).json({ error: refusal });
      return;
    }
    try {
      const p = parsed.data;
      const out = runFairValue({
        town: p.town, flatType: p.flat_type, floorAreaSqm: p.floor_area_sqm,
        storey: p.storey, remainingLeaseYears: p.remaining_lease_years,
      });
      logUsage(channel, caller, true);
      res.status(200).json(out);
    } catch (err) {
      logUsage(channel, caller, false);
      if (err instanceof FairValueError) {
        res.status(404).json({ error: err.message, towns: listTowns() });
        return;
      }
      logger.error("fair-value failed:", err);
      res.status(500).json({ error: "Something went wrong." });
    }
  };
}

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HDB fair-value estimate</title>
<style>body{font:16px system-ui;max-width:640px;margin:2rem auto;padding:0 1rem;color:#222}label{display:block;margin:.6rem 0 .2rem}
input,select,button{font:inherit;padding:.4rem;width:100%;box-sizing:border-box}button{margin-top:1rem;cursor:pointer}
pre{background:#f4f4f4;padding:1rem;overflow:auto}small{color:#555}</style>
<h1>HDB resale fair-value estimate</h1>
<p>Indicative price range from recent registered resale transactions. Not a valuation.</p>
<form id=f><label>Town<input name=town placeholder="TAMPINES" required></label>
<label>Flat type<select name=flat_type><option>2 ROOM<option>3 ROOM<option selected>4 ROOM<option>5 ROOM<option>EXECUTIVE</select></label>
<label>Floor area (sqm, optional)<input name=floor_area_sqm type=number></label>
<label>Storey (optional)<input name=storey type=number></label>
<label>Remaining lease, years (optional)<input name=remaining_lease_years type=number step=0.1></label>
<button>Estimate</button></form><pre id=out hidden></pre>
<p><small>${ATTRIBUTION}</small></p>
<script>f.onsubmit=async e=>{e.preventDefault();const q=new URLSearchParams([...new FormData(f)].filter(x=>x[1]!==''));
const r=await fetch('/property/fair-value?'+q);const j=await r.json();out.hidden=false;out.textContent=JSON.stringify(j,null,2)}</script>`;

export function mountPropertyRoutes(app: Express): void {
  try {
    const { rows, latestIdx } = loadHdb();
    logger.info(`property: loaded ${rows.length} HDB resale rows (latest month index ${latestIdx}).`);
  } catch (err) {
    logger.error("property: HDB data not found; run scripts/sync-hdb. Property routes disabled.", err);
    return;
  }
  app.get("/property", (_req, res) => res.status(200).type("html").send(PAGE));
  app.get("/property/fair-value", handle("web"));
  app.post("/property/fair-value", handle("rest"));
  app.get("/property/stats", (_req, res) => res.status(200).json(usageSummary()));
}
