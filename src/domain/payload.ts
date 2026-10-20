import { OrdenCompraSchema, type Maestros, type OrdenCompra, type Paquete, type Trazabilidad, type Validacion } from './types.js';
import { resolverProveedor } from './rules.js';
import { fechaLocal } from './data.js';
import { hashEvidencia } from './evidence.js';
import { jsonEstable, redondear, sha256 } from './util.js';

function unidadDe(p: Paquete): 'UN' | 'H' | 'MES' {
  const texto = p.cotizacion?.items[0]?.descripcion ?? p.solicitud.descripcion;
  if (/\bhoras?\b/i.test(texto)) return 'H';
  if (/\b(mensual|por mes)\b/i.test(texto)) return 'MES';
  return 'UN';
}

export class PayloadError extends Error {}

/**
 * Construye la OC a partir de datos del servidor (nunca del modelo). Cada valor queda trazado a su fuente.
 * Requiere que la validacion no tenga bloqueos.
 */
export function construirPayload(p: Paquete, m: Maestros, v: Validacion): { payload: OrdenCompra; trazabilidad: Trazabilidad } {
  if (!v.apta) throw new PayloadError(`La solicitud no es apta (${v.bloqueos.map((b) => b.codigo).join(', ')}); no se construye payload.`);
  const proveedor = resolverProveedor(p, m);
  if (!proveedor || !p.aprobacion) throw new PayloadError('Faltan proveedor o aprobacion para construir el payload.');
  const s = p.solicitud;
  const iva = s.indicador_iva || v.derivados.indicador_iva;
  const pago = s.condiciones_pago || v.derivados.condiciones_pago;
  const tasa = m.indicadoresIva.find((x) => x.codigo === iva)?.tasa;
  if (!iva || !pago || tasa === undefined) throw new PayloadError('No se pudo resolver el indicador de IVA o las condiciones de pago.');

  const base = redondear(s.valor_total / (1 + tasa), s.moneda === 'COP' ? 0 : 2);
  const descripcion = s.descripcion.length > 40 ? s.descripcion.slice(0, 40).trimEnd() : s.descripcion;
  const t: Trazabilidad = [];
  const origenIva = s.indicador_iva ? 'solicitud' : 'derivado';
  const origenPago = s.condiciones_pago ? 'solicitud' : 'derivado';

  const payload: OrdenCompra = {
    referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion?.referencia ?? null },
    sociedad: '1000',
    organizacion_compras: '1000',
    proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
    moneda: s.moneda,
    condiciones_pago: pago,
    aprobador: { email: p.aprobacion.de, fecha_aprobacion: p.aprobacion.fecha, evidencia_sha256: hashEvidencia(p) },
    posiciones: [
      {
        numero: 10,
        descripcion,
        cantidad: s.cantidad,
        unidad: unidadDe(p),
        precio_unitario: s.valor_unitario,
        precio_incluye_iva: true,
        centro_costo: s.centro_costo,
        subarea: s.subarea,
        indicador_iva: iva,
      },
    ],
    totales: { base, iva: redondear(s.valor_total - base, s.moneda === 'COP' ? 0 : 2), total: s.valor_total },
    excepciones: v.confirmaciones.map((c) => ({ codigo: c.codigo, detalle: c.detalle, confirmado_por: null })),
  };

  t.push(
    { campo: 'referencia.solicitud_id', valor: s.solicitud_id, fuente: 'solicitud' },
    { campo: 'referencia.correo_id', valor: p.correo.id, fuente: 'correo' },
    { campo: 'referencia.cotizacion_ref', valor: payload.referencia.cotizacion_ref, fuente: 'cotizacion' },
    { campo: 'sociedad', valor: '1000', fuente: 'constante', nota: 'PRD 7.4' },
    { campo: 'organizacion_compras', valor: '1000', fuente: 'constante', nota: 'PRD 7.4' },
    { campo: 'proveedor.codigo_sap', valor: proveedor.codigo_sap, fuente: 'maestro.proveedores' },
    { campo: 'proveedor.nit', valor: proveedor.nit, fuente: 'maestro.proveedores' },
    { campo: 'proveedor.nombre', valor: proveedor.nombre, fuente: 'maestro.proveedores' },
    { campo: 'moneda', valor: s.moneda, fuente: 'solicitud' },
    { campo: 'condiciones_pago', valor: pago, fuente: origenPago, nota: origenPago === 'derivado' ? 'condiciones_pago_default del proveedor (maestro.proveedores)' : undefined },
    { campo: 'aprobador.email', valor: p.aprobacion.de, fuente: 'aprobacion' },
    { campo: 'aprobador.fecha_aprobacion', valor: p.aprobacion.fecha, fuente: 'aprobacion' },
    { campo: 'aprobador.evidencia_sha256', valor: payload.aprobador.evidencia_sha256, fuente: 'derivado', nota: 'SHA-256 de encabezados + cuerpo del correo de aprobacion' },
    { campo: 'posiciones[10].descripcion', valor: descripcion, fuente: 'solicitud', nota: s.descripcion.length > 40 ? `truncada a 40 caracteres (original ${s.descripcion.length})` : undefined },
    { campo: 'posiciones[10].cantidad', valor: s.cantidad, fuente: 'solicitud' },
    { campo: 'posiciones[10].unidad', valor: payload.posiciones[0].unidad, fuente: 'derivado', nota: 'inferida del texto de la cotizacion o de la descripcion' },
    { campo: 'posiciones[10].precio_unitario', valor: s.valor_unitario, fuente: 'solicitud', nota: 'IVA incluido segun la cotizacion' },
    { campo: 'posiciones[10].centro_costo', valor: s.centro_costo, fuente: 'solicitud' },
    { campo: 'posiciones[10].subarea', valor: s.subarea, fuente: 'solicitud' },
    { campo: 'posiciones[10].indicador_iva', valor: iva, fuente: origenIva, nota: origenIva === 'derivado' ? 'indicador_iva_default del proveedor (maestro.proveedores), pendiente de confirmacion' : 'validado contra maestro.indicadores-iva' },
    { campo: 'totales.total', valor: s.valor_total, fuente: 'solicitud' },
    { campo: 'totales.base', valor: base, fuente: 'derivado', nota: `total / (1 + ${tasa}) segun maestro.indicadores-iva` },
    { campo: 'totales.iva', valor: payload.totales.iva, fuente: 'derivado' },
    ...payload.excepciones.map((e, i) => ({ campo: `excepciones[${i}]`, valor: e.codigo, fuente: 'derivado' as const, nota: e.detalle })),
  );

  return { payload: OrdenCompraSchema.parse(payload), trazabilidad: t.filter((x) => x.valor !== undefined) };
}

/** Huella de lo que el humano revisa: cambia si cambia cualquier dato del payload o de las confirmaciones. */
export function huellaConfirmacion(payload: OrdenCompra, v: Validacion): string {
  const limpio = { ...payload, excepciones: payload.excepciones.map((e) => ({ ...e, confirmado_por: null })) };
  return sha256(jsonEstable({ payload: limpio, confirmaciones: v.confirmaciones, retroactiva: v.retroactiva })).slice(0, 16);
}

export const fechaAprobacionLocal = (p: Paquete) => (p.aprobacion ? fechaLocal(p.aprobacion.fecha) : null);
