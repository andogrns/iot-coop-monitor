import fs from 'node:fs/promises';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outDir = 'outputs/shopping_list_20260908';
await fs.mkdir(outDir, { recursive: true });

const wb = Workbook.create();
const ws = wb.worksheets.add('Shopping List');
ws.showGridLines = false;
ws.tabColor = '#1F4E78';

ws.getRange('A1:D1').merge();
ws.getRange('A1').values = [['Shopping List']];
ws.getRange('A3:D3').values = [['ITEM NAME', 'QUANTITY', 'PRICE', 'LINK']];
ws.getRange('A4:C7').values = [
  ['ESP32-C3 Board', 1, 56000],
  ['MQ-135 Module', 1, 18600],
  ['SHT-31 Module', 1, 28350],
  ['Breadboard', 1, 13500],
];
const urls = [
  'https://www.tokopedia.com/cncstorebandung/esp32-esp-32-doit-wifi-bluetooth-iot-esp-32s-development-board?extParam=ivf%3Dfalse%26keyword%3Desp-32%26search_id%3D2026090806093918D8042386B79E38AYOV%26src%3Dsearch',
  'https://www.tokopedia.com/cncstorebandung/gas-sensor-module-mq-series-mq-2-mq-3-mq-4-mq-5-mq-6-mq-7-mq-8-mq-135-untuk-arduino-project-iot-1732187577835685438?extParam=ivf%3Dfalse%26keyword%3Dmq-137%26search_id%3D20260908061050CD00692C3BFE590005F6%26src%3Dsearch&t_id=1788847854164&t_st=2&t_pp=search_result&t_efo=search_pure_goods_card&t_ef=goods_search&t_sm=&t_spt=search_result',
  'https://www.tokopedia.com/cncstorebandung/sensor-suhu-kelembapan-gy-sht31-digital-sensor-modul-temperatur-humidity-akurat-1731127919299954238?extParam=ivf%3Dfalse%26keyword%3Dsht-40%26search_id%3D2026090806155318D8042386B79E053026%26src%3Dsearch&t_id=1788847785056&t_st=2&t_pp=search_result&t_efo=search_pure_goods_card&t_ef=goods_search&t_sm=&t_spt=search_result',
  'https://www.tokopedia.com/iotstore/breadboard-mb-102-solderless-830-830p?extParam=ivf%3Dfalse%26keyword%3Dbreadboard%26search_id%3D20260908061638FE73F687E5BC523BAGSH%26src%3Dsearch&t_id=1788847785056&t_st=3&t_pp=search_result&t_efo=search_pure_goods_card&t_ef=goods_search&t_sm=&t_spt=search_result',
];
ws.getRange('D4:D7').values = urls.map(u => [u]);
ws.getRange('A9:C9').values = [['TOTAL', null, null]];
ws.getRange('C9').formulas = [['=SUMPRODUCT(B4:B7,C4:C7)']];

const body = ws.getRange('A1:D9');
body.format.font = { name: 'Arial', size: 10, color: '#1F2937' };
body.format.verticalAlignment = 'center';
ws.getRange('A1:D1').format = { font: { name: 'Arial', size: 15, bold: true, color: '#1F2937' } };
ws.getRange('A3:D3').format = { fill: '#1F4E78', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center', verticalAlignment: 'center', borders: { preset: 'outside', style: 'thin', color: '#1F4E78' } };
ws.getRange('A4:D7').format.borders = { insideHorizontal: { style: 'thin', color: '#D9E2F3' }, bottom: { style: 'thin', color: '#D9E2F3' } };
ws.getRange('D4:D7').format.font = { name: 'Arial', size: 9, color: '#0563C1', underline: true };
ws.getRange('B4:B7').format.horizontalAlignment = 'center';
ws.getRange('C4:C7').format.numberFormat = '"IDR" #,##0';
ws.getRange('C4:C7').format.horizontalAlignment = 'right';
ws.getRange('A9:C9').format = { fill: '#EAF2F8', font: { name: 'Arial', size: 10, bold: true, color: '#1F2937' }, borders: { top: { style: 'double', color: '#1F4E78' } } };
ws.getRange('C9').format.numberFormat = '"IDR" #,##0';
ws.getRange('C9').format.horizontalAlignment = 'right';
ws.getRange('A1:D1').format.rowHeight = 26;
ws.getRange('A3:D3').format.rowHeight = 22;
ws.getRange('A4:D9').format.rowHeight = 20;
ws.getRange('A:A').format.columnWidth = 24;
ws.getRange('B:B').format.columnWidth = 12;
ws.getRange('C:C').format.columnWidth = 16;
ws.getRange('D:D').format.columnWidth = 52;
ws.freezePanes.freezeRows(3);

wb.recalculate();
const check = await wb.inspect({ kind: 'table', range: 'Shopping List!A1:D9', include: 'values,formulas', tableMaxRows: 12, tableMaxCols: 6 });
console.log(check.ndjson);
const errors = await wb.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 100 }, summary: 'final formula error scan' });
console.log(errors.ndjson);
const preview = await wb.render({ sheetName: 'Shopping List', range: 'A1:D9', scale: 2, format: 'png' });
await fs.writeFile(`${outDir}/shopping_list_preview.png`, new Uint8Array(await preview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(`${outDir}/shopping_list.xlsx`);
