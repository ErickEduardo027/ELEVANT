import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { summary } from './workflow.js';
export async function excel(data){const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet('Resumen');ws.columns=[{header:'Indicador',key:'k',width:28},{header:'Total',key:'v',width:14}];Object.entries(summary(data)).forEach(([k,v])=>ws.addRow({k,v}));ws.getRow(1).font={bold:true};return Buffer.from(await wb.xlsx.writeBuffer());}
export function pdf(data){return new Promise((resolve,reject)=>{const doc=new PDFDocument();const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);doc.fontSize(20).text('ELEVANT - Reporte consolidado');doc.moveDown();Object.entries(summary(data)).forEach(([k,v])=>doc.fontSize(12).text(`${k}: ${v}`));doc.end();});}
