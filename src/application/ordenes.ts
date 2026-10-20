import path from 'node:path';
import { cargarMaestros, entornoDe, leerPaquete, validarNombreCaso, DatosError } from '../data.js';
import { contenidoEvidencia, generarPdf, hashEvidencia } from '../domain/evidence.js';
import { construirPayload, huellaConfirmacion } from '../domain/payload.js';
import { validar } from '../domain/validate.js';
import { escribirArchivo, registrarControl } from '../out.js';
import { SapMock } from '../sap/mock.js';
import type { OrdenCompra } from '../schemas.js';
import { fallo, ok } from './resultado.js';
import type { Invocacion } from './tipos.js';

/** Casos de uso del agente. Las herramientas (src/tools/oc.ts) solo declaran contratos y delegan aqui. */

async function prepararCaso({ directory }: Invocacion, caso: string) {
  validarNombreCaso(caso);
  const env = entornoDe(directory);
  const [paquete, maestros] = await Promise.all([leerPaquete(env, caso), cargarMaestros(env)]);
  return { env, paquete, maestros, validacion: validar(paquete, maestros) };
}

const relativa = (inv: Invocacion, ruta: string) => path.relative(inv.directory, ruta).split(path.sep).join('/');

export async function leerPaqueteCaso(inv: Invocacion, caso: string) {
  return ok(await leerPaquete(entornoDe(inv.directory), validarNombreCaso(caso)));
}

export async function validarCaso(inv: Invocacion, caso: string) {
  const { paquete, maestros, validacion } = await prepararCaso(inv, caso);
  let huella: string | undefined;
  if (validacion.apta) {
    huella = huellaConfirmacion(construirPayload(paquete, maestros, validacion).payload, validacion);
    if (validacion.confirmaciones.length) inv.confirmacion?.registrar(caso, huella, validacion.confirmaciones);
  }
  return ok({
    caso,
    solicitud_id: paquete.solicitud.solicitud_id,
    ...validacion,
    requiere_confirmacion: validacion.apta && validacion.confirmaciones.length > 0,
    huella,
  });
}

export async function construirOrdenCaso(inv: Invocacion, caso: string) {
  const { env, paquete, maestros, validacion } = await prepararCaso(inv, caso);
  if (!validacion.apta) return fallo('No se construye el payload: la solicitud tiene bloqueos.', { bloqueos: validacion.bloqueos });
  const { payload, trazabilidad } = construirPayload(paquete, maestros, validacion);
  const ruta = path.join(env.outDir, caso, 'trazabilidad.json');
  await escribirArchivo(ruta, JSON.stringify(trazabilidad, null, 2));
  return ok({
    payload,
    trazabilidad_ruta: relativa(inv, ruta),
    requiere_confirmacion: validacion.confirmaciones.length > 0,
    confirmaciones: validacion.confirmaciones,
  });
}

/** Escribe aprobacion.txt (con sha256) y aprobacion.pdf en out/<caso>/. */
export async function escribirEvidencia(inv: Invocacion, caso: string) {
  const env = entornoDe(inv.directory);
  const paquete = await leerPaquete(env, validarNombreCaso(caso));
  if (!paquete.aprobacion) throw new DatosError('No hay correo de aprobacion para generar la evidencia.');
  const contenido = contenidoEvidencia(paquete);
  const sha256 = hashEvidencia(paquete);
  const base = path.join(env.outDir, caso);
  await escribirArchivo(path.join(base, 'aprobacion.txt'), `${contenido}\n\n---\nsha256 del contenido anterior: ${sha256}\n`);
  await escribirArchivo(path.join(base, 'aprobacion.pdf'), generarPdf([...contenido.split('\n'), '', `sha256: ${sha256}`]));
  return { ruta: relativa(inv, path.join(base, 'aprobacion.txt')), ruta_pdf: relativa(inv, path.join(base, 'aprobacion.pdf')), sha256 };
}

export async function generarEvidenciaCaso(inv: Invocacion, caso: string) {
  return ok(await escribirEvidencia(inv, caso));
}

/**
 * Crea la OC. Revalida siempre; con bloqueos no crea; con confirmaciones exige `confirmado` Y una concesion
 * humana vigente para la huella actual; es idempotente por solicitud_id. Cada intento deja fila en control.csv.
 */
export async function crearOrdenCaso(inv: Invocacion, caso: string, confirmado: boolean) {
  const { env, paquete, maestros, validacion } = await prepararCaso(inv, caso);
  const id = paquete.solicitud.solicitud_id;
  const codigos = (xs: { codigo: string }[]) => xs.map((x) => x.codigo);
  const fila = { solicitud_id: id, retroactiva: validacion.retroactiva, bloqueos: codigos(validacion.bloqueos), confirmaciones: codigos(validacion.confirmaciones) };

  if (!validacion.apta) {
    await registrarControl(env.outDir, { ...fila, resultado: 'BLOQUEADA', numero_oc: null });
    return fallo('No se crea la OC: hay controles bloqueantes. Ninguna confirmacion los salta.', {
      bloqueos: validacion.bloqueos,
      accion_sugerida: 'Corregir lo indicado con el solicitante o el lider y volver a procesar.',
    });
  }

  const sap = new SapMock(env);
  const existente = await sap.buscarOrdenPorReferencia(id);
  if (existente) {
    await registrarControl(env.outDir, { ...fila, resultado: 'CREADA_IDEMPOTENTE', numero_oc: existente.numero_oc });
    return ok({ numero_oc: existente.numero_oc, fecha: existente.fecha, idempotente: true });
  }

  const { payload: base } = construirPayload(paquete, maestros, validacion);
  const huella = huellaConfirmacion(base, validacion);
  let payload: OrdenCompra = base;
  if (validacion.confirmaciones.length) {
    if (!confirmado || !inv.confirmacion?.concedida(caso, huella)) {
      inv.confirmacion?.registrar(caso, huella, validacion.confirmaciones);
      await registrarControl(env.outDir, { ...fila, resultado: 'PENDIENTE_CONFIRMACION', numero_oc: null });
      return fallo('Falta la confirmacion humana explicita. Muestre las confirmaciones al usuario y espere su respuesta en el chat.', {
        requiere_confirmacion: true,
        confirmaciones: validacion.confirmaciones,
      });
    }
    const quien = inv.actor ?? 'analista-administrativa';
    payload = { ...base, excepciones: base.excepciones.map((e) => ({ ...e, confirmado_por: quien })) };
  }

  await escribirEvidencia(inv, caso);
  const { numero_oc, fecha } = await sap.crearOrden(payload);
  inv.confirmacion?.consumir(caso);
  await registrarControl(env.outDir, { ...fila, resultado: 'CREADA', numero_oc });
  return ok({ numero_oc, fecha, idempotente: false, retroactiva: validacion.retroactiva, evidencia: relativa(inv, path.join(env.outDir, caso, 'aprobacion.txt')) });
}
