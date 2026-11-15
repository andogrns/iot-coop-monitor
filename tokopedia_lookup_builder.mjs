import fs from 'node:fs/promises';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outputDir = 'C:/Users/Ando/Documents/Ando/bleh/Enrichment 2/outputs/tokopedia_lookup';
await fs.mkdir(outputDir, { recursive: true });

const wb = Workbook.create();
const ws = wb.worksheets.add('Tokopedia Lookup');
ws.showGridLines = false;
ws.tabColor = '#1F4E78';

const font = 'Arial';
ws.getRange('A1:H30').format.font = { name: font, size: 10, color: '#1F2937' };
ws.getRange('A1').values = [['Tokopedia component price lookup']];
ws.mergeCells('A1:H1');
ws.getRange('A1:H1').format.font = { name: font, size: 14, bold: true, color: '#1F2937' };
ws.getRange('A2').values = [['As of 2026-09-08. Filter requested: seller rating above 4.5 stars and at least 30 reviews.']];
ws.mergeCells('A2:H2');
ws.getRange('A2:H2').format.font = { name: font, size: 10, italic: true, color: '#4B5563' };

ws.getRange('A4:H4').values = [['Qualified sellers', null, null, null, null, null, null, null]];
ws.getRange('A4:H4').format = { fill: '#DCE6F1', font: { name: font, size: 10, bold: true, color: '#1F2937' } };
ws.mergeCells('A4:H4');

ws.getRange('A5:H5').values = [[
  'Requested item', 'Seller', 'Product/listing title', 'Price (IDR)', 'Seller rating', 'Seller reviews', 'Tokopedia listing link', 'Verification status'
]];
ws.getRange('A5:H5').format = {
  fill: '#1F4E78',
  font: { name: font, size: 10, bold: true, color: '#FFFFFF' },
  wrapText: true,
  verticalAlignment: 'center',
  horizontalAlignment: 'center',
  borders: { preset: 'all', style: 'thin', color: '#FFFFFF' },
};

const items = [
  ['1x ESP32-C3 Board', '', '', null, null, null, '', 'No qualifying seller verified'],
  ['1x MQ-137 Module', '', '', null, null, null, '', 'No qualifying seller verified'],
  ['1x SHT-40 Module', '', '', null, null, null, '', 'No qualifying seller verified'],
  ['Power source for ESP-32 board', '', '', null, null, null, '', 'No qualifying seller verified'],
  ['1x Breadboard', '', '', null, null, null, '', 'No qualifying seller verified'],
];
ws.getRange('A6:H10').values = items;
ws.getRange('A6:H10').format = { verticalAlignment: 'center', wrapText: true };
ws.getRange('A6:H10').format.borders = { preset: 'outside', style: 'thin', color: '#D9E2F3' };
ws.getRange('A6:H10').format.fill = '#F8FAFC';
ws.getRange('H6:H10').format = { fill: '#FDECEC', font: { name: font, size: 10, bold: true, color: '#B91C1C' }, wrapText: true, verticalAlignment: 'center' };

ws.getRange('A12:H12').values = [['Verification note', null, null, null, null, null, null, null]];
ws.getRange('A12:H12').format = { fill: '#FFF2CC', font: { name: font, size: 10, bold: true, color: '#7F6000' } };
ws.mergeCells('A12:H12');
ws.getRange('A13:H15').values = [[
  'Tokopedia’s interactive site was blocked by the browser safety policy in this environment, and public web indexing did not expose live Tokopedia listing pages with seller rating and review-count fields for these exact items.', null, null, null, null, null, null, null
], [
  'No price or listing URL is populated in the qualified-seller table because doing so would require presenting stale, cross-marketplace, or unverified data as current Tokopedia data.', null, null, null, null, null, null, null
], [
  'The search links below are included so the lookup can be completed manually in Tokopedia when direct access is available.', null, null, null, null, null, null, null
]];
ws.mergeCells('A13:H13'); ws.mergeCells('A14:H14'); ws.mergeCells('A15:H15');
ws.getRange('A13:H15').format = { wrapText: true, font: { name: font, size: 10, color: '#7F6000' }, verticalAlignment: 'center' };

ws.getRange('A17:D17').values = [['Tokopedia search links', null, null, null]];
ws.getRange('A17:D17').format = { fill: '#DCE6F1', font: { name: font, size: 10, bold: true, color: '#1F2937' } };
ws.mergeCells('A17:D17');
ws.getRange('A18:D18').values = [['Requested item', 'Search URL', 'What to verify', 'Source status']];
ws.getRange('A18:D18').format = { fill: '#5B9BD5', font: { name: font, size: 10, bold: true, color: '#FFFFFF' }, wrapText: true, horizontalAlignment: 'center', verticalAlignment: 'center' };
ws.getRange('A19:D23').values = [
  ['1x ESP32-C3 Board', 'https://www.tokopedia.com/search?st=product&q=ESP32-C3', 'Listing price, seller rating > 4.5, seller reviews >= 30', 'Not live-verified'],
  ['1x MQ-137 Module', 'https://www.tokopedia.com/search?st=product&q=MQ-137', 'Listing price, seller rating > 4.5, seller reviews >= 30', 'Not live-verified'],
  ['1x SHT-40 Module', 'https://www.tokopedia.com/search?st=product&q=SHT40', 'Listing price, seller rating > 4.5, seller reviews >= 30', 'Not live-verified'],
  ['Power source for ESP-32 board', 'https://www.tokopedia.com/search?st=product&q=ESP32%20power%20supply', 'Confirm suitable 5V USB or 3.3V/5V breadboard supply; then verify seller filters', 'Not live-verified'],
  ['1x Breadboard', 'https://www.tokopedia.com/search?st=product&q=breadboard', 'Listing price, seller rating > 4.5, seller reviews >= 30', 'Not live-verified'],
];
ws.getRange('A19:D23').format = { wrapText: true, verticalAlignment: 'center' };
ws.getRange('A18:D23').format.borders = { preset: 'outside', style: 'thin', color: '#D9E2F3' };

ws.getRange('F17:H17').values = [['Public-index leads (excluded)', null, null]];
ws.getRange('F17:H17').format = { fill: '#E2F0D9', font: { name: font, size: 10, bold: true, color: '#375623' } };
ws.mergeCells('F17:H17');
ws.getRange('F18:H18').values = [['Lead', 'Observed price / detail', 'Why excluded']];
ws.getRange('F18:H18').format = { fill: '#70AD47', font: { name: font, size: 10, bold: true, color: '#FFFFFF' }, wrapText: true, horizontalAlignment: 'center', verticalAlignment: 'center' };
ws.getRange('F19:H21').values = [
  ['EasyWare Electronics — ESP32-C3 product page', 'Rp40,500–63,000; product page says out of stock', 'Non-Tokopedia page; Tokopedia seller rating/review count not shown'],
  ['CNC Store Bandung — ESP32-C3 product page', 'Rp37,000–87,200', 'Non-Tokopedia page; Tokopedia seller rating/review count not shown'],
  ['TOKOASIA-RIAU — MB102 breadboard power module', 'Rp11,000 on Blibli', 'Non-Tokopedia page; cross-marketplace price and reviews'],
];
ws.getRange('F19:H21').format = { wrapText: true, verticalAlignment: 'center' };

ws.getRange('A25:H25').values = [['Source URLs used for public-index cross-check', null, null, null, null, null, null, null]];
ws.getRange('A25:H25').format = { fill: '#F2F2F2', font: { name: font, size: 9, bold: true, color: '#595959' } };
ws.mergeCells('A25:H25');
ws.getRange('A26:H28').values = [
  ['https://www.easyware.co.id/product/esp32-c3-super-mini-development-board-board-wifi-bluetooth-type-c-untuk-iot/', null, null, null, null, null, null, null],
  ['https://cncstorebandung.com/product/esp32-c3-super-mini-wifi-wireless-bluetooth-ble-5-0-esp32-c3/', null, null, null, null, null, null, null],
  ['https://www.blibli.com/p/mb102-breadboard-power-supply-module-3-3v-5v-for-arduino/ps--TOA-71158-00502', null, null, null, null, null, null, null],
];
ws.mergeCells('A26:H26'); ws.mergeCells('A27:H27'); ws.mergeCells('A28:H28');
ws.getRange('A26:H28').format = { font: { name: font, size: 9, color: '#4B5563' }, wrapText: true };

ws.getRange('A1:H28').format.verticalAlignment = 'center';
ws.getRange('A5:H10').format.rowHeight = 32;
ws.getRange('A13:H15').format.rowHeight = 30;
ws.getRange('A18:D23').format.rowHeight = 32;
ws.getRange('F18:H21').format.rowHeight = 44;
ws.getRange('A1:H28').format.autofitColumns();
ws.getRange('A:A').format.columnWidth = 26;
ws.getRange('B:B').format.columnWidth = 23;
ws.getRange('C:C').format.columnWidth = 28;
ws.getRange('D:D').format.columnWidth = 14;
ws.getRange('E:F').format.columnWidth = 14;
ws.getRange('G:G').format.columnWidth = 34;
ws.getRange('H:H').format.columnWidth = 25;
ws.getRange('A18:D23').format.columnWidth = 28;
ws.freezePanes.freezeRows(5);

wb.recalculate();
const check = await wb.inspect({ kind: 'table', sheetId: 'Tokopedia Lookup', range: 'A1:H28', include: 'values,formulas', tableMaxRows: 28, tableMaxCols: 8, maxChars: 5000 });
console.log(check.ndjson);
const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 50 }, summary: 'final formula error scan' });
console.log(errors.ndjson);
const preview = await wb.render({ sheetName: 'Tokopedia Lookup', range: 'A1:H28', scale: 1, format: 'png' });
await fs.writeFile(`${outputDir}/tokopedia_lookup_preview.png`, new Uint8Array(await preview.arrayBuffer()));
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(`${outputDir}/tokopedia_lookup.xlsx`);
console.log(`Saved ${outputDir}/tokopedia_lookup.xlsx`);
