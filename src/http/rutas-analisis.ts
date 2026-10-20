import { z } from 'zod';
import { autoridad, CambiosSchema, conciliacion, desvioProceso, detalleCaso, exportarCargaSap, panelControl, simular } from '../application/analisis/index.js';
import type { Config } from '../config.js';
import { entornoDe } from '../data.js';
import { leerJson } from './cuerpo.js';
import { adjunto, json, type Ruta } from './tipos.js';

const simulacionSchema = z.object({ caso: z.string().regex(/^sol-\d{3}$/), cambios: CambiosSchema }).strict();
const consultaSchema = z.object({ centro: z.string().regex(/^[A-Za-z0-9-]{2,20}$/), monto: z.coerce.number().positive().max(1e13) });

/** Rutas de la pestana de analisis: solo lectura (la simulacion ocurre en memoria). */
export function rutasAnalisis(config: Config): Ruta[] {
  const env = entornoDe(config.directory, { ...process.env, FIXTURES_DIR: config.fixturesDir, OUT_DIR: config.outDir });
  return [
    { metodo: 'GET', patron: /^\/api\/analisis\/panel$/, manejar: async ({ res }) => json(res, 200, await panelControl(env, config.minutosManualesPorOc)) },
    { metodo: 'GET', patron: /^\/api\/analisis\/desvio$/, manejar: async ({ res }) => json(res, 200, await desvioProceso(env)) },
    { metodo: 'GET', patron: /^\/api\/analisis\/conciliacion$/, manejar: async ({ res }) => json(res, 200, await conciliacion(env)) },
    {
      metodo: 'GET',
      patron: /^\/api\/analisis\/autoridad$/,
      manejar: async ({ res, url }) => {
        const hayConsulta = url.searchParams.has('centro') || url.searchParams.has('monto');
        const consulta = hayConsulta ? consultaSchema.parse({ centro: url.searchParams.get('centro'), monto: url.searchParams.get('monto') }) : undefined;
        json(res, 200, await autoridad(env, consulta));
      },
    },
    { metodo: 'GET', patron: /^\/api\/analisis\/caso\/(sol-\d{3})$/, manejar: async ({ res, coincidencia }) => json(res, 200, await detalleCaso(env, coincidencia[1])) },
    {
      metodo: 'POST',
      patron: /^\/api\/analisis\/simular$/,
      manejar: async ({ req, res }) => {
        const { caso, cambios } = simulacionSchema.parse(await leerJson(req));
        json(res, 200, await simular(env, caso, cambios));
      },
    },
    {
      metodo: 'GET',
      patron: /^\/api\/exportar\/carga-sap\.csv$/,
      manejar: async ({ res }) => adjunto(res, 'text/csv; charset=utf-8', 'carga-masiva-sap.csv', (await exportarCargaSap(env)).csv),
    },
  ];
}
