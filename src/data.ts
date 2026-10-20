import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  AprobacionRawSchema,
  CentroCostoSchema,
  CondicionPagoSchema,
  CorreoSchema,
  IndicadorIvaSchema,
  ProveedorSchema,
  SolicitudSchema,
  type Maestros,
  type Paquete,
} from './schemas.js';
import { esAprobacion, parsearCotizacion, parsearFactura } from './domain/parse.js';
import { soloFecha } from './domain/util.js';

/** Error de datos de entrada: se devuelve como { ok:false, error }, nunca como rechazo de negocio. */
export class DatosError extends Error {}

export type Entorno = { directory: string; fixturesDir: string; outDir: string };

export function entornoDe(directory: string, env: NodeJS.ProcessEnv = process.env): Entorno {
  return {
    directory,
    fixturesDir: path.resolve(directory, env.FIXTURES_DIR ?? 'fixtures/reto-03'),
    outDir: path.resolve(directory, env.OUT_DIR ?? 'out'),
  };
}

const CASO = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
export function validarNombreCaso(caso: string): string {
  if (!CASO.test(caso)) throw new DatosError(`Nombre de caso invalido: "${caso}". Use por ejemplo sol-001.`);
  return caso;
}

function formatoZod(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ');
}

async function leerJson<T>(ruta: string, schema: z.ZodType<T>, nombre: string): Promise<T> {
  let crudo: string;
  try {
    crudo = await readFile(ruta, 'utf8');
  } catch {
    throw new DatosError(`Falta el archivo ${nombre}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(crudo);
  } catch {
    throw new DatosError(`${nombre} no es JSON valido (malformado)`);
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new DatosError(`${nombre} invalido: ${formatoZod(r.error)}`);
  return r.data;
}

async function leerTextoOpcional(ruta: string): Promise<string | null> {
  try {
    return await readFile(ruta, 'utf8');
  } catch {
    return null;
  }
}

export async function cargarMaestros(env: Entorno): Promise<Maestros> {
  const dir = path.join(env.fixturesDir, 'maestros');
  const [proveedores, centros, indicadoresIva, condicionesPago] = await Promise.all([
    leerJson(path.join(dir, 'proveedores.json'), z.array(ProveedorSchema), 'maestros/proveedores.json'),
    leerJson(path.join(dir, 'centros-costo.json'), z.array(CentroCostoSchema), 'maestros/centros-costo.json'),
    leerJson(path.join(dir, 'indicadores-iva.json'), z.array(IndicadorIvaSchema), 'maestros/indicadores-iva.json'),
    leerJson(path.join(dir, 'condiciones-pago.json'), z.array(CondicionPagoSchema), 'maestros/condiciones-pago.json'),
  ]);
  return { proveedores, centros, indicadoresIva, condicionesPago };
}

export async function listarCasos(env: Entorno): Promise<string[]> {
  try {
    const entradas = await readdir(path.join(env.fixturesDir, 'solicitudes'), { withFileTypes: true });
    return entradas.filter((e) => e.isDirectory() && CASO.test(e.name)).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** Lee y normaliza el paquete de un caso. Un adjunto ausente es null y queda en `faltantes`. */
export async function leerPaquete(env: Entorno, caso: string): Promise<Paquete> {
  validarNombreCaso(caso);
  const dir = path.join(env.fixturesDir, 'solicitudes', caso);
  if (!(await listarCasos(env)).includes(caso)) throw new DatosError(`No existe el caso "${caso}"`);
  const [correo, solicitud] = await Promise.all([
    leerJson(path.join(dir, 'correo.json'), CorreoSchema, `${caso}/correo.json`),
    leerJson(path.join(dir, 'solicitud.json'), SolicitudSchema, `${caso}/solicitud.json`),
  ]);
  const faltantes: string[] = [];

  const textoCot = await leerTextoOpcional(path.join(dir, 'cotizacion.txt'));
  if (textoCot === null) faltantes.push('cotizacion.txt');

  const rawAprobacion = await leerTextoOpcional(path.join(dir, 'aprobacion.json'));
  let aprobacion: Paquete['aprobacion'] = null;
  if (rawAprobacion === null) faltantes.push('aprobacion.json');
  else {
    const a = await leerJson(path.join(dir, 'aprobacion.json'), AprobacionRawSchema, `${caso}/aprobacion.json`);
    aprobacion = {
      de: a.de.trim().toLowerCase(),
      para: a.para ?? null,
      cc: a.cc ?? [],
      asunto: a.asunto,
      fecha: a.fecha,
      aprobado: esAprobacion(a.cuerpo),
      texto: a.cuerpo,
    };
  }

  const textoFactura = await leerTextoOpcional(path.join(dir, 'factura.txt'));
  const factura = textoFactura === null ? null : parsearFactura(textoFactura);
  if (textoFactura === null && correo.adjuntos?.some((a) => /factura/i.test(a))) faltantes.push('factura.txt');

  return {
    correo: { id: correo.id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha },
    solicitud,
    cotizacion: textoCot === null ? null : parsearCotizacion(textoCot),
    aprobacion,
    factura,
    faltantes,
  };
}

/** Fecha local escrita en el correo (AAAA-MM-DD), sin convertir zona horaria. */
export const fechaLocal = (iso: string) => soloFecha(iso);
