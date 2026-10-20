import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GeminiAdapter, aEsquemaGemini, destinoAiStudio, destinoVertex } from '../src/llm/gemini.js';
import { definiciones } from '../src/tools/registry.js';
// @ts-expect-error modulo ESM sin tipos
import { generar } from '../scripts/build-modulo.mjs';
import * as modulo from '../modulo/tools/oc.js';
import * as app from '../src/tools/oc.js';

describe('Modulo reutilizable (bonus 9.4)', () => {
  it('agent.md, SKILL.md y tools son las mismas piezas que usa la aplicacion (sin copias divergentes)', async () => {
    for (const [ruta, contenido] of Object.entries(generar() as Record<string, string>)) {
      assert.equal(await readFile(path.join(process.cwd(), ruta), 'utf8'), contenido, `${ruta} desactualizado: ejecuta npm run modulo`);
    }
    assert.equal(modulo.crear, app.crear);
  });
});

describe('Adaptador Gemini (sin red)', () => {
  it('serializa herramientas, conserva partes nativas y agrupa respuestas de herramientas', async () => {
    type Declaracion = { name: string; parameters?: { type: string; properties: Record<string, { type: string }> } };
    type Cuerpo = { tools: Array<{ functionDeclarations: Declaracion[] }>; systemInstruction: { parts: Array<{ text: string }> }; contents: Array<{ role: string; parts: Array<{ thoughtSignature?: string; functionResponse?: { id?: string; response: unknown } }> }> };
    const cuerpos: Cuerpo[] = [];
    const respuestas = [
      { candidates: [{ content: { parts: [{ thoughtSignature: 'firma', functionCall: { id: 'f1', name: 'oc_validar', args: { caso: 'sol-001' } } }] } }], usageMetadata: { totalTokenCount: 42 } },
      { candidates: [{ content: { parts: [{ text: 'Listo' }] } }] },
    ];
    const http = (async (_u: unknown, init: RequestInit) => {
      cuerpos.push(JSON.parse(String(init.body)) as Cuerpo);
      assert.equal((init.headers as Record<string, string>)['x-goog-api-key'], 'clave-de-prueba');
      return new Response(JSON.stringify(respuestas[cuerpos.length - 1]), { status: 200 });
    }) as typeof fetch;
    const g = new GeminiAdapter('gemini-2.5-flash', destinoAiStudio('clave-de-prueba'), 5000, http);
    const r1 = await g.enviar([{ rol: 'system', contenido: 'sistema' }, { rol: 'user', contenido: 'valida sol-001' }], definiciones());
    assert.equal(r1.tokens, 42);
    assert.deepEqual(r1.mensaje.llamadas, [{ id: 'f1', nombre: 'oc_validar', args: { caso: 'sol-001' } }]);
    assert.equal(cuerpos[0].tools[0].functionDeclarations.length, 10);
    const sinArgs = cuerpos[0].tools[0].functionDeclarations.find((f) => f.name === 'oc_listar_casos')!;
    assert.equal("parameters" in sinArgs, false, "sin argumentos no se envia parameters (Vertex lo rechaza)");
    const validar = cuerpos[0].tools[0].functionDeclarations.find((f) => f.name === 'oc_validar')!;
    assert.equal(validar.parameters?.type, 'OBJECT');
    assert.equal(validar.parameters?.properties.caso.type, 'STRING');
    assert.equal('paquete' in (validar.parameters?.properties ?? {}), false, 'los objetos libres ignorados no se publican');
    assert.equal('additionalProperties' in (validar.parameters ?? {}), false);
    assert.equal(cuerpos[0].systemInstruction.parts[0].text, 'sistema');

    await g.enviar([{ rol: 'system', contenido: 'sistema' }, { rol: 'user', contenido: 'valida sol-001' }, r1.mensaje, { rol: 'tool', llamadaId: 'f1', nombre: 'oc_validar', contenido: '{"ok":true}' }], definiciones());
    const contents = cuerpos[1].contents;
    assert.equal(contents[1].role, 'model');
    assert.equal(contents[1].parts[0].thoughtSignature, 'firma');
    assert.equal(contents[2].parts[0].functionResponse?.id, 'f1');
    assert.deepEqual(contents[2].parts[0].functionResponse?.response, { result: { ok: true } });
  });

  it('errores del proveedor: mensaje claro, sin filtrar la clave', async () => {
    const g = new GeminiAdapter('m', destinoAiStudio('clave-secreta'), 5000, (async () => new Response('{}', { status: 403 })) as typeof fetch);
    await assert.rejects(g.enviar([{ rol: 'user', contenido: 'hola' }], []), (e: Error) => /HTTP 403/.test(e.message) && !/clave-secreta/.test(e.message));
  });

  it('Vertex AI: URL regional, token ADC y sin clave de API', async () => {
    const llamadas: Array<{ url: string; headers: Record<string, string> }> = [];
    const http = (async (url: string, init: RequestInit) => {
      llamadas.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hola' }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const auth = { getAccessToken: async () => 'token-adc', getProjectId: async () => 'proyecto-metadata' };
    const g = new GeminiAdapter('gemini-2.5-flash', destinoVertex({ location: 'us-central1', auth }), 5000, http);
    assert.equal(g.proveedor, 'google-vertex-ai');
    const r = await g.enviar([{ rol: 'user', contenido: 'hola' }], []);
    assert.equal(r.mensaje.contenido, 'hola');
    assert.equal(llamadas[0].url, 'https://us-central1-aiplatform.googleapis.com/v1/projects/proyecto-metadata/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent');
    assert.equal(llamadas[0].headers.Authorization, 'Bearer token-adc');
    assert.equal('x-goog-api-key' in llamadas[0].headers, false);
    const global = destinoVertex({ project: 'p', location: 'global', auth });
    assert.equal(await global.url('m'), 'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/m:generateContent');
  });

  it('Vertex AI: sin credenciales o sin permiso, mensaje claro (no es rechazo de la compra)', async () => {
    const sinToken = { getAccessToken: async () => null, getProjectId: async () => 'p' };
    await assert.rejects(new GeminiAdapter('m', destinoVertex({ location: 'us-central1', auth: sinToken }), 5000, (async () => new Response('{}')) as typeof fetch).enviar([{ rol: 'user', contenido: 'x' }], []), /credenciales/);
    const conToken = { getAccessToken: async () => 't', getProjectId: async () => 'p' };
    await assert.rejects(new GeminiAdapter('m', destinoVertex({ location: 'us-central1', auth: conToken }), 5000, (async () => new Response('{}', { status: 403 })) as typeof fetch).enviar([{ rol: 'user', contenido: 'x' }], []), /aiplatform\.user/);
  });

  it('el conversor de esquema deja solo OpenAPI valido', () => {
    const e = aEsquemaGemini({ type: 'object', additionalProperties: false, $schema: 'x', properties: { a: { type: 'string', description: 'd' }, b: { type: 'object', additionalProperties: {} }, c: { type: 'boolean' } }, required: ['a', 'b'] });
    assert.deepEqual(e, { type: 'OBJECT', properties: { a: { type: 'STRING', description: 'd' }, c: { type: 'BOOLEAN' } }, required: ['a'] });
  });
});
