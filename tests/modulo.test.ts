import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GeminiAdapter } from '../src/llm/gemini.js';
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
    const cuerpos: Array<Record<string, any>> = [];
    const respuestas = [
      { candidates: [{ content: { parts: [{ thoughtSignature: 'firma', functionCall: { id: 'f1', name: 'oc_validar', args: { caso: 'sol-001' } } }] } }], usageMetadata: { totalTokenCount: 42 } },
      { candidates: [{ content: { parts: [{ text: 'Listo' }] } }] },
    ];
    const http = (async (_u: unknown, init: RequestInit) => {
      cuerpos.push(JSON.parse(String(init.body)));
      assert.equal((init.headers as Record<string, string>)['x-goog-api-key'], 'clave-de-prueba');
      return new Response(JSON.stringify(respuestas[cuerpos.length - 1]), { status: 200 });
    }) as typeof fetch;
    const g = new GeminiAdapter('gemini-2.5-flash', 'clave-de-prueba', 5000, http);
    const r1 = await g.enviar([{ rol: 'system', contenido: 'sistema' }, { rol: 'user', contenido: 'valida sol-001' }], definiciones());
    assert.equal(r1.tokens, 42);
    assert.deepEqual(r1.mensaje.llamadas, [{ id: 'f1', nombre: 'oc_validar', args: { caso: 'sol-001' } }]);
    assert.equal(cuerpos[0].tools[0].functionDeclarations.length, 5);
    assert.equal(cuerpos[0].systemInstruction.parts[0].text, 'sistema');

    await g.enviar([{ rol: 'system', contenido: 'sistema' }, { rol: 'user', contenido: 'valida sol-001' }, r1.mensaje, { rol: 'tool', llamadaId: 'f1', nombre: 'oc_validar', contenido: '{"ok":true}' }], definiciones());
    const contents = cuerpos[1].contents;
    assert.equal(contents[1].role, 'model');
    assert.equal(contents[1].parts[0].thoughtSignature, 'firma');
    assert.equal(contents[2].parts[0].functionResponse.id, 'f1');
    assert.deepEqual(contents[2].parts[0].functionResponse.response, { result: { ok: true } });
  });

  it('errores del proveedor: mensaje claro, sin filtrar la clave', async () => {
    const g = new GeminiAdapter('m', 'clave-secreta', 5000, (async () => new Response('{}', { status: 403 })) as typeof fetch);
    await assert.rejects(g.enviar([{ rol: 'user', contenido: 'hola' }], []), (e: Error) => /HTTP 403/.test(e.message) && !/clave-secreta/.test(e.message));
  });
});
