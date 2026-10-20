import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readConfig } from '../src/config.js';
import { crearAgente } from '../src/bootstrap.js';
import { crearManejador } from '../src/http/rutas.js';
import { usarOutTemporal } from './helpers.js';

let server: Server;
let base: string;
before(async () => {
  await usarOutTemporal();
  const config = readConfig({ ...process.env, GEMINI_API_KEY: '', AGENT_MODE: 'practice' });
  server = createServer(crearManejador(config, await crearAgente(config)));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = (ruta: string, cuerpo: unknown, headers: Record<string, string> = {}) =>
  fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) });

describe('API HTTP', () => {
  it('health no expone claves', async () => {
    const r = await (await fetch(base + '/api/health')).json();
    assert.equal(r.ok, true);
    assert.equal(r.proveedor, 'practica');
    assert.doesNotMatch(JSON.stringify(r), /key|secret/i);
  });

  it('lista de casos', async () => {
    const r = await (await fetch(base + '/api/casos')).json();
    assert.deepEqual(r.casos, ['sol-001', 'sol-002', 'sol-003', 'sol-004', 'sol-005', 'sol-006']);
    const estados = Object.fromEntries(r.detalle.map((c: { caso: string; estado: string }) => [c.caso, c.estado]));
    assert.equal(estados['sol-002'], 'BLOQUEADA');
    assert.equal(estados['sol-004'], 'REQUIERE_CONFIRMACION');
  });

  it('descarga de evidencia solo con nombres permitidos', async () => {
    await post('/api/chat', { sessionId: 'http-sesion-9', message: 'procesa sol-004' });
    const pdf = await fetch(base + '/api/archivos/sol-004/aprobacion.pdf');
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal((await fetch(base + '/api/archivos/sol-004/secreto.txt')).status, 404);
    assert.equal((await fetch(base + '/api/archivos/..%2F..%2Fetc/passwd')).status, 404);
    assert.equal((await fetch(base + '/api/archivos/sol-001/aprobacion.pdf')).status, 404, 'aun no generado');
  });

  it('chat: respuesta, llamadas a herramientas y confirmacion pendiente', async () => {
    const r = await post('/api/chat', { sessionId: 'http-sesion-1', message: 'procesa sol-004' });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.needsConfirmation, true);
    assert.ok(j.toolCalls.length >= 4);
    const s = await (await fetch(base + '/api/sessions/http-sesion-1')).json();
    assert.equal(s.historial.length, 2);
  });

  it('chat por SSE emite tool_start, tool_end y complete', async () => {
    const r = await post('/api/chat', { sessionId: 'http-sesion-2', message: 'procesa sol-002' }, { Accept: 'text/event-stream' });
    const texto = await r.text();
    assert.match(texto, /"tipo":"tool_start"/);
    assert.match(texto, /"tipo":"tool_end"/);
    assert.match(texto, /"tipo":"complete"/);
  });

  it('entradas invalidas devuelven 400/404/413 sin tumbar el servidor', async () => {
    assert.equal((await post('/api/chat', { sessionId: 'x', message: 'hola' })).status, 400);
    assert.equal((await post('/api/chat', { sessionId: 'http-sesion-3', message: 4 })).status, 400);
    assert.equal((await post('/api/chat', '{malformado')).status, 400);
    assert.equal((await post('/api/chat', { sessionId: 'http-sesion-3', message: 'x'.repeat(20000) })).status, 413);
    assert.equal((await fetch(base + '/api/sessions/no-existe-ninguna')).status, 404);
    assert.equal((await fetch(base + '/otra')).status, 404);
    assert.equal((await (await fetch(base + '/api/health')).json()).ok, true);
  });
});
