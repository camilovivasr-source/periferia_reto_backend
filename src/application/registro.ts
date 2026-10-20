import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { cargarMaestros, DatosError, leerPaquete, listarCasos, type Entorno } from '../data.js';
import { validar } from '../domain/validate.js';
import { SolicitudSchema } from '../schemas.js';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'formato AAAA-MM-DD');
const MAX_NUEVAS = 50;

/** Solicitud nueva tal como la captura la UI. Se guarda con el mismo formato normalizado de los fixtures. */
export const NuevaSolicitudSchema = z
  .object({
    solicitud: SolicitudSchema.omit({ solicitud_id: true }).extend({ solicitante_email: z.string().email().max(80) }),
    cotizacion: z.object({ total: z.number().positive(), fecha: fecha.optional(), referencia: z.string().max(40).optional() }).strict().optional(),
    aprobacion: z.object({ de: z.string().email().max(80), fecha: fecha, cuerpo: z.string().min(1).max(1000) }).strict().optional(),
    factura: z.object({ numero: z.string().min(1).max(40), fecha: fecha, total: z.number().positive() }).strict().optional(),
  })
  .strict();
export type NuevaSolicitud = z.infer<typeof NuevaSolicitudSchema>;

const cop = (n: number) => n.toLocaleString('es-CO');

/** Texto de cotizacion en el formato que entiende el parser (el mismo de los fixtures). */
function textoCotizacion(n: NuevaSolicitud, ref: string): string {
  const s = n.solicitud;
  const c = n.cotizacion!;
  return [
    `COTIZACIÓN ${c.referencia ?? ref}`,
    `Fecha: ${c.fecha ?? s.fecha_solicitud}`,
    `Proveedor: ${s.proveedor_nombre}`,
    `NIT: ${s.proveedor_nit ?? ''}`,
    '',
    'ÍTEMS',
    `1. ${s.descripcion} | Cantidad: ${s.cantidad} | Precio unitario: ${s.moneda} ${cop(s.valor_unitario)} | Subtotal: ${s.moneda} ${cop(c.total)}`,
    '',
    `TOTAL: ${s.moneda} ${cop(c.total)}`,
  ].join('\n');
}

function textoFactura(n: NuevaSolicitud): string {
  const f = n.factura!;
  return [`FACTURA ELECTRÓNICA DE VENTA No. ${f.numero}`, `Fecha de emisión: ${f.fecha}`, `Vendedor: ${n.solicitud.proveedor_nombre}`, '', `TOTAL: ${n.solicitud.moneda} ${cop(f.total)}`].join('\n');
}

/**
 * Registra una solicitud nueva en SOLICITUDES_DIR (nunca en fixtures/, que es de solo lectura) con el siguiente
 * nombre libre (sol-007, sol-008…) y la valida con las mismas reglas. Luego el agente la procesa como cualquier otra.
 */
export async function registrarSolicitud(env: Entorno, n: NuevaSolicitud) {
  const existentes = await listarCasos(env);
  const propias = (await readdir(env.solicitudesDir).catch(() => [])).length;
  if (propias >= MAX_NUEVAS) throw new DatosError(`Se alcanzó el máximo de ${MAX_NUEVAS} solicitudes nuevas en esta instancia.`);
  const siguiente = Math.max(0, ...existentes.map((c) => Number(/^sol-(\d+)$/.exec(c)?.[1] ?? 0))) + 1;
  const caso = `sol-${String(siguiente).padStart(3, '0')}`;
  const anio = n.solicitud.fecha_solicitud.slice(0, 4);
  const solicitudId = `SOL-${anio}-${String(siguiente).padStart(3, '0')}`;
  const { solicitante_email, ...solicitud } = n.solicitud;

  const dir = path.join(env.solicitudesDir, caso);
  await mkdir(dir, { recursive: true });
  const adjuntos = ['solicitud.xlsx', ...(n.cotizacion ? ['cotizacion.pdf'] : []), ...(n.aprobacion ? ['aprobacion.eml'] : []), ...(n.factura ? ['factura.pdf'] : [])];
  const escribir = (archivo: string, contenido: string) => writeFile(path.join(dir, archivo), contenido, 'utf8');
  await escribir('correo.json', JSON.stringify({ id: `${caso}-correo`, de: solicitante_email, para: 'compras@periferia-ficticia.com', asunto: `Solicitud de orden de compra ${solicitudId} - ${solicitud.descripcion}`.slice(0, 90), fecha: `${solicitud.fecha_solicitud}T09:00:00-05:00`, cuerpo: 'Registrada desde la interfaz del agente.', adjuntos }, null, 2));
  await escribir('solicitud.json', JSON.stringify({ solicitud_id: solicitudId, ...solicitud }, null, 2));
  if (n.cotizacion) await escribir('cotizacion.txt', textoCotizacion(n, `COT-${caso.toUpperCase()}`));
  if (n.aprobacion) await escribir('aprobacion.json', JSON.stringify({ de: n.aprobacion.de, para: solicitante_email, cc: ['compras@periferia-ficticia.com'], fecha: `${n.aprobacion.fecha}T09:00:00-05:00`, asunto: `RE: Solicitud de orden de compra ${solicitudId}`, cuerpo: n.aprobacion.cuerpo }, null, 2));
  if (n.factura) await escribir('factura.txt', textoFactura(n));

  const [paquete, maestros] = await Promise.all([leerPaquete(env, caso), cargarMaestros(env)]);
  const v = validar(paquete, maestros);
  return {
    caso,
    solicitud_id: solicitudId,
    estado: !v.apta ? 'BLOQUEADA' : v.confirmaciones.length ? 'REQUIERE_CONFIRMACION' : 'APTA',
    bloqueos: v.bloqueos,
    confirmaciones: v.confirmaciones,
    faltantes: paquete.faltantes,
  };
}

/** Opciones validas para el formulario de nueva solicitud, tomadas de los maestros. */
export async function opcionesMaestros(env: Entorno) {
  const m = await cargarMaestros(env);
  return {
    centros: m.centros.map((c) => ({ centro_costo: c.centro_costo, nombre: c.nombre ?? c.centro_costo, subareas: c.subareas, aprobadores: c.aprobadores.map((a) => a.email) })),
    proveedores: m.proveedores.map((p) => ({ nombre: p.nombre, nit: p.nit, activo: p.activo })),
    indicadores_iva: m.indicadoresIva.map((i) => ({ codigo: i.codigo, descripcion: i.descripcion })),
    condiciones_pago: m.condicionesPago.map((c) => ({ codigo: c.codigo, descripcion: c.descripcion })),
  };
}
