import fs from "fs";
import path from "path";
import readline from "readline";
import { DatabaseSync } from "node:sqlite";

// Builds data/property/uk/ppd.sqlite from the HM Land Registry Price Paid Data yearly CSV files
// (data/property/uk/pp-YYYY.csv; Open Government Licence v3.0). Usage: npx tsx scripts/sync-uk-ppd.ts
// Download the files first from:
//   http://prod1.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/pp-YYYY.csv
const DIR = path.resolve(process.cwd(), "data", "property", "uk");
const DB_PATH = path.join(DIR, "ppd.sqlite");

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => /^pp-\d{4}\.csv$/.test(f)).sort();
  if (files.length === 0) throw new Error(`No pp-YYYY.csv files in ${DIR}`);
  const tmp = DB_PATH + ".tmp";
  if (fs.existsSync(tmp)) fs.rmSync(tmp);
  const db = new DatabaseSync(tmp);
  db.exec(`
    CREATE TABLE ppd (
      price INTEGER NOT NULL, month_idx INTEGER NOT NULL, postcode TEXT NOT NULL,
      outcode TEXT NOT NULL, sector TEXT NOT NULL, area TEXT NOT NULL, ptype TEXT NOT NULL,
      is_new INTEGER NOT NULL, tenure TEXT NOT NULL, street TEXT, town TEXT, district TEXT, county TEXT
    );
  `);
  const insert = db.prepare(
    "INSERT INTO ppd VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );
  let rows = 0;
  let skipped = 0;
  db.exec("BEGIN");
  for (const f of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(DIR, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      const m = line.match(/"([^"]*)"/g);
      if (!m || m.length < 16) {
        skipped++;
        continue;
      }
      const v = m.map((s) => s.slice(1, -1));
      // 0 id,1 price,2 date,3 postcode,4 type,5 new,6 duration,7 paon,8 saon,9 street,10 locality,
      // 11 town,12 district,13 county,14 ppd category (A=standard), 15 record status (A/C/D)
      const price = Number(v[1]);
      const postcode = v[3].trim().toUpperCase();
      const ptype = v[4];
      if (!price || !postcode.includes(" ") || !"DSTF".includes(ptype) || v[14] !== "A" || v[15] === "D") {
        skipped++;
        continue;
      }
      const outcode = postcode.split(" ")[0];
      const sector = `${outcode} ${postcode.split(" ")[1][0]}`;
      const area = outcode.replace(/\d.*$/, "");
      const monthIdx = Number(v[2].slice(0, 4)) * 12 + (Number(v[2].slice(5, 7)) - 1);
      insert.run(price, monthIdx, postcode, outcode, sector, area, ptype, v[5] === "Y" ? 1 : 0, v[6], v[9], v[11], v[12], v[13]);
      rows++;
    }
    console.log(`${f}: cumulative rows ${rows}`);
  }
  db.exec("COMMIT");
  db.exec("CREATE INDEX i_outcode ON ppd (outcode, ptype, month_idx);");
  db.exec("CREATE INDEX i_area ON ppd (area, ptype, month_idx);");
  db.close();
  fs.renameSync(tmp, DB_PATH);
  console.log(`Done: ${rows} rows kept, ${skipped} skipped -> ${DB_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
