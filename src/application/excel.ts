import { stat } from 'node:fs/promises';
import path from 'node:path';
import readXlsxFile from 'read-excel-file/node';
import { DatosError, entornoDe } from '../data.js';
import type { Invocacion } from './tipos.js';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILAS = 500;

/**
 * Lee la primera hoja de un .xlsx dentro de fixtures/ u out/ (nunca fuera) y devuelve filas como objetos,
 * usando la primera fila como encabezado. Es la lectura real de la solicitud (P1 opcional del PRD).
 */
export async function leerExcel(inv: Invocacion, ruta: string) {
  const env = entornoDe(inv.directory);
  const absoluta = path.resolve(inv.directory, ruta);
  const permitido = [env.fixturesDir, env.outDir].some((raiz) => absoluta === raiz || absoluta.startsWith(raiz + path.sep));
  if (!permitido) throw new DatosError('Ruta no permitida: solo se leen archivos dentro de fixtures/ u out/.');
  if (path.extname(absoluta).toLowerCase() !== '.xlsx') throw new DatosError('Solo se admiten archivos .xlsx.');
  const info = await stat(absoluta).catch(() => null);
  if (!info?.isFile()) throw new DatosError(`No existe el archivo ${ruta}`);
  if (info.size > MAX_BYTES) throw new DatosError('El archivo supera el limite de 5 MB.');

  let hoja: unknown[][];
  try {
    hoja = await readXlsxFile(absoluta);
  } catch {
    throw new DatosError('El archivo no es un .xlsx valido (corrupto o con otro formato).');
  }
  if (hoja.length < 2) throw new DatosError('La hoja necesita encabezado y al menos una fila de datos.');
  const encabezado = hoja[0].map((c) => String(c ?? '').trim());
  if (encabezado.some((c) => !c)) throw new DatosError('La primera fila (encabezado) tiene celdas vacias.');
  const filas = hoja.slice(1, MAX_FILAS + 1).map((fila) => Object.fromEntries(encabezado.map((nombre, i) => [nombre, fila[i] ?? null])));
  return { hoja: 1, columnas: encabezado, total: hoja.length - 1, truncado: hoja.length - 1 > MAX_FILAS, filas };
}
