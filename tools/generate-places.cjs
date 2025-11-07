'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function normalizeHeader(h) {
  if (!h) return '';
  return String(h).trim().toLowerCase().replace(/\s+/g, ' ');
}

function findColumn(headers, candidates) {
  const set = new Set(candidates.map(normalizeHeader));
  for (const h of headers) {
    const key = normalizeHeader(h);
    if (set.has(key)) return h;
  }
  // fallback: partial includes
  for (const h of headers) {
    const key = normalizeHeader(h);
    for (const c of set) {
      if (key.includes(c)) return h;
    }
  }
  return null;
}

function main() {
  const xlsxPath = path.join(process.cwd(), 'src', 'lib', 'District_Masters.xlsx');
  if (!fs.existsSync(xlsxPath)) {
    console.error('District_Masters.xlsx not found at', xlsxPath);
    process.exit(1);
  }

  const wb = XLSX.readFile(xlsxPath);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    console.error('No sheets found in the workbook.');
    process.exit(1);
  }

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) {
    console.error('No rows found in the first sheet.');
    process.exit(1);
  }

  const headers = Object.keys(rows[0] || {});
  const stateCol = findColumn(headers, [
    'state',
    'state/ut',
    'state_ut',
    'state name',
    'state/ut name',
    'statename',
  ]);
  const districtCol = findColumn(headers, [
    'district',
    'district name',
    'districtname',
  ]);

  if (!stateCol || !districtCol) {
    console.error('Could not detect State and/or District columns. Found headers:', headers);
    process.exit(1);
  }

  const stateToDistricts = new Map();

  for (const row of rows) {
    const stateRaw = row[stateCol];
    const districtRaw = row[districtCol];
    if (!stateRaw || !districtRaw) continue;
    const state = String(stateRaw).trim();
    const district = String(districtRaw).trim();
    if (!state || !district) continue;
    if (!stateToDistricts.has(state)) stateToDistricts.set(state, new Set());
    stateToDistricts.get(state).add(district);
  }

  // Build JSON structure
  const output = {};
  for (const [state, districtsSet] of stateToDistricts.entries()) {
    output[state] = {
      districts: Array.from(districtsSet).sort((a, b) => a.localeCompare(b)).map((name) => ({ name })),
    };
  }

  const outPath = path.join(process.cwd(), 'src', 'lib', 'places.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log('Generated places.json with', Object.keys(output).length, 'states/UTs at', outPath);
}

main();


