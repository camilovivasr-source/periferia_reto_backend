import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { entornoDe, listarCasos } from '../src/data.js';
import { NuevaSolicitudSchema, registrarSolicitud } from '../src/application/registro.js';
import { consultarConocimiento } from '../src/application/conocimiento.js';
import { ejecutor, usarOutTemporal } from './helpers.js';

before(async () => {
  await usarOutTemporal();
  delete process.env.SOLICITUDES_DIR;
});

const base = {
  solicitud: {
    solicitante: 'Laura Diaz', solicitante_email: 'laura@periferia-ficticia.com', proveedor_nombre: 'TecnoSuministros S.A.S.', proveedor_nit: '900555111',
    descripcion: 'Teclados ergonomicos', centro_costo: 'CC-1010', subarea: 'Soporte', cantidad: 10, valor_unitario: 150000, valor_total: 1500000,
    moneda: 'COP' as const, indicador_iva: 'C1', condiciones_pago: 'Z030', fecha_solicitud: '2026-09-01',
  },
  cotizacion: { total: 1500000, fecha: '2026-08-30' },
  aprobacion: { de: 'mlopez@periferia-ficticia.com', fecha: '2026-09-02', cuerpo: 'Aprobado.' },
};

describe('Registro de solicitudes nuevas', () => {
  it('crea sol-007 fuera de fixtures, apta, y el agente la procesa hasta crear la OC', async () => {
    const env = entornoDe(process.cwd());
    const r = await registrarSolicitud(env, NuevaSolicitudSchema.parse(base));
    assert.equal(r.caso, 'sol-007');
    assert.equal(r.solicitud_id, 'SOL-2026-007');
    assert.equal(r.estado, 'APTA');
    assert.ok((await listarCasos(env)).includes('sol-007'));
    const crear = await ejecutor()('oc_crear', { caso: 'sol-007' });
    assert.equal(crear.ok, true, crear.error);
  });

  it('una solicitud nueva con factura anterior queda retroactiva y sin cotizacion pide confirmacion', async () => {
    const env = entornoDe(process.cwd());
    const { cotizacion: _c, ...sinCot } = base;
    const r = await registrarSolicitud(env, NuevaSolicitudSchema.parse({ ...sinCot, factura: { numero: 'F-1', fecha: '2026-08-15', total: 1500000 } }));
    assert.equal(r.caso, 'sol-008');
    assert.deepEqual(r.confirmaciones.map((c) => c.codigo), ['RC5', 'RC8']);
    assert.deepEqual(r.faltantes, ['cotizacion.txt']);
  });

  it('valida la entrada con zod (campos, tipos y formatos)', () => {
    assert.equal(NuevaSolicitudSchema.safeParse({ ...base, solicitud: { ...base.solicitud, valor_total: 'mucho' } }).success, false);
    assert.equal(NuevaSolicitudSchema.safeParse({ ...base, extra: 1 }).success, false);
    assert.equal(NuevaSolicitudSchema.safeParse({ ...base, aprobacion: { ...base.aprobacion, de: 'no-es-correo' } }).success, false);
  });
});

describe('Consulta del documento y del conocimiento', () => {
  it('encuentra secciones del PRD y del glosario con su fuente', async () => {
    const o4 = await consultarConocimiento(process.cwd(), 'objetivos y metricas de exito del reto');
    assert.ok(o4.resultados.some((r) => /Objetivos/.test(r.seccion)));
    const z030 = await consultarConocimiento(process.cwd(), 'que significa condiciones de pago Z030');
    assert.ok(z030.resultados.some((r) => r.texto.includes('Z030')));
    const retro = await ejecutor()('oc_consultar_conocimiento', { pregunta: 'que es una OC retroactiva' });
    assert.equal(retro.ok, true);
    assert.ok((retro.data as { resultados: unknown[] }).resultados.length > 0);
  });
});

describe('Carga de una carpeta de solicitud', () => {
  const leer = (f: string) => import('node:fs/promises').then((m) => m.readFile(`fixtures/reto-03/solicitudes/sol-004/${f}`, 'utf8'));
  it('sube los archivos de la carpeta, la valida y queda disponible', async () => {
    const { registrarCarpeta, CarpetaSchema } = await import('../src/application/registro.js');
    const env = entornoDe(process.cwd());
    const solicitud = JSON.parse(await leer('solicitud.json'));
    const archivos = [
      { nombre: 'sol-100/solicitud.json', contenido: JSON.stringify({ ...solicitud, solicitud_id: 'SOL-2026-100' }) },
      { nombre: 'sol-100/cotizacion.txt', contenido: await leer('cotizacion.txt') },
      { nombre: 'sol-100/aprobacion.json', contenido: await leer('aprobacion.json') },
      { nombre: 'sol-100/notas.docx', contenido: 'ignorado' },
    ];
    const r = await registrarCarpeta(env, CarpetaSchema.parse({ nombre: 'sol-100', archivos }));
    assert.equal(r.caso, 'sol-100');
    assert.deepEqual(r.confirmaciones.map((c) => c.codigo), ['RC5']);
    assert.deepEqual(r.ignorados, ['notas.docx']);
    assert.ok((await listarCasos(env)).includes('sol-100'));
    await assert.rejects(registrarCarpeta(env, CarpetaSchema.parse({ archivos: [archivos[0]] })), /Ya existe/);
  });
  it('rechaza carpetas sin solicitud.json, JSON malformado y esquemas invalidos', async () => {
    const { registrarCarpeta, CarpetaSchema } = await import('../src/application/registro.js');
    const env = entornoDe(process.cwd());
    await assert.rejects(registrarCarpeta(env, CarpetaSchema.parse({ archivos: [{ nombre: 'cotizacion.txt', contenido: 'x' }] })), /solicitud\.json/);
    await assert.rejects(registrarCarpeta(env, CarpetaSchema.parse({ archivos: [{ nombre: 'solicitud.json', contenido: '{no' }] })), /malformado/);
    await assert.rejects(registrarCarpeta(env, CarpetaSchema.parse({ archivos: [{ nombre: 'solicitud.json', contenido: '{"solicitud_id":"X"}' }] })), /invalido/);
  });
});
