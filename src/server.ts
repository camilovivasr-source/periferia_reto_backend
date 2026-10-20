import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readConfig, type Config } from './config.js';
import { Agente, cargarSistema, type EventoAgente } from './agent/loop.js';
import { PracticaAdapter } from './agent/practice.js';
import { GeminiAdapter, destinoAiStudio, destinoVertex } from './llm/gemini.js';
import type { LlmAdapter } from './llm/adapter.js';
import { readFile } from 'node:fs/promises';
import { entornoDe } from './domain/data.js';
import { resumenCasos } from './domain/casos.js';

const chatSchema = z.object({ sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'sessionId invalido (8-64 caracteres alfanumericos)'), message: z.string().trim().min(1, 'message vacio').max(4000) }).strict();
const MAX_BODY = 16_384;

class CuerpoGrande extends Error {}
async function leerJson(req: IncomingMessage): Promise<unknown> {
  let n = 0;
  const partes: Buffer[] = [];
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > MAX_BODY) throw new CuerpoGrande('Entrada demasiado grande');
    partes.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}

export async function crearAgente(config: Config): Promise<Agente> {
  const llm: LlmAdapter =
    config.mode === 'vertex'
      ? new GeminiAdapter(config.geminiModel, destinoVertex({ project: config.projectId, location: config.vertexLocation }), config.llmTimeoutMs)
      : config.mode === 'gemini'
        ? new GeminiAdapter(config.geminiModel, destinoAiStudio(config.geminiApiKey!), config.llmTimeoutMs)
        : new PracticaAdapter();
  return new Agente({
    llm,
    directory: config.directory,
    sistema: await cargarSistema(config.directory),
    maxIteraciones: config.maxIteraciones,
    maxTokensSesion: config.maxTokensSesion,
    actor: config.actor,
    modo: config.mode === 'practice' ? 'PRACTICA SIN LLM' : 'LLM',
  });
}

export function crearManejador(config: Config, agente: Agente) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const enviar = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && (url.pathname === '/api/health' || url.pathname === '/health')) {
        return enviar(200, { ok: true, ...agente.proveedor });
      }
      if (req.method === 'GET' && url.pathname === '/api/casos') {
        const detalle = await resumenCasos(entornoDe(config.directory, { FIXTURES_DIR: config.fixturesDir, OUT_DIR: config.outDir }));
        return enviar(200, { casos: detalle.map((c) => c.caso), detalle });
      }
      // Descargas de evidencia y control (nombres de archivo en lista cerrada: sin rutas arbitrarias).
      const descarga = /^\/api\/archivos\/(sol-\d{3})\/(aprobacion\.pdf|aprobacion\.txt|trazabilidad\.json)$/.exec(url.pathname);
      const tipos: Record<string, string> = { pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', json: 'application/json; charset=utf-8' };
      const servir = async (ruta: string, nombre: string, tipo: string) => {
        try {
          const cuerpo = await readFile(ruta);
          res.writeHead(200, { 'Content-Type': tipo, 'Content-Disposition': `attachment; filename="${nombre}"`, 'Cache-Control': 'no-store' });
          res.end(cuerpo);
        } catch {
          enviar(404, { error: 'Archivo aun no generado: procese la solicitud primero.', requestId });
        }
      };
      if (req.method === 'GET' && descarga) return servir(path.join(config.outDir, descarga[1], descarga[2]), `${descarga[1]}-${descarga[2]}`, tipos[descarga[2].split('.').pop()!]);
      if (req.method === 'GET' && url.pathname === '/api/control.csv') return servir(path.join(config.outDir, 'control.csv'), 'control.csv', 'text/csv; charset=utf-8');
      const sesion = /^\/api\/sessions\/([A-Za-z0-9_-]{8,64})$/.exec(url.pathname);
      if (req.method === 'GET' && sesion) {
        const h = agente.historial(sesion[1]);
        return h ? enviar(200, { sessionId: sesion[1], historial: h }) : enviar(404, { error: 'Sesion no encontrada', requestId });
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const { sessionId, message } = chatSchema.parse(await leerJson(req));
        if (req.headers.accept?.includes('text/event-stream')) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
          const evento = (d: unknown) => !res.destroyed && res.write(`data: ${JSON.stringify(d)}\n\n`);
          const latido = setInterval(() => !res.destroyed && res.write(': latido\n\n'), 15_000);
          try {
            const r = await agente.turno(sessionId, message, (e: EventoAgente) => evento(e));
            evento({ tipo: 'complete', ...r });
          } catch {
            evento({ tipo: 'error', error: 'Fallo inesperado del agente. Revisa los registros del servidor.', requestId });
          } finally {
            clearInterval(latido);
            res.end();
          }
          return;
        }
        return enviar(200, await agente.turno(sessionId, message));
      }
      return enviar(404, { error: 'Ruta no encontrada', requestId });
    } catch (e) {
      if (e instanceof z.ZodError) return enviar(400, { error: 'Datos no validos', detalles: e.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`), requestId });
      if (e instanceof CuerpoGrande) return enviar(413, { error: e.message, requestId });
      if (e instanceof SyntaxError) return enviar(400, { error: 'JSON malformado', requestId });
      console.error(`[${requestId}]`, e instanceof Error ? e.message : e);
      return enviar(500, { error: 'Error interno', requestId });
    }
  };
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (esPrincipal) {
  const config = readConfig();
  const agente = await crearAgente(config);
  const server = createServer(crearManejador(config, agente));
  server.requestTimeout = 120_000;
  server.listen(config.port, '0.0.0.0', () => console.log(`Agente de OC en http://localhost:${config.port} (modo ${agente.proveedor.modo}, ${agente.proveedor.proveedor}/${agente.proveedor.modelo})`));
}
