import { z } from 'zod';
import { consultarMaestro, MAESTROS, resumenCasos, resumenControl } from '../application/consultas.js';
import { construirOrdenCaso, crearOrdenCaso, generarEvidenciaCaso, leerPaqueteCaso, validarCaso } from '../application/ordenes.js';
import { ok, seguro } from '../application/resultado.js';
import { entornoDe } from '../data.js';
import type { ToolDef } from './types.js';

/**
 * Herramientas del agente (PRD 6.2). Cada export se publica como `oc_<export>`.
 * Aqui solo viven los contratos (descripcion + esquema zod) y el despacho; la logica esta en `application/`.
 *
 * Contrato: devuelven un string JSON { ok:true, data } | { ok:false, error } y nunca lanzan.
 * Los datos salen siempre de los archivos y maestros del servidor: lo que el modelo envie como
 * `paquete`, `derivados` o `payload` se ignora, de modo que no puede alterar lo validado.
 */

const caso = z.string().describe('Nombre de la carpeta del caso en fixtures/reto-03/solicitudes/, por ejemplo "sol-004"');
const ignorado = (que: string) => `Opcional y ignorado: el servidor vuelve a ${que} desde el origen`;
const objetoLibre = (que: string) => z.record(z.unknown()).optional().describe(ignorado(que));

export const leer_paquete: ToolDef<{ caso: typeof caso }> = {
  description: 'Lee y normaliza el paquete de una solicitud (correo, solicitud, cotizacion, aprobacion y factura si existe). Un adjunto ausente se reporta como null y en "faltantes".',
  args: { caso },
  execute: (args, ctx) => seguro(() => leerPaqueteCaso(ctx, args.caso)),
};

export const validar: ToolDef<{ caso: typeof caso; paquete: ReturnType<typeof objetoLibre> }> = {
  description: 'Aplica los controles RC1-RC10 contra los maestros. Devuelve apta, bloqueos (impiden crear), confirmaciones (requieren confirmacion humana), derivados y si la compra es retroactiva.',
  args: { caso, paquete: objetoLibre('leer el paquete') },
  execute: (args, ctx) => seguro(() => validarCaso(ctx, args.caso)),
};

export const construir_payload: ToolDef<{ caso: typeof caso; paquete: ReturnType<typeof objetoLibre>; derivados: ReturnType<typeof objetoLibre> }> = {
  description: 'Construye el payload de la OC tal como quedaria en SAP y guarda la trazabilidad de cada valor. Solo para solicitudes aptas (sin bloqueos).',
  args: { caso, paquete: objetoLibre('leer el paquete'), derivados: objetoLibre('derivar valores desde los maestros') },
  execute: (args, ctx) => seguro(() => construirOrdenCaso(ctx, args.caso)),
};

export const generar_evidencia: ToolDef<{ caso: typeof caso }> = {
  description: 'Genera la evidencia de aprobacion del lider (aprobacion.txt y aprobacion.pdf con encabezados, cuerpo y sha256) en out/<caso>/.',
  args: { caso },
  execute: (args, ctx) => seguro(() => generarEvidenciaCaso(ctx, args.caso)),
};

export const crear: ToolDef<{ caso: typeof caso; payload: ReturnType<typeof objetoLibre>; confirmado: z.ZodOptional<z.ZodBoolean> }> = {
  description: 'Crea la OC en SAP simulado. Revalida todo antes de crear. Solo con apta=true y, si hay confirmaciones, con confirmado=true despues de que el usuario confirme explicitamente en el chat. Crear dos veces la misma solicitud devuelve la OC existente.',
  args: {
    caso,
    payload: objetoLibre('construir el payload'),
    confirmado: z.boolean().optional().describe('true solo si el usuario acaba de confirmar explicitamente las confirmaciones mostradas'),
  },
  execute: (args, ctx) => seguro(() => crearOrdenCaso(ctx, args.caso, args.confirmado === true)),
};

// ── Consultas de solo lectura: permiten responder preguntas sin inventar datos ──

export const listar_casos: ToolDef<Record<string, never>> = {
  description: 'Lista todas las solicitudes disponibles con su estado actual (apta, requiere confirmacion, bloqueada, creada), proveedor, valor y numero de OC si existe. Usar cuando el usuario no indica una solicitud o pide un panorama general.',
  args: {},
  execute: (_args, ctx) => seguro(async () => ok(await resumenCasos(entornoDe(ctx.directory)))),
};

export const consultar_maestro: ToolDef<{ maestro: z.ZodEnum<['proveedores', 'centros_costo', 'indicadores_iva', 'condiciones_pago']>; buscar: z.ZodOptional<z.ZodString> }> = {
  description: 'Consulta un maestro de referencia (proveedores, centros de costo con subareas y aprobadores con tope, indicadores de IVA, condiciones de pago). Usar para responder preguntas como "quien puede aprobar en CC-2020" o "que condicion de pago es Z030".',
  args: {
    maestro: z.enum(MAESTROS).describe('Cual maestro consultar'),
    buscar: z.string().max(80).optional().describe('Texto opcional para filtrar (nombre, NIT, codigo, email)'),
  },
  execute: (args, ctx) => seguro(async () => ok(await consultarMaestro(entornoDe(ctx.directory), args.maestro, args.buscar))),
};

export const resumen_control: ToolDef<Record<string, never>> = {
  description: 'Resume el registro de control (out/control.csv): intentos por resultado, OC creadas y porcentaje de OC retroactivas. Usar para preguntas de medicion, auditoria o "que se ha hecho hasta ahora".',
  args: {},
  execute: (_args, ctx) => seguro(async () => ok(await resumenControl(entornoDe(ctx.directory)))),
};
