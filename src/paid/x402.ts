import { RequestHandler } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { config } from "../config";

/**
 * Shared x402 (Coinbase pay-per-request) helper.
 *
 * Verified in @x402/express: settlement happens only when the handler returns status < 400, so
 * any error / refusal response is not charged. Put auth + input validation BEFORE this middleware.
 * Only a PUBLIC receiving address is ever configured (X402_PAY_TO); never a private key.
 *
 * The Bazaar extension is registered so routes that declare a discovery extension become
 * discoverable to agents. Per the x402 docs, a facilitator catalogs a service when it processes
 * a payment that echoes the bazaar extension, so the FIRST successful payment (even your own
 * test purchase) is what gets the service listed.
 */
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function x402Enabled(): boolean {
  return EVM_ADDRESS.test((config.X402_PAY_TO ?? "").trim());
}

export interface PaidRoute {
  price: string;
  description: string;
  mimeType?: string;
  extensions?: Record<string, unknown>;
}

/** routes: { "GET /property/paid/fair-value": { price: "$0.02", description: "...", extensions } } */
export function createPaywall(routes: Record<string, PaidRoute>): RequestHandler {
  if (!x402Enabled()) throw new Error("X402_PAY_TO is not a valid 0x address");
  const network = config.X402_NETWORK as `${string}:${string}`;
  const payTo = (config.X402_PAY_TO ?? "").trim() as `0x${string}`;
  const facilitator = new HTTPFacilitatorClient({ url: config.X402_FACILITATOR_URL });
  const server = new x402ResourceServer(facilitator)
    .register(network, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  const routeConfig = Object.fromEntries(
    Object.entries(routes).map(([key, v]) => [
      key,
      {
        accepts: { scheme: "exact" as const, price: v.price, network, payTo },
        description: v.description,
        mimeType: v.mimeType ?? "application/json",
        ...(v.extensions ? { extensions: v.extensions } : {}),
      },
    ])
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return paymentMiddleware(routeConfig as any, server);
}
