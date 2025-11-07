const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// Read the XLSX file
const xlsxPath = path.join(__dirname, '..', 'public', 'COP_SampleData(1).xlsx');
const workbook = XLSX.readFile(xlsxPath);

console.log('Converting XLSX to JSON files...');
console.log('Found sheets:', workbook.SheetNames);

// Create output directory
const outputDir = path.join(__dirname, '..', 'public', 'node-data');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Process each sheet (tab)
for (let i = 0; i < workbook.SheetNames.length && i < 8; i++) {
  const sheetName = workbook.SheetNames[i];
  const worksheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  console.log(`Processing sheet ${i + 1}: ${sheetName} (${data.length} rows)`);

  // Find lat and lng columns
  let latCol = -1;
  let lngCol = -1;

  if (data.length > 0) {
    const headerRow = data[0];
    headerRow.forEach((cell, index) => {
      const cellStr = String(cell || '').toLowerCase();
      if (cellStr.includes('lat') || cellStr.includes('latitude')) {
        latCol = index;
      }
      if (cellStr.includes('lng') || cellStr.includes('longitude') || cellStr.includes('lon')) {
        lngCol = index;
      }
    });
  }

  // Extract coordinates from all rows
  const coordinates = [];
  for (let row = 1; row < data.length; row++) {
    const rowData = data[row];
    if (latCol >= 0 && lngCol >= 0 && rowData[latCol] && rowData[lngCol]) {
      const lat = parseFloat(rowData[latCol]);
      const lng = parseFloat(rowData[lngCol]);
      if (!isNaN(lat) && !isNaN(lng)) {
        coordinates.push({ lat, lng });
      }
    }
  }

  // Save to JSON file
  const outputPath = path.join(outputDir, `node-${i + 1}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(coordinates, null, 2));
  console.log(`  Saved ${coordinates.length} coordinates to ${outputPath}`);
}

console.log('Conversion complete!');

