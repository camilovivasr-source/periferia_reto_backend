import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ejecutor, humanoSimulado, usarOutTemporal } from './helpers.js';
import type { Validacion } from '../src/domain/types.js';
import { OrdenCompraSchema } from '../src/domain/types.js';

let out: string;
before(async () => {
  out = await usarOutTemporal();
});

const validar = async (caso: string) => {
  const r = await ejecutor()('oc_validar', { caso });
  assert.equal(r.ok, true, r.error);
  return r.data as Validacion & { requiere_confirmacion: boolean };
};
const codigos = (xs: { codigo: string }[]) => xs.map((x) => x.codigo);

describe('Controles RC1-RC10 sobre los 6 casos (decididos por evidencia, no por numero)', () => {
  it('sol-001: apta, sin bloqueos ni confirmaciones', async () => {
    const v = await validar('sol-001');
    assert.equal(v.apta, true);
    assert.deepEqual(v.bloqueos, []);
    assert.deepEqual(v.confirmaciones, []);
    assert.equal(v.retroactiva, false);
  });

  it('sol-002: proveedor inexistente -> bloqueo RC1', async () => {
    const v = await validar('sol-002');
    assert.equal(v.apta, false);
    assert.deepEqual(codigos(v.bloqueos), ['RC1']);
  });

  it('sol-003: aprobador sin autoridad en el centro -> bloqueos RC2 y RC3', async () => {
    const v = await validar('sol-003');
    assert.equal(v.apta, false);
    assert.deepEqual(codigos(v.bloqueos), ['RC2', 'RC3']);
  });

  it('sol-004: cotizacion 6 % mayor -> confirmacion RC5 con ambos valores', async () => {
    const v = await validar('sol-004');
    assert.equal(v.apta, true);
    assert.deepEqual(codigos(v.confirmaciones), ['RC5']);
    assert.match(v.confirmaciones[0].detalle, /26\.500\.000/);
    assert.match(v.confirmaciones[0].detalle, /25\.000\.000/);
  });

  it('sol-005: factura anterior a la solicitud -> retroactiva + confirmacion RC8', async () => {
    const v = await validar('sol-005');
    assert.equal(v.apta, true);
    assert.equal(v.retroactiva, true);
    assert.deepEqual(codigos(v.confirmaciones), ['RC8']);
  });

  it('sol-006: sin IVA ni pago, sin NIT -> proveedor por nombre, derivados y confirmacion RC6', async () => {
    const v = await validar('sol-006');
    assert.equal(v.apta, true);
    assert.deepEqual(codigos(v.confirmaciones), ['RC6']);
    assert.equal(v.derivados.indicador_iva, 'C1');
    assert.equal(v.derivados.condiciones_pago, 'Z030');
    assert.equal(v.derivados.proveedor_codigo_sap, '100234');
  });
});

describe('Payload, trazabilidad y evidencia', () => {
  it('el payload cumple el esquema zod y deja trazabilidad por campo', async () => {
    const r = await ejecutor()('oc_construir_payload', { caso: 'sol-001' });
    assert.equal(r.ok, true, r.error);
    const { payload, trazabilidad_ruta } = r.data as { payload: unknown; trazabilidad_ruta: string };
    const oc = OrdenCompraSchema.parse(payload);
    assert.equal(oc.proveedor.codigo_sap, '100234');
    assert.equal(oc.posiciones[0].numero, 10);
    assert.ok(oc.posiciones[0].descripcion.length <= 40);
    assert.equal(oc.totales.base + oc.totales.iva, oc.totales.total);
    const traza = JSON.parse(await readFile(path.join(process.cwd(), trazabilidad_ruta), 'utf8')) as Array<{ campo: string; fuente: string }>;
    assert.ok(traza.some((t) => t.campo === 'proveedor.codigo_sap' && t.fuente === 'maestro.proveedores'));
    assert.ok(traza.some((t) => t.campo === 'posiciones[10].cantidad' && t.fuente === 'solicitud'));
  });

  it('no construye payload de una solicitud con bloqueos', async () => {
    const r = await ejecutor()('oc_construir_payload', { caso: 'sol-002' });
    assert.equal(r.ok, false);
  });

  it('sol-006 deriva IVA y pago en el payload y lo declara como derivado', async () => {
    const r = await ejecutor()('oc_construir_payload', { caso: 'sol-006' });
    const oc = OrdenCompraSchema.parse((r.data as { payload: unknown }).payload);
    assert.equal(oc.condiciones_pago, 'Z030');
    assert.equal(oc.posiciones[0].indicador_iva, 'C1');
    assert.equal(oc.excepciones[0].codigo, 'RC6');
    assert.equal(oc.excepciones[0].confirmado_por, null);
  });

  it('la evidencia es determinista y trae sha256 de encabezados + cuerpo', async () => {
    const a = await ejecutor()('oc_generar_evidencia', { caso: 'sol-001' });
    const b = await ejecutor()('oc_generar_evidencia', { caso: 'sol-001' });
    assert.equal(a.ok, true);
    assert.equal((a.data as { sha256: string }).sha256, (b.data as { sha256: string }).sha256);
    const txt = await readFile(path.join(out, 'sol-001', 'aprobacion.txt'), 'utf8');
    assert.match(txt, /De: mlopez@periferia-ficticia\.com/);
    assert.match(txt, /Aprobado, proceder/);
    assert.match(txt, new RegExp((a.data as { sha256: string }).sha256));
    const pdf = await readFile(path.join(out, 'sol-001', 'aprobacion.pdf'));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  });
});

describe('oc_crear: barreras', () => {
  it('bloqueada no crea, aunque el modelo envie confirmado=true', async () => {
    const h = humanoSimulado();
    const run = ejecutor(h.puerto);
    for (const caso of ['sol-002', 'sol-003']) {
      h.confirmar(caso);
      const r = await run('oc_crear', { caso, confirmado: true });
      assert.equal(r.ok, false);
      assert.ok(JSON.parse(r.texto).bloqueos.length > 0);
    }
  });

  it('confirmado=true escrito por el modelo, sin confirmacion humana, no crea', async () => {
    const h = humanoSimulado();
    const run = ejecutor(h.puerto);
    const r = await run('oc_crear', { caso: 'sol-004', confirmado: true });
    assert.equal(r.ok, false);
    assert.equal(JSON.parse(r.texto).requiere_confirmacion, true);
    assert.ok(h.pendientes.has('sol-004'), 'queda pendiente para que el front la resalte');
  });

  it('sin puerto de confirmacion (nadie puede confirmar) nunca se crea una OC con excepciones', async () => {
    const r = await ejecutor()('oc_crear', { caso: 'sol-005', confirmado: true });
    assert.equal(r.ok, false);
  });

  it('con confirmacion humana crea, registra quien confirmo y es idempotente', async () => {
    const h = humanoSimulado();
    const run = ejecutor(h.puerto);
    await run('oc_crear', { caso: 'sol-004' });
    h.confirmar('sol-004');
    const r = await run('oc_crear', { caso: 'sol-004', confirmado: true });
    assert.equal(r.ok, true, r.error);
    const numero = (r.data as { numero_oc: string }).numero_oc;
    assert.match(numero, /^45000000\d\d$/);
    const otra = await run('oc_crear', { caso: 'sol-004', confirmado: true });
    assert.deepEqual({ ...(otra.data as object), fecha: undefined }, { numero_oc: numero, fecha: undefined, idempotente: true });
    const ordenes = (await readFile(path.join(out, 'sap', 'ordenes.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(ordenes.filter((o) => o.solicitud_id === 'SOL-2026-004').length, 1);
    assert.equal(ordenes.find((o) => o.solicitud_id === 'SOL-2026-004').orden.excepciones[0].confirmado_por, 'tester');
  });

  it('sol-001 se crea sin intervencion y la numeracion es secuencial desde 4500000001', async () => {
    const r = await ejecutor()('oc_crear', { caso: 'sol-001' });
    assert.equal(r.ok, true, r.error);
    const n = Number((r.data as { numero_oc: string }).numero_oc);
    assert.ok(n >= 4500000001);
  });

  it('control.csv registra cada intento y marca la retroactiva', async () => {
    const h = humanoSimulado();
    const run = ejecutor(h.puerto);
    await run('oc_crear', { caso: 'sol-005' });
    h.confirmar('sol-005');
    await run('oc_crear', { caso: 'sol-005', confirmado: true });
    const filas = (await readFile(path.join(out, 'control.csv'), 'utf8')).trim().split('\n');
    assert.equal(filas[0], 'solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts');
    const de005 = filas.filter((f) => f.startsWith('SOL-2026-005'));
    assert.ok(de005.some((f) => f.includes('PENDIENTE_CONFIRMACION')));
    assert.ok(de005.some((f) => f.includes('CREADA') && f.includes(',true,')));
    assert.ok(filas.some((f) => f.startsWith('SOL-2026-002,BLOQUEADA')));
  });
});
