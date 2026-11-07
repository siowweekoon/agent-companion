import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import fs from "fs";
import path from "path";

/**
 * Buyer-side test of the paid route on TESTNET (Base Sepolia). Uses a THROWAWAY wallet, never yours.
 * Usage:  BASE=http://localhost:8803 npx tsx scripts/test-paid-buyer.ts
 * The throwaway key is stored in tmp/test-buyer.json (gitignored folder, testnet funds only) so you
 * can fund it once from a Base Sepolia USDC faucet and rerun.
 */
const BASE = process.env.BASE ?? "http://localhost:8803";
const keyFile = path.resolve(process.cwd(), "tmp", "test-buyer.json");

function loadOrCreateKey(): `0x${string}` {
  if (fs.existsSync(keyFile)) return JSON.parse(fs.readFileSync(keyFile, "utf8")).privateKey;
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  const privateKey = generatePrivateKey();
  fs.writeFileSync(keyFile, JSON.stringify({ privateKey, note: "THROWAWAY TESTNET KEY. Never put real funds here." }));
  return privateKey;
}

async function main() {
  const account = privateKeyToAccount(loadOrCreateKey());
  console.log("Throwaway buyer address (fund with Base Sepolia test USDC):", account.address);

  const client = new x402Client().register("eip155:*", new ExactEvmScheme(account));
  const pay = wrapFetchWithPayment(fetch, client);

  const url = `${BASE}/property/paid/fair-value?town=TAMPINES&flat_type=4%20ROOM&floor_area_sqm=93&storey=10&remaining_lease_years=70`;
  const res = await pay(url, { method: "GET" });
  console.log("HTTP", res.status);
  const body = await res.text();
  console.log(body.slice(0, 500));
  const hdr = res.headers.get("PAYMENT-RESPONSE") ?? res.headers.get("X-PAYMENT-RESPONSE");
  if (hdr) console.log("settlement:", JSON.stringify(decodePaymentResponseHeader(hdr)));
}

main().catch((e) => {
  console.error("buyer test error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
