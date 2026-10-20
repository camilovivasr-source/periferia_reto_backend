import type { Entorno } from '../../data.js';
import { cargarUniverso } from './casos.js';

type Semaforo = 'ok' | 'alerta' | 'sin_dato';
const TOLERANCIA = 0.02;
const difPct = (valor: number | null | undefined, referencia: number): number | null => (valor == null ? null : Math.round(((valor - referencia) / referencia) * 10000) / 100);
const semaforo = (d: number | null): Semaforo => (d === null ? 'sin_dato' : Math.abs(d) <= TOLERANCIA * 100 ? 'ok' : 'alerta');

/** Conciliacion documental: solicitud vs cotizacion vs factura, y coherencia del IVA de la cotizacion con el maestro. */
export async function conciliacion(env: Entorno) {
  const { casos, maestros } = await cargarUniverso(env);
  const filas = casos.map(({ caso, paquete: p, validacion }) => {
    const total = p.solicitud.valor_total;
    const indicador = p.solicitud.indicador_iva || validacion.derivados.indicador_iva;
    const tasa = maestros.indicadoresIva.find((i) => i.codigo === indicador)?.tasa;
    const c = p.cotizacion;
    const tasaImplicita = c?.base_gravable && c.iva != null ? Math.round((c.iva / c.base_gravable) * 10000) / 10000 : null;
    const dCot = difPct(c?.total, total);
    const dFac = difPct(p.factura?.total, total);
    return {
      caso,
      solicitud_id: p.solicitud.solicitud_id,
      proveedor: p.solicitud.proveedor_nombre,
      moneda: p.solicitud.moneda,
      valor_solicitud: total,
      valor_cotizacion: c?.total ?? null,
      valor_factura: p.factura?.total ?? null,
      diferencia_cotizacion_pct: dCot,
      diferencia_factura_pct: dFac,
      semaforo_cotizacion: semaforo(dCot),
      semaforo_factura: semaforo(dFac),
      base_cotizacion: c?.base_gravable ?? null,
      iva_cotizacion: c?.iva ?? null,
      tasa_iva_cotizacion: tasaImplicita,
      tasa_iva_maestro: tasa ?? null,
      iva_coherente: tasaImplicita === null || tasa === undefined ? null : Math.abs(tasaImplicita - tasa) <= 0.005,
      indicador_iva: indicador ?? null,
    };
  });
  return {
    tolerancia_pct: TOLERANCIA * 100,
    resumen: {
      casos: filas.length,
      en_tolerancia: filas.filter((f) => f.semaforo_cotizacion === 'ok').length,
      con_alerta: filas.filter((f) => f.semaforo_cotizacion === 'alerta' || f.semaforo_factura === 'alerta').length,
      sin_cotizacion: filas.filter((f) => f.semaforo_cotizacion === 'sin_dato').length,
    },
    filas,
  };
}
