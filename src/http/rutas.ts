import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import type { Agente } from '../agent/loop.js';
import type { EventoAgente } from '../agent/tipos.js';
import { resumenCasos } from '../application/consultas.js';
import type { Config } from '../config.js';
import { entornoDe } from '../data.js';
import { CuerpoGrande, leerJson } from './cuerpo.js';

const chatSchema = z
  .object({
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'sessionId invalido (8-64 caracteres alfanumericos)'),
    message: z.string().trim().min(1, 'message vacio').max(4000),
  })
  .strict();

const TIPOS: Record<string, string> = { pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8', csv: 'text/csv; charset=utf-8' };

/** Contexto de una peticion: lo que cada ruta necesita para responder. */
type Peticion = { req: IncomingMessage; res: ServerResponse; url: URL; requestId: string; coincidencia: RegExpExecArray };
type Ruta = { metodo: 'GET' | 'POST'; patron: RegExp; manejar(p: Peticion): Promise<void> };

export function crearManejador(config: Config, agente: Agente) {
  const env = entornoDe(config.directory, { FIXTURES_DIR: config.fixturesDir, OUT_DIR: config.outDir });

  const json = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };

  /** Descarga de un archivo de out/ con nombre de la lista cerrada de las rutas (nunca una ruta arbitraria). */
  const descargar = async ({ res, requestId }: Peticion, ruta: string, nombre: string) => {
    try {
      const cuerpo = await readFile(ruta);
      res.writeHead(200, { 'Content-Type': TIPOS[nombre.split('.').pop()!], 'Content-Disposition': `attachment; filename="${nombre}"`, 'Cache-Control': 'no-store' });
      res.end(cuerpo);
    } catch {
      json(res, 404, { error: 'Archivo aun no generado: procese la solicitud primero.', requestId });
    }
  };

  const rutas: Ruta[] = [
    { metodo: 'GET', patron: /^\/(?:api\/)?health$/, manejar: async ({ res }) => json(res, 200, { ok: true, ...agente.proveedor }) },
    {
      metodo: 'GET',
      patron: /^\/api\/casos$/,
      manejar: async ({ res }) => {
        const detalle = await resumenCasos(env);
        json(res, 200, { casos: detalle.map((c) => c.caso), detalle });
      },
    },
    {
      metodo: 'GET',
      patron: /^\/api\/archivos\/(sol-\d{3})\/(aprobacion\.pdf|aprobacion\.txt|trazabilidad\.json)$/,
      manejar: (p) => descargar(p, path.join(config.outDir, p.coincidencia[1], p.coincidencia[2]), `${p.coincidencia[1]}-${p.coincidencia[2]}`),
    },
    { metodo: 'GET', patron: /^\/api\/control\.csv$/, manejar: (p) => descargar(p, path.join(config.outDir, 'control.csv'), 'control.csv') },
    {
      metodo: 'GET',
      patron: /^\/api\/sessions\/([A-Za-z0-9_-]{8,64})$/,
      manejar: async ({ res, coincidencia, requestId }) => {
        const historial = agente.historial(coincidencia[1]);
        if (historial) json(res, 200, { sessionId: coincidencia[1], historial });
        else json(res, 404, { error: 'Sesion no encontrada', requestId });
      },
    },
    { metodo: 'POST', patron: /^\/api\/chat$/, manejar: (p) => chat(p) },
  ];

  /** Chat: respuesta JSON, o SSE (tool_start / tool_end / complete) si el cliente lo pide. */
  async function chat({ req, res, requestId }: Peticion) {
    const { sessionId, message } = chatSchema.parse(await leerJson(req));
    if (!req.headers.accept?.includes('text/event-stream')) return json(res, 200, await agente.turno(sessionId, message));

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    const emitir = (d: unknown) => !res.destroyed && res.write(`data: ${JSON.stringify(d)}\n\n`);
    const latido = setInterval(() => !res.destroyed && res.write(': latido\n\n'), 15_000);
    try {
      const r = await agente.turno(sessionId, message, (e: EventoAgente) => emitir(e));
      emitir({ tipo: 'complete', ...r });
    } catch {
      emitir({ tipo: 'error', error: 'Fallo inesperado del agente. Revisa los registros del servidor.', requestId });
    } finally {
      clearInterval(latido);
      res.end();
    }
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      for (const ruta of rutas) {
        const coincidencia = ruta.patron.exec(url.pathname);
        if (ruta.metodo === req.method && coincidencia) return await ruta.manejar({ req, res, url, requestId, coincidencia });
      }
      json(res, 404, { error: 'Ruta no encontrada', requestId });
    } catch (e) {
      if (e instanceof z.ZodError) return json(res, 400, { error: 'Datos no validos', detalles: e.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`), requestId });
      if (e instanceof CuerpoGrande) return json(res, 413, { error: e.message, requestId });
      if (e instanceof SyntaxError) return json(res, 400, { error: 'JSON malformado', requestId });
      console.error(`[${requestId}]`, e instanceof Error ? e.message : e);
      json(res, 500, { error: 'Error interno', requestId });
    }
  };
}
