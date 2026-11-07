import { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { config } from "../config";
import { logger } from "../logger";
import { createPaywall, x402Enabled } from "../paid/x402";
import { estimateFairValue, FairValueError } from "./fairValue";
import { listTowns } from "./hdbData";
import { ATTRIBUTION } from "./routes";
import { callerHash, logUsage } from "./usage";

/**
 * Paid HDB fair-value: GET /property/paid/fair-value (x402, USDC).
 *
 * The estimate is computed and the request fully validated BEFORE the paywall runs, so an agent
 * is only ever asked to pay for a request that will succeed. Because x402 settles only for
 * status < 400, a bad town / bad parameter is never charged. The handler after the paywall just
 * returns the already-computed result.
 */
const PATH = "/property/paid/fair-value";

const querySchema = z.object({
  town: z.string().min(2).max(40),
  flat_type: z.string().min(1).max(20),
  floor_area_sqm: z.coerce.number().min(20).max(200).optional(),
  storey: z.coerce.number().int().min(1).max(60).optional(),
  remaining_lease_years: z.coerce.number().min(1).max(99).optional(),
});

function precompute(req: Request, res: Response, next: NextFunction) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request. You were not charged.", details: parsed.error.flatten(), towns: listTowns() });
    return;
  }
  try {
    const p = parsed.data;
    res.locals.fairValue = {
      ...estimateFairValue({
        town: p.town, flatType: p.flat_type, floorAreaSqm: p.floor_area_sqm,
        storey: p.storey, remainingLeaseYears: p.remaining_lease_years,
      }),
      currency: "SGD",
      attribution: ATTRIBUTION,
    };
    next();
  } catch (err) {
    if (err instanceof FairValueError) {
      res.status(404).json({ error: `${err.message} You were not charged.`, towns: listTowns() });
      return;
    }
    logger.error("paid fair-value precompute failed:", err);
    res.status(500).json({ error: "Something went wrong. You were not charged." });
  }
}

export function mountPaidPropertyRoutes(app: Express): void {
  if (!x402Enabled()) {
    logger.info("paid property route disabled (X402_PAY_TO not set to a valid 0x address).");
    return;
  }

  const paywall = createPaywall({
    [`GET ${PATH}`]: {
      price: config.X402_PROPERTY_PRICE,
      description:
        "Indicative price range (SGD) for a Singapore HDB resale flat from recent registered sales: " +
        "estimate, 25th-75th percentile range, closest comparable sales. Backtest median error ~5% vs ~9% " +
        "for a plain town-average. Not a valuation.",
      extensions: {
        ...declareDiscoveryExtension({
          input: { town: "TAMPINES", flat_type: "4 ROOM", floor_area_sqm: 93, storey: 10, remaining_lease_years: 70 },
          inputSchema: {
            properties: {
              town: { type: "string", description: 'HDB town, e.g. "TAMPINES", "BISHAN", "ANG MO KIO"' },
              flat_type: { type: "string", description: 'e.g. "4 ROOM", "5 ROOM", "EXECUTIVE"' },
              floor_area_sqm: { type: "number", description: "Floor area in square metres (optional)" },
              storey: { type: "integer", description: "Floor number (optional)" },
              remaining_lease_years: { type: "number", description: "Remaining lease in years (optional)" },
            },
            required: ["town", "flat_type"],
          },
          output: {
            example: {
              estimate: 605000, low: 580000, high: 623000, comparablesUsed: 852, windowMonths: 12,
              dataThrough: "2026-10", currency: "SGD",
            },
          },
        }),
      },
    },
  });

  app.get(`${PATH}/info`, (_req, res) => {
    res.status(200).json({
      endpoint: `GET ${PATH}`,
      price: config.X402_PROPERTY_PRICE,
      network: config.X402_NETWORK,
      protocol: "x402",
      params: "town, flat_type (required); floor_area_sqm, storey, remaining_lease_years (optional)",
      charged: "only for a successful answer; invalid requests return 400/404 and are not charged",
      attribution: ATTRIBUTION,
    });
  });

  app.get(PATH, precompute, paywall, (req: Request, res: Response) => {
    logUsage("rest", callerHash(req.ip ?? "unknown"), true);
    res.status(200).json(res.locals.fairValue);
  });

  logger.info(`paid property route mounted: GET ${PATH} at ${config.X402_PROPERTY_PRICE} on ${config.X402_NETWORK}`);
}
