import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Entorno } from '../../data.js';
import { cargarUniverso, porcentaje } from './casos.js';

export type FilaBitacora = { solicitud_id: string; resultado: string; numero_oc: string; retroactiva: boolean; bloqueos: string[]; confirmaciones: string[]; ts: string };

async function leerBitacora(env: Entorno): Promise<FilaBitacora[]> {
  const texto = await readFile(path.join(env.outDir, 'control.csv'), 'utf8').catch(() => '');
  return texto
    .trim()
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((linea) => {
      const c = linea.split(',');
      return { solicitud_id: c[0], resultado: c[1], numero_oc: c[2], retroactiva: c[3] === 'true', bloqueos: c[4] ? c[4].split('|') : [], confirmaciones: c[5] ? c[5].split('|') : [], ts: c[6] };
    });
}

/** Panel de control: KPIs de la cartera, reglas que mas frenan y bitacora de intentos (control.csv). */
export async function panelControl(env: Entorno, minutosManualesPorOc: number) {
  const { casos, conError } = await cargarUniverso(env);
  const bitacora = await leerBitacora(env);
  const creadas = casos.filter((c) => c.oc);
  const estado = (c: (typeof casos)[number]) => (c.oc ? 'CREADA' : !c.validacion.apta ? 'BLOQUEADA' : c.validacion.confirmaciones.length ? 'REQUIERE_CONFIRMACION' : 'APTA');
  const porEstado: Record<string, number> = { CREADA: 0, APTA: 0, REQUIERE_CONFIRMACION: 0, BLOQUEADA: 0 };
  for (const c of casos) porEstado[estado(c)]++;

  const reglas = new Map<string, { codigo: string; regla: string; bloqueos: number; confirmaciones: number }>();
  for (const c of casos) {
    for (const k of c.validacion.controles) {
      if (k.estado !== 'BLOQUEA' && k.estado !== 'CONFIRMA') continue;
      const r = reglas.get(k.codigo) ?? { codigo: k.codigo, regla: k.regla, bloqueos: 0, confirmaciones: 0 };
      if (k.estado === 'BLOQUEA') r.bloqueos++; else r.confirmaciones++;
      reglas.set(k.codigo, r);
    }
  }
  const sinIntervencion = casos.filter((c) => c.validacion.apta && !c.validacion.confirmaciones.length).length;
  const valorSolicitado = casos.reduce((s, c) => s + c.paquete.solicitud.valor_total, 0);
  const valorComprometido = creadas.reduce((s, c) => s + c.paquete.solicitud.valor_total, 0);

  return {
    kpis: {
      casos: casos.length,
      por_estado: porEstado,
      automatizables_pct: porcentaje(sinIntervencion, casos.length),
      retroactivas: casos.filter((c) => c.validacion.retroactiva).length,
      retroactivas_pct: porcentaje(casos.filter((c) => c.validacion.retroactiva).length, casos.length),
      valor_solicitado: valorSolicitado,
      valor_comprometido: valorComprometido,
      intentos: bitacora.length,
      minutos_ahorrados: creadas.length * minutosManualesPorOc,
      minutos_manuales_por_oc: minutosManualesPorOc,
    },
    reglas: [...reglas.values()].sort((a, b) => b.bloqueos + b.confirmaciones - (a.bloqueos + a.confirmaciones)),
    bitacora: bitacora.slice(-100).reverse(),
    con_error: conError,
  };
}
