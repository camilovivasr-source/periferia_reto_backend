import path from 'node:path';
import { z } from 'zod';
import type { ToolContext, ToolDef } from './types.js';
import { DatosError, cargarMaestros, entornoDe, leerPaquete, validarNombreCaso } from '../domain/data.js';
import { validar as aplicarReglas } from '../domain/rules.js';
import { PayloadError, construirPayload, huellaConfirmacion } from '../domain/payload.js';
import { contenidoEvidencia, generarPdf, hashEvidencia } from '../domain/evidence.js';
import { SapMock } from '../sap/mock.js';
import { escribirArchivo, registrarControl } from '../out.js';
import type { OrdenCompra } from '../domain/types.js';
import { resumenCasos, resumenControl } from '../domain/casos.js';
import { normalizarTexto } from '../domain/util.js';

/**
 * Herramientas del agente (PRD 6.2). Cada export se publica como `oc_<export>`.
 * Contrato: devuelven un string JSON { ok:true, data } | { ok:false, error } y nunca lanzan.
 * Los datos salen siempre de los archivos y maestros del servidor: lo que el modelo envie como
 * `paquete`, `derivados` o `payload` se ignora, de modo que no puede alterar lo validado.
 */

const caso = z.string().describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo "sol-004"');
const ignorado = (que: string) => `Opcional y ignorado: el servidor vuelve a ${que} desde el origen`;

const ok = (data: unknown) => JSON.stringify({ ok: true, data });
const fallo = (error: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ok: false, error, ...extra });

async function seguro(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DatosError || e instanceof PayloadError) return fallo(e.message);
    return fallo(`Error tecnico inesperado: ${e instanceof Error ? e.message : 'desconocido'}. No es un rechazo de negocio.`);
  }
}

/** Carga paquete, maestros y validacion con la unica implementacion de reglas. */
async function preparar(ctx: ToolContext, nombre: string) {
  const env = entornoDe(ctx.directory);
  validarNombreCaso(nombre);
  const [paquete, maestros] = await Promise.all([leerPaquete(env, nombre), cargarMaestros(env)]);
  return { env, paquete, maestros, validacion: aplicarReglas(paquete, maestros) };
}

const rel = (ctx: ToolContext, ruta: string) => path.relative(ctx.directory, ruta).split(path.sep).join('/');

export const leer_paquete: ToolDef<{ caso: typeof caso }> = {
  description: 'Lee y normaliza el paquete de una solicitud (correo, solicitud, cotizacion, aprobacion y factura si existe). Un adjunto ausente se reporta como null y en "faltantes".',
  args: { caso },
  execute: (args, ctx) =>
    seguro(async () => {
      const env = entornoDe(ctx.directory);
      return ok(await leerPaquete(env, args.caso));
    }),
};

export const validar: ToolDef<{ caso: typeof caso; paquete: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>> }> = {
  description: 'Aplica los controles RC1-RC10 contra los maestros. Devuelve apta, bloqueos (impiden crear), confirmaciones (requieren confirmacion humana), derivados y si la compra es retroactiva.',
  args: { caso, paquete: z.record(z.unknown()).optional().describe(ignorado('leer el paquete')) },
  execute: (args, ctx) =>
    seguro(async () => {
      const { paquete, maestros, validacion } = await preparar(ctx, args.caso);
      let huella: string | undefined;
      if (validacion.apta) {
        huella = huellaConfirmacion(construirPayload(paquete, maestros, validacion).payload, validacion);
        if (validacion.confirmaciones.length) ctx.confirmacion?.registrar(args.caso, huella, validacion.confirmaciones);
      }
      return ok({ caso: args.caso, solicitud_id: paquete.solicitud.solicitud_id, ...validacion, requiere_confirmacion: validacion.apta && validacion.confirmaciones.length > 0, huella });
    }),
};

export const construir_payload: ToolDef<{ caso: typeof caso; paquete: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>; derivados: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>> }> = {
  description: 'Construye el payload de la OC tal como quedaria en SAP y guarda la trazabilidad de cada valor. Solo para solicitudes aptas (sin bloqueos).',
  args: {
    caso,
    paquete: z.record(z.unknown()).optional().describe(ignorado('leer el paquete')),
    derivados: z.record(z.unknown()).optional().describe(ignorado('derivar valores desde los maestros')),
  },
  execute: (args, ctx) =>
    seguro(async () => {
      const { env, paquete, maestros, validacion } = await preparar(ctx, args.caso);
      if (!validacion.apta) return fallo('No se construye el payload: la solicitud tiene bloqueos.', { bloqueos: validacion.bloqueos });
      const { payload, trazabilidad } = construirPayload(paquete, maestros, validacion);
      const ruta = path.join(env.outDir, args.caso, 'trazabilidad.json');
      await escribirArchivo(ruta, JSON.stringify(trazabilidad, null, 2));
      return ok({ payload, trazabilidad_ruta: rel(ctx, ruta), requiere_confirmacion: validacion.confirmaciones.length > 0, confirmaciones: validacion.confirmaciones });
    }),
};

async function escribirEvidencia(ctx: ToolContext, nombre: string) {
  const env = entornoDe(ctx.directory);
  const paquete = await leerPaquete(env, nombre);
  if (!paquete.aprobacion) throw new DatosError('No hay correo de aprobacion para generar la evidencia.');
  const contenido = contenidoEvidencia(paquete);
  const sha256 = hashEvidencia(paquete);
  const base = path.join(env.outDir, nombre);
  await escribirArchivo(path.join(base, 'aprobacion.txt'), `${contenido}\n\n---\nsha256 del contenido anterior: ${sha256}\n`);
  await escribirArchivo(path.join(base, 'aprobacion.pdf'), generarPdf([...contenido.split('\n'), '', `sha256: ${sha256}`]));
  return { ruta: rel(ctx, path.join(base, 'aprobacion.txt')), ruta_pdf: rel(ctx, path.join(base, 'aprobacion.pdf')), sha256 };
}

export const generar_evidencia: ToolDef<{ caso: typeof caso }> = {
  description: 'Genera la evidencia de aprobacion del lider (aprobacion.txt y aprobacion.pdf con encabezados, cuerpo y sha256) en out/<caso>/.',
  args: { caso },
  execute: (args, ctx) => seguro(async () => ok(await escribirEvidencia(ctx, args.caso))),
};

export const crear: ToolDef<{ caso: typeof caso; payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>; confirmado: z.ZodOptional<z.ZodBoolean> }> = {
  description: 'Crea la OC en SAP simulado. Revalida todo antes de crear. Solo con apta=true y, si hay confirmaciones, con confirmado=true despues de que el usuario confirme explicitamente en el chat. Crear dos veces la misma solicitud devuelve la OC existente.',
  args: {
    caso,
    payload: z.record(z.unknown()).optional().describe(ignorado('construir el payload')),
    confirmado: z.boolean().optional().describe('true solo si el usuario acaba de confirmar explicitamente las confirmaciones mostradas'),
  },
  execute: (args, ctx) =>
    seguro(async () => {
      const { env, paquete, maestros, validacion } = await preparar(ctx, args.caso);
      const id = paquete.solicitud.solicitud_id;
      const codigos = (xs: { codigo: string }[]) => xs.map((x) => x.codigo);
      const fila = { solicitud_id: id, retroactiva: validacion.retroactiva, bloqueos: codigos(validacion.bloqueos), confirmaciones: codigos(validacion.confirmaciones) };

      if (!validacion.apta) {
        await registrarControl(env.outDir, { ...fila, resultado: 'BLOQUEADA', numero_oc: null });
        return fallo('No se crea la OC: hay controles bloqueantes. Ninguna confirmacion los salta.', { bloqueos: validacion.bloqueos, accion_sugerida: 'Corregir lo indicado con el solicitante o el lider y volver a procesar.' });
      }
      const sap = new SapMock(env);
      const existente = await sap.buscarOrdenPorReferencia(id);
      if (existente) {
        await registrarControl(env.outDir, { ...fila, resultado: 'CREADA_IDEMPOTENTE', numero_oc: existente.numero_oc });
        return ok({ numero_oc: existente.numero_oc, fecha: existente.fecha, idempotente: true });
      }

      const { payload: base } = construirPayload(paquete, maestros, validacion);
      const huella = huellaConfirmacion(base, validacion);
      let payload: OrdenCompra = base;
      if (validacion.confirmaciones.length) {
        if (!args.confirmado || !ctx.confirmacion?.concedida(args.caso, huella)) {
          ctx.confirmacion?.registrar(args.caso, huella, validacion.confirmaciones);
          await registrarControl(env.outDir, { ...fila, resultado: 'PENDIENTE_CONFIRMACION', numero_oc: null });
          return fallo('Falta la confirmacion humana explicita. Muestre las confirmaciones al usuario y espere su respuesta en el chat.', { requiere_confirmacion: true, confirmaciones: validacion.confirmaciones });
        }
        const quien = ctx.actor ?? 'analista-administrativa';
        payload = { ...base, excepciones: base.excepciones.map((e) => ({ ...e, confirmado_por: quien })) };
      }

      await escribirEvidencia(ctx, args.caso);
      const { numero_oc, fecha } = await sap.crearOrden(payload);
      ctx.confirmacion?.consumir(args.caso);
      await registrarControl(env.outDir, { ...fila, resultado: 'CREADA', numero_oc });
      return ok({ numero_oc, fecha, idempotente: false, retroactiva: validacion.retroactiva, evidencia: rel(ctx, path.join(env.outDir, args.caso, 'aprobacion.txt')) });
    }),
};

// ── Herramientas de consulta (solo lectura): permiten responder preguntas sin inventar datos ──

export const listar_casos: ToolDef<Record<string, never>> = {
  description: 'Lista todas las solicitudes disponibles con su estado actual (apta, requiere confirmacion, bloqueada, creada), proveedor, valor y numero de OC si existe. Usar cuando el usuario no indica una solicitud o pide un panorama general.',
  args: {},
  execute: (_args, ctx) => seguro(async () => ok(await resumenCasos(entornoDe(ctx.directory)))),
};

const MAESTROS = ['proveedores', 'centros_costo', 'indicadores_iva', 'condiciones_pago'] as const;
export const consultar_maestro: ToolDef<{ maestro: z.ZodEnum<['proveedores', 'centros_costo', 'indicadores_iva', 'condiciones_pago']>; buscar: z.ZodOptional<z.ZodString> }> = {
  description: 'Consulta un maestro de referencia (proveedores, centros de costo con subareas y aprobadores con tope, indicadores de IVA, condiciones de pago). Usar para responder preguntas como "quien puede aprobar en CC-2020" o "que condicion de pago es Z030".',
  args: {
    maestro: z.enum(MAESTROS).describe('Cual maestro consultar'),
    buscar: z.string().max(80).optional().describe('Texto opcional para filtrar (nombre, NIT, codigo, email)'),
  },
  execute: (args, ctx) =>
    seguro(async () => {
      const m = await cargarMaestros(entornoDe(ctx.directory));
      const filas: unknown[] = { proveedores: m.proveedores, centros_costo: m.centros, indicadores_iva: m.indicadoresIva, condiciones_pago: m.condicionesPago }[args.maestro];
      const q = args.buscar ? normalizarTexto(args.buscar) : '';
      const hallados = q ? filas.filter((f) => normalizarTexto(JSON.stringify(f)).includes(q)) : filas;
      return ok({ maestro: args.maestro, total: hallados.length, filas: hallados.slice(0, 20) });
    }),
};

export const resumen_control: ToolDef<Record<string, never>> = {
  description: 'Resume el registro de control (out/control.csv): intentos por resultado, OC creadas y porcentaje de OC retroactivas. Usar para preguntas de medicion, auditoria o "que se ha hecho hasta ahora".',
  args: {},
  execute: (_args, ctx) => seguro(async () => ok(await resumenControl(entornoDe(ctx.directory)))),
};
