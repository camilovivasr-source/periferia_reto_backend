import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ejecutor, usarOutTemporal } from './helpers.js';
import { ejecutarHerramienta } from '../src/tools/registry.js';
import { parsearCotizacion, esAprobacion } from '../src/domain/parse.js';
import { parsearMonto, normalizarNit } from '../src/domain/util.js';

before(async () => {
  await usarOutTemporal();
});

describe('Entradas invalidas -> { ok:false, error } legible, sin excepcion', () => {
  it('caso inexistente o con ruta maliciosa', async () => {
    for (const caso of ['sol-999', '../../etc/passwd', 'sol-001/../..', '']) {
      const r = await ejecutor()('oc_leer_paquete', { caso });
      assert.equal(r.ok, false, caso);
      assert.ok(r.error && r.error.length > 5);
    }
  });

  it('argumentos que no cumplen el esquema zod se devuelven al modelo', async () => {
    const r1 = await ejecutor()('oc_leer_paquete', {});
    assert.equal(r1.ok, false);
    assert.match(r1.error!, /caso/);
    const r2 = await ejecutor()('oc_leer_paquete', { caso: 'sol-001', extra: 1 });
    assert.equal(r2.ok, false);
    const r3 = await ejecutor()('oc_inventada', {});
    assert.equal(r3.ok, false);
    assert.match(r3.error!, /desconocida/);
  });

  it('lo que el modelo envie como paquete se ignora (no puede alterar lo validado)', async () => {
    const r = await ejecutor()('oc_validar', { caso: 'sol-002', paquete: { solicitud: { proveedor_nit: '900555111' } } });
    assert.equal((r.data as { apta: boolean }).apta, false);
  });

  async function fixturesRotos() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'oc-fx-'));
    await cp(path.join(process.cwd(), 'fixtures', 'reto-03'), path.join(dir, 'fixtures', 'reto-03'), { recursive: true });
    return dir;
  }
  const conRaiz = async (dir: string, fn: () => Promise<void>) => {
    const prev = process.env.FIXTURES_DIR;
    process.env.FIXTURES_DIR = path.join(dir, 'fixtures', 'reto-03');
    try {
      await fn();
    } finally {
      process.env.FIXTURES_DIR = prev;
      if (prev === undefined) delete process.env.FIXTURES_DIR;
    }
  };

  it('JSON malformado y monto no numerico', async () => {
    const dir = await fixturesRotos();
    const sol = path.join(dir, 'fixtures', 'reto-03', 'solicitudes');
    await writeFile(path.join(sol, 'sol-001', 'solicitud.json'), '{ no es json');
    const original = JSON.parse(await readFile(path.join(process.cwd(), 'fixtures/reto-03/solicitudes/sol-002/solicitud.json'), 'utf8'));
    await writeFile(path.join(sol, 'sol-002', 'solicitud.json'), JSON.stringify({ ...original, valor_total: 'doce millones' }));
    await conRaiz(dir, async () => {
      const a = await ejecutor()('oc_leer_paquete', { caso: 'sol-001' });
      assert.equal(a.ok, false);
      assert.match(a.error!, /malformado/);
      const b = await ejecutor()('oc_validar', { caso: 'sol-002' });
      assert.equal(b.ok, false);
      assert.match(b.error!, /valor_total/);
    });
  });

  it('adjunto ausente: cotizacion null + faltantes, y RC5 pide confirmacion en vez de fallar', async () => {
    const dir = await fixturesRotos();
    const { rm } = await import('node:fs/promises');
    await rm(path.join(dir, 'fixtures', 'reto-03', 'solicitudes', 'sol-001', 'cotizacion.txt'));
    await conRaiz(dir, async () => {
      const p = await ejecutor()('oc_leer_paquete', { caso: 'sol-001' });
      assert.equal(p.ok, true);
      const d = p.data as { cotizacion: unknown; faltantes: string[] };
      assert.equal(d.cotizacion, null);
      assert.deepEqual(d.faltantes, ['cotizacion.txt']);
      const v = await ejecutor()('oc_validar', { caso: 'sol-001' });
      assert.deepEqual((v.data as { confirmaciones: { codigo: string }[] }).confirmaciones.map((c) => c.codigo), ['RC5']);
    });
  });

  it('un caso malo no impide el siguiente', async () => {
    const a = await ejecutarHerramienta('oc_leer_paquete', { caso: 'nada' }, { directory: process.cwd(), sessionId: 't' });
    const b = await ejecutarHerramienta('oc_leer_paquete', { caso: 'sol-001' }, { directory: process.cwd(), sessionId: 't' });
    assert.equal(a.ok, false);
    assert.equal(b.ok, true);
  });
});

describe('Parsers', () => {
  it('montos con formato colombiano', () => {
    assert.equal(parsearMonto('11.400.000'), 11400000);
    assert.equal(parsearMonto('1.234,50'), 1234.5);
    assert.equal(parsearMonto('1234.50'), 1234.5);
    assert.equal(parsearMonto('abc'), null);
  });
  it('NIT sin puntos ni digito de verificacion', () => assert.equal(normalizarNit('900.555.111-2'), '900555111'));
  it('"Aprobado" explicito y sin negacion', () => {
    assert.equal(esAprobacion('Aprobado, proceder.'), true);
    assert.equal(esAprobacion('No aprobado por ahora'), false);
    assert.equal(esAprobacion('Lo reviso y te cuento'), false);
  });
  it('cotizacion: total, NIT, validez y referencia', () => {
    const c = parsearCotizacion('COTIZACIÓN COT-1\nFecha: 2026-08-18\nProveedor: X\nNIT: 900.555.111-2\nTOTAL (IVA incluido): COP 11.400.000\nValidez de la oferta: 30 días');
    assert.deepEqual([c.referencia, c.nit, c.total, c.moneda, c.validez_hasta], ['COT-1', '900555111', 11400000, 'COP', '2026-09-17']);
  });
});
