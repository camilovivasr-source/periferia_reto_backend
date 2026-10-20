import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cargarMaestros, leerPaquete, listarCasos, type Entorno } from '../data.js';
import { validar } from '../domain/validate.js';
import { normalizarTexto } from '../domain/util.js';
import { SapMock } from '../sap/mock.js';

export type EstadoCaso = 'CREADA' | 'BLOQUEADA' | 'REQUIERE_CONFIRMACION' | 'APTA' | 'ERROR_DATOS';
export type ResumenCaso = {
  caso: string;
  solicitud_id: string | null;
  solicitante: string | null;
  proveedor: string | null;
  descripcion: string | null;
  valor_total: number | null;
  moneda: string | null;
  estado: EstadoCaso;
  retroactiva: boolean;
  bloqueos: string[];
  confirmaciones: string[];
  numero_oc: string | null;
  detalle?: string;
};

/** Vista rapida de todos los casos con la misma validacion que usa el agente (sin escribir nada). */
export async function resumenCasos(env: Entorno): Promise<ResumenCaso[]> {
  const [casos, maestros] = await Promise.all([listarCasos(env), cargarMaestros(env)]);
  const sap = new SapMock(env);
  return Promise.all(
    casos.map(async (caso): Promise<ResumenCaso> => {
      try {
        const p = await leerPaquete(env, caso);
        const v = validar(p, maestros);
        const oc = await sap.buscarOrdenPorReferencia(p.solicitud.solicitud_id);
        const estado: EstadoCaso = oc ? 'CREADA' : !v.apta ? 'BLOQUEADA' : v.confirmaciones.length ? 'REQUIERE_CONFIRMACION' : 'APTA';
        return {
          caso,
          solicitud_id: p.solicitud.solicitud_id,
          solicitante: p.solicitud.solicitante,
          proveedor: p.solicitud.proveedor_nombre,
          descripcion: p.solicitud.descripcion,
          valor_total: p.solicitud.valor_total,
          moneda: p.solicitud.moneda,
          estado,
          retroactiva: v.retroactiva,
          bloqueos: v.bloqueos.map((b) => b.codigo),
          confirmaciones: v.confirmaciones.map((c) => c.codigo),
          numero_oc: oc?.numero_oc ?? null,
        };
      } catch (e) {
        return { caso, solicitud_id: null, solicitante: null, proveedor: null, descripcion: null, valor_total: null, moneda: null, estado: 'ERROR_DATOS', retroactiva: false, bloqueos: [], confirmaciones: [], numero_oc: null, detalle: e instanceof Error ? e.message : 'error de datos' };
      }
    }),
  );
}

type FilaControl = { solicitud_id: string; resultado: string; numero_oc: string; retroactiva: string; bloqueos: string; confirmaciones: string; ts: string };

/** Resume out/control.csv: intentos por resultado, OC creadas y porcentaje de retroactivas (lo que la direccion quiere medir). */
export async function resumenControl(env: Entorno) {
  let texto = '';
  try {
    texto = await readFile(path.join(env.outDir, 'control.csv'), 'utf8');
  } catch {
    /* aun no hay intentos */
  }
  const filas: FilaControl[] = texto
    .trim()
    .split('\n')
    .slice(1)
    .filter(Boolean)
    .map((l) => {
      const c = l.split(',');
      return { solicitud_id: c[0], resultado: c[1], numero_oc: c[2], retroactiva: c[3], bloqueos: c[4], confirmaciones: c[5], ts: c[6] };
    });
  const porResultado: Record<string, number> = {};
  for (const f of filas) porResultado[f.resultado] = (porResultado[f.resultado] ?? 0) + 1;
  const creadas = new Map<string, FilaControl>();
  for (const f of filas) if (f.resultado === 'CREADA') creadas.set(f.solicitud_id, f);
  const retro = [...creadas.values()].filter((f) => f.retroactiva === 'true');
  return {
    intentos: filas.length,
    por_resultado: porResultado,
    oc_creadas: [...creadas.values()].map((f) => ({ solicitud_id: f.solicitud_id, numero_oc: f.numero_oc, retroactiva: f.retroactiva === 'true', confirmaciones: f.confirmaciones ? f.confirmaciones.split('|') : [] })),
    oc_retroactivas: retro.length,
    porcentaje_retroactivas: creadas.size ? Math.round((retro.length / creadas.size) * 100) : 0,
    ruta: 'out/control.csv',
  };
}

export const MAESTROS = ['proveedores', 'centros_costo', 'indicadores_iva', 'condiciones_pago'] as const;
export type NombreMaestro = (typeof MAESTROS)[number];

/** Consulta de solo lectura a un maestro, con filtro de texto opcional (maximo 20 filas). */
export async function consultarMaestro(env: Entorno, maestro: NombreMaestro, buscar?: string) {
  const m = await cargarMaestros(env);
  const filas: unknown[] = { proveedores: m.proveedores, centros_costo: m.centros, indicadores_iva: m.indicadoresIva, condiciones_pago: m.condicionesPago }[maestro];
  const q = buscar ? normalizarTexto(buscar) : '';
  const hallados = q ? filas.filter((f) => normalizarTexto(JSON.stringify(f)).includes(q)) : filas;
  return { maestro, total: hallados.length, filas: hallados.slice(0, 20) };
}
