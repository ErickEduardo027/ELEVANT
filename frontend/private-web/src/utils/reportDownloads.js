function safeText(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function columnsFromRows(rows) {
  return [...new Set(rows.flatMap(row => Object.keys(row).filter(key => key !== 'detail')))];
}

function downloadBlob(blob, fileName) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function xmlEscape(value) {
  return safeText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pdfEscape(value) {
  return safeText(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/([\\()])/g, '\\$1');
}

function buildPdf(title, columns, rows) {
  const heading = columns.join(' | ');
  const lines = [title, '', heading, '-'.repeat(Math.min(110, heading.length || 20))];
  for (const row of rows) lines.push(columns.map(column => safeText(row[column])).join(' | ').slice(0, 115));
  if (!rows.length) lines.push('Sin registros para exportar.');
  const pages = [];
  for (let index = 0; index < lines.length; index += 48) pages.push(lines.slice(index, index + 48));

  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  pages.forEach((pageLines, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const commands = `BT /F1 9 Tf 36 806 Td 13 TL ${pageLines.map(line => `(${pdfEscape(line)}) Tj T*`).join(' ')} ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${new TextEncoder().encode(commands).length} >>\nstream\n${commands}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = new TextEncoder().encode(pdf).length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

export function downloadTabularReport({ title, format, fileName, rows = [] }) {
  const columns = columnsFromRows(rows);
  if (format === 'pdf') {
    downloadBlob(buildPdf(title, columns, rows), fileName.replace(/\.[^.]+$/, '.pdf'));
    return;
  }
  const header = columns.map(column => `<Cell><Data ss:Type="String">${xmlEscape(column)}</Data></Cell>`).join('');
  const body = rows.map(row => `<Row>${columns.map(column => `<Cell><Data ss:Type="String">${xmlEscape(row[column])}</Data></Cell>`).join('')}</Row>`).join('');
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="ELEVANT"><Table><Row>${header}</Row>${body}</Table></Worksheet></Workbook>`;
  downloadBlob(new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' }), fileName.replace(/\.[^.]+$/, '.xls'));
}
