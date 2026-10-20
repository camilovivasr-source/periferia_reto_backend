import type { Paquete } from '../schemas.js';
import { sha256 } from './util.js';

/** Contenido que se hashea: encabezados + cuerpo del correo de aprobacion, tal como llego. */
export function contenidoEvidencia(p: Paquete): string {
  const a = p.aprobacion;
  if (!a) throw new Error('No hay correo de aprobacion');
  return [
    'EVIDENCIA DE APROBACION - CORREO DEL LIDER',
    `Solicitud: ${p.solicitud.solicitud_id}`,
    `De: ${a.de}`,
    `Para: ${a.para ?? ''}`,
    `Cc: ${a.cc.join(', ')}`,
    `Fecha: ${a.fecha}`,
    `Asunto: ${a.asunto}`,
    '',
    a.texto,
  ].join('\n');
}

export const hashEvidencia = (p: Paquete) => sha256(contenidoEvidencia(p));

/** PDF minimo de una pagina, solo texto (Helvetica, WinAnsi). Sin fechas ni ids: salida determinista. */
export function generarPdf(lineas: string[]): Buffer {
  const ancho = 90;
  const envueltas = lineas.flatMap((l) => (l.length <= ancho ? [l] : (l.match(new RegExp(`.{1,${ancho}}(\\s|$)`, 'g')) ?? [l]).map((x) => x.trimEnd())));
  const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const contenido = ['BT', '/F1 10 Tf', '13 TL', '50 800 Td', ...envueltas.slice(0, 55).map((l) => `(${esc(l)}) '`), 'ET'].join('\n');
  const stream = Buffer.from(contenido, 'latin1');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  const largo = () => partes.reduce((n, b) => n + b.length, 0);
  objetos.forEach((o, i) => {
    offsets.push(largo());
    partes.push(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1'));
  });
  offsets.push(largo());
  partes.push(Buffer.from(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream\nendobj\n', 'latin1'));
  const xref = largo();
  const filas = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  partes.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${filas}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}
