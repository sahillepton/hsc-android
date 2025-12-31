const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function walk(dir) {
  let results = [];
  for (const file of fs.readdirSync(dir)) {
    const p = path.join(dir, file);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) results = results.concat(walk(p));
    else if (p.endsWith(".pbf")) results.push(p);
  }
  return results;
}

const root = path.join(process.cwd(), "public");
const files = walk(root);
console.log(`Found ${files.length} .pbf files`);

let converted = 0;
let skipped = 0;

for (const filePath of files) {
  const input = fs.readFileSync(filePath);

  // gzip magic bytes check: 1F 8B
  const isGzipped = input[0] === 0x1f && input[1] === 0x8b;

  if (!isGzipped) {
    skipped++;
    continue; // already uncompressed
  }

  const output = zlib.gunzipSync(input);
  fs.writeFileSync(filePath, output);
  converted++;

  if (converted % 1000 === 0) {
    console.log(`Converted ${converted} tiles...`);
  }
}

console.log(`✅ Done`);
console.log(`Converted: ${converted}`);
console.log(`Skipped (already raw): ${skipped}`);
