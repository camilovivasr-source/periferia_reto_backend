import { z } from 'zod';
import { DatosError, leerPaquete, cargarMaestros, validarNombreCaso, type Entorno } from '../../data.js';
import { validar } from '../../domain/validate.js';
import type { Control, Paquete } from '../../schemas.js';

/** Cambios hipoteticos sobre un caso. Todo ocurre en memoria: nunca se escribe en fixtures ni en out/. */
export const CambiosSchema = z
  .object({
    valor_total: z.number().positive().optional(),
    cantidad: z.number().positive().optional(),
    valor_unitario: z.number().nonnegative().optional(),
    centro_costo: z.string().min(1).max(20).optional(),
    subarea: z.string().min(1).max(60).optional(),
    proveedor_nit: z.string().max(20).optional(),
    indicador_iva: z.string().max(4).nullable().optional(),
    condiciones_pago: z.string().max(6).nullable().optional(),
    fecha_solicitud: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    aprobador_email: z.string().email().max(80).optional(),
    aprobacion_aprobada: z.boolean().optional(),
    cotizacion_total: z.number().nonnegative().optional(),
    quitar_cotizacion: z.boolean().optional(),
    quitar_factura: z.boolean().optional(),
    fecha_factura: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();
export type Cambios = z.infer<typeof CambiosSchema>;

function aplicar(original: Paquete, c: Cambios): Paquete {
  const p = structuredClone(original);
  const s = p.solicitud;
  if (c.valor_total !== undefined) s.valor_total = c.valor_total;
  if (c.cantidad !== undefined) s.cantidad = c.cantidad;
  if (c.valor_unitario !== undefined) s.valor_unitario = c.valor_unitario;
  if (c.centro_costo !== undefined) s.centro_costo = c.centro_costo;
  if (c.subarea !== undefined) s.subarea = c.subarea;
  if (c.proveedor_nit !== undefined) s.proveedor_nit = c.proveedor_nit || undefined;
  if (c.indicador_iva !== undefined) s.indicador_iva = c.indicador_iva ?? undefined;
  if (c.condiciones_pago !== undefined) s.condiciones_pago = c.condiciones_pago ?? undefined;
  if (c.fecha_solicitud !== undefined) s.fecha_solicitud = c.fecha_solicitud;
  if (p.aprobacion) {
    if (c.aprobador_email !== undefined) p.aprobacion.de = c.aprobador_email.toLowerCase();
    if (c.aprobacion_aprobada !== undefined) p.aprobacion.aprobado = c.aprobacion_aprobada;
  }
  if (c.quitar_cotizacion) p.cotizacion = null;
  else if (p.cotizacion && c.cotizacion_total !== undefined) p.cotizacion.total = c.cotizacion_total;
  if (c.quitar_factura) p.factura = null;
  else if (c.fecha_factura !== undefined) p.factura = { numero: p.factura?.numero ?? null, fecha: c.fecha_factura, total: p.factura?.total ?? null, texto: p.factura?.texto ?? '' };
  return p;
}

const resumirControl = (k: Control) => ({ estado: k.estado, detalle: k.detalle });

/** "Que pasaria si...": revalida un caso con cambios hipoteticos y muestra que controles cambian. */
export async function simular(env: Entorno, caso: string, cambios: Cambios) {
  validarNombreCaso(caso);
  const [paquete, maestros] = await Promise.all([leerPaquete(env, caso), cargarMaestros(env)]);
  if (!Object.keys(cambios).length) throw new DatosError('Indica al menos un cambio para simular.');
  const original = validar(paquete, maestros);
  const simulada = validar(aplicar(paquete, cambios), maestros);
  const antes = new Map(original.controles.map((k) => [k.codigo, k]));
  const diferencias = simulada.controles
    .filter((k) => antes.get(k.codigo)?.estado !== k.estado || antes.get(k.codigo)?.detalle !== k.detalle)
    .map((k) => ({ codigo: k.codigo, regla: k.regla, antes: resumirControl(antes.get(k.codigo)!), despues: resumirControl(k) }));
  const veredicto = (v: typeof original) => (!v.apta ? 'NO_APTA' : v.confirmaciones.length ? 'APTA_CON_CONFIRMACION' : 'APTA');
  return { caso, cambios, veredicto_original: veredicto(original), veredicto_simulado: veredicto(simulada), original, simulada, diferencias };
}

/** Valores actuales de un caso y las opciones validas de los maestros: es lo que el formulario del simulador precarga. */
export async function detalleCaso(env: Entorno, caso: string) {
  validarNombreCaso(caso);
  const [paquete, maestros] = await Promise.all([leerPaquete(env, caso), cargarMaestros(env)]);
  const s = paquete.solicitud;
  return {
    caso,
    valores: {
      valor_total: s.valor_total,
      cantidad: s.cantidad,
      valor_unitario: s.valor_unitario,
      centro_costo: s.centro_costo,
      subarea: s.subarea,
      proveedor_nit: s.proveedor_nit ?? '',
      indicador_iva: s.indicador_iva ?? null,
      condiciones_pago: s.condiciones_pago ?? null,
      fecha_solicitud: s.fecha_solicitud,
      aprobador_email: paquete.aprobacion?.de ?? null,
      aprobacion_aprobada: paquete.aprobacion?.aprobado ?? null,
      cotizacion_total: paquete.cotizacion?.total ?? null,
      hay_cotizacion: !!paquete.cotizacion,
      hay_factura: !!paquete.factura,
      fecha_factura: paquete.factura?.fecha ?? null,
    },
    opciones: {
      centros: maestros.centros.map((c) => ({ centro_costo: c.centro_costo, subareas: c.subareas, aprobadores: c.aprobadores.map((a) => a.email) })),
      indicadores_iva: maestros.indicadoresIva.map((i) => ({ codigo: i.codigo, descripcion: i.descripcion })),
      condiciones_pago: maestros.condicionesPago.map((c) => ({ codigo: c.codigo, descripcion: c.descripcion })),
    },
  };
}
