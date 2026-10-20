import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { entornoDe } from '../src/data.js';
import { autoridad, conciliacion, desvioProceso, exportarCargaSap, panelControl, simular } from '../src/application/analisis/index.js';
import { ejecutor, humanoSimulado, usarOutTemporal } from './helpers.js';

let env: ReturnType<typeof entornoDe>;
before(async () => {
  await usarOutTemporal();
  env = entornoDe(process.cwd());
  const h = humanoSimulado();
  const run = ejecutor(h.puerto);
  await run('oc_crear', { caso: 'sol-001' });
  await run('oc_crear', { caso: 'sol-005' });
  h.confirmar('sol-005');
  await run('oc_crear', { caso: 'sol-005', confirmado: true });
  await run('oc_crear', { caso: 'sol-002' });
});

describe('1 · Panel de control', () => {
  it('KPIs de la cartera, reglas que mas frenan y bitacora', async () => {
    const p = await panelControl(env, 12);
    assert.equal(p.kpis.casos, 6);
    assert.equal(p.kpis.por_estado.CREADA, 2);
    assert.equal(p.kpis.por_estado.BLOQUEADA, 2);
    assert.equal(p.kpis.por_estado.REQUIERE_CONFIRMACION, 2);
    assert.equal(p.kpis.retroactivas, 1);
    assert.equal(p.kpis.minutos_ahorrados, 24);
    assert.equal(p.kpis.automatizables_pct, 16.7);
    assert.equal(p.kpis.valor_comprometido, 11_400_000 + 3_200_000);
    assert.ok(p.reglas.some((r) => r.codigo === 'RC1' && r.bloqueos === 1));
    assert.ok(p.bitacora.length >= 4);
    assert.equal(p.bitacora[0].ts >= p.bitacora.at(-1)!.ts, true, 'la bitacora va de lo mas reciente a lo mas antiguo');
  });
});

describe('2 · Desvio de proceso', () => {
  it('detecta la retroactiva, los dias de desvio y la secuencia', async () => {
    const d = await desvioProceso(env);
    const c5 = d.casos.find((c) => c.caso === 'sol-005')!;
    assert.equal(c5.retroactiva, true);
    assert.equal(c5.dias_factura_antes_de_solicitud, 17);
    assert.equal(c5.secuencia_correcta, false);
    assert.deepEqual(c5.eventos.map((e) => e.tipo).slice(0, 2), ['cotizacion', 'factura']);
    assert.equal(d.casos.find((c) => c.caso === 'sol-001')!.secuencia_correcta, true);
    assert.equal(d.resumen.retroactivas, 1);
    assert.equal(d.por_centro.find((g) => g.clave === 'CC-2020')!.retroactivas, 1);
  });
});

describe('3 · Conciliacion documental', () => {
  it('semaforo de cotizacion y coherencia del IVA', async () => {
    const c = await conciliacion(env);
    const f = (caso: string) => c.filas.find((x) => x.caso === caso)!;
    assert.equal(f('sol-001').semaforo_cotizacion, 'ok');
    assert.equal(f('sol-004').semaforo_cotizacion, 'alerta');
    assert.equal(f('sol-004').diferencia_cotizacion_pct, 6);
    assert.equal(f('sol-005').valor_factura, 3_200_000);
    assert.equal(f('sol-001').iva_coherente, true);
    assert.equal(f('sol-001').tasa_iva_cotizacion, 0.19);
  });
});

describe('4 · Simulador de controles', () => {
  it('el valor sobre el tope bloquea; la factura anterior vuelve retroactiva; todo en memoria', async () => {
    const a = await simular(env, 'sol-001', { valor_total: 80_000_000, valor_unitario: 666_666.67 });
    assert.equal(a.veredicto_original, 'APTA');
    assert.equal(a.veredicto_simulado, 'NO_APTA');
    assert.ok(a.diferencias.some((d) => d.codigo === 'RC3' && d.despues.estado === 'BLOQUEA'));

    const b = await simular(env, 'sol-001', { fecha_factura: '2026-08-01' });
    assert.equal(b.veredicto_simulado, 'APTA_CON_CONFIRMACION');
    assert.equal(b.simulada.retroactiva, true);

    const c = await simular(env, 'sol-004', { cotizacion_total: 25_000_000 });
    assert.equal(c.veredicto_simulado, 'APTA');
    assert.ok(c.diferencias.some((d) => d.codigo === 'RC5'));

    const d = await simular(env, 'sol-003', { aprobador_email: 'rtorres@periferia-ficticia.com', valor_total: 30_000_000, valor_unitario: 750_000, cotizacion_total: 30_000_000 });
    assert.equal(d.veredicto_simulado, 'APTA');

    // nada cambio en disco
    assert.equal((await simular(env, 'sol-001', { subarea: 'Soporte' })).veredicto_original, 'APTA');
  });

  it('rechaza simulaciones vacias y campos desconocidos', async () => {
    await assert.rejects(simular(env, 'sol-001', {}), /al menos un cambio/);
    const { CambiosSchema } = await import('../src/application/analisis/index.js');
    assert.equal(CambiosSchema.safeParse({ shell: 'rm -rf' }).success, false);
  });
});

describe('5 · Autoridad de aprobacion', () => {
  it('matriz con uso real del tope y casos sin autoridad', async () => {
    const a = await autoridad(env);
    const cc1010 = a.matriz.find((c) => c.centro_costo === 'CC-1010')!;
    const mlopez = cc1010.aprobadores.find((x) => x.email.startsWith('mlopez'))!;
    assert.ok(mlopez.casos.some((c) => c.caso === 'sol-001' && c.uso_pct === 22.8));
    const cc2020 = a.matriz.find((c) => c.centro_costo === 'CC-2020')!;
    assert.deepEqual(cc2020.casos_sin_autoridad.map((c) => c.caso), ['sol-003']);
  });

  it('consulta: quien puede aprobar X en el centro Y y cuando hay que escalar', async () => {
    const dentro = await autoridad(env, { centro: 'cc-1010', monto: 100_000_000 });
    assert.deepEqual(dentro.consulta!.pueden_aprobar.map((p) => p.email), ['dgarcia@periferia-ficticia.com']);
    const escalar = await autoridad(env, { centro: 'CC-2020', monto: 74_000_000 });
    assert.equal(escalar.consulta!.requiere_escalar, true);
    assert.equal(escalar.consulta!.tope_maximo, 30_000_000);
    assert.equal((await autoridad(env, { centro: 'CC-9999', monto: 1 })).consulta!.centro_existe, false);
  });
});

describe('Exportacion de carga masiva (Plan B SAP)', () => {
  it('incluye creadas y aptas; nunca las bloqueadas', async () => {
    const e = await exportarCargaSap(env);
    const filas = e.csv.trim().split('\n');
    assert.equal(filas[0].split(';')[0], 'estado');
    assert.equal(filas.length - 1, 4);
    assert.ok(filas.some((f) => f.startsWith('CREADA;4500000001;SOL-2026-001')));
    assert.ok(!e.csv.includes('SOL-2026-002') && !e.csv.includes('SOL-2026-003'));
    assert.deepEqual(e.omitidas, ['sol-002', 'sol-003']);
  });
});
