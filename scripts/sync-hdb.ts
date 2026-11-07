import fs from "fs";
import path from "path";

// Refreshes data/property/hdb_resale.csv from the official data.gov.sg dataset
// (Singapore Open Data Licence v1.0). Run nightly or weekly; the server loads the file at startup.
const DATASET = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc";
const OUT = path.resolve(process.cwd(), "data", "property", "hdb_resale.csv");

async function main() {
  const init = await fetch(`https://api-open.data.gov.sg/v1/public/api/datasets/${DATASET}/initiate-download`);
  const initJson = (await init.json()) as { data?: { url?: string } };
  const url = initJson.data?.url;
  if (!url) throw new Error("No download URL returned by data.gov.sg");
  const csv = await fetch(url);
  if (!csv.ok) throw new Error(`Download failed: ${csv.status}`);
  const text = await csv.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 100000 || !lines[0].startsWith("month,town,flat_type")) {
    throw new Error(`Refusing to overwrite: unexpected content (${lines.length} lines).`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = OUT + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, OUT);
  console.log(`Saved ${lines.length - 1} rows to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
