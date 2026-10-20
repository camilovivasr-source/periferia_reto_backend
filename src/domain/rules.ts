import type { CentroCosto, Control, Derivados, Hallazgo, Maestros, Paquete, Proveedor, Validacion } from './types.js';
import { fechaLocal } from './data.js';
import { normalizarNit, normalizarTexto } from './util.js';

const TOLERANCIA_COTIZACION = 0.02;
const TOLERANCIA_ARITMETICA = 1;
const cop = (n: number) => `${n.toLocaleString('es-CO')}`;

/** RC1: por NIT; si la solicitud no trae NIT, por nombre normalizado. */
export function resolverProveedor(p: Paquete, m: Maestros): Proveedor | null {
  const { proveedor_nit, proveedor_nombre } = p.solicitud;
  if (proveedor_nit) return m.proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(proveedor_nit)) ?? null;
  const nombre = normalizarTexto(proveedor_nombre);
  return m.proveedores.find((x) => normalizarTexto(x.nombre) === nombre) ?? null;
}

export const resolverCentro = (p: Paquete, m: Maestros): CentroCosto | null =>
  m.centros.find((c) => c.centro_costo === p.solicitud.centro_costo) ?? null;

type Acumulador = { controles: Control[]; bloqueos: Hallazgo[]; confirmaciones: Hallazgo[] };

function registrar(a: Acumulador, codigo: string, regla: string, estado: Control['estado'], detalle: string) {
  a.controles.push({ codigo, regla, estado, detalle });
  if (estado === 'BLOQUEA') a.bloqueos.push({ codigo, detalle });
  if (estado === 'CONFIRMA') a.confirmaciones.push({ codigo, detalle });
}

/**
 * Aplica RC1..RC10 (PRD 7.3) y RC11 (supuesto: codigos de IVA/pago deben existir en maestros).
 * Es la unica fuente de verdad: el chat, el demo y oc_crear llaman a esta misma funcion.
 */
export function validar(p: Paquete, m: Maestros): Validacion {
  const a: Acumulador = { controles: [], bloqueos: [], confirmaciones: [] };
  const s = p.solicitud;
  const derivados: Derivados = {};
  const proveedor = resolverProveedor(p, m);
  const centro = resolverCentro(p, m);

  // RC1 proveedor
  if (!proveedor) {
    const ref = s.proveedor_nit ? `NIT ${s.proveedor_nit}` : `nombre "${s.proveedor_nombre}"`;
    registrar(a, 'RC1', 'Proveedor existe y esta activo', 'BLOQUEA', `El proveedor (${ref}) no existe en el maestro de proveedores. Accion: solicitar su alta en SAP antes de crear la OC.`);
  } else if (!proveedor.activo) {
    registrar(a, 'RC1', 'Proveedor existe y esta activo', 'BLOQUEA', `El proveedor ${proveedor.nombre} (${proveedor.codigo_sap}) esta inactivo en el maestro.`);
  } else {
    derivados.proveedor_codigo_sap = proveedor.codigo_sap;
    registrar(a, 'RC1', 'Proveedor existe y esta activo', 'CUMPLE', `${proveedor.nombre} (SAP ${proveedor.codigo_sap}).`);
  }

  // RC2 aprobacion (existencia, "Aprobado", remitente autorizado para el centro)
  const aprobador = p.aprobacion && centro ? centro.aprobadores.find((x) => x.email.toLowerCase() === p.aprobacion!.de) : undefined;
  const problemasAprobacion: string[] = [];
  if (!p.aprobacion) problemasAprobacion.push('no hay correo de aprobacion');
  else {
    if (!p.aprobacion.aprobado) problemasAprobacion.push('el correo no contiene un "Aprobado" explicito');
    if (!centro) problemasAprobacion.push(`el centro ${s.centro_costo} no existe, no hay aprobadores que verificar`);
    else if (!aprobador) {
      const lista = centro.aprobadores.map((x) => x.email).join(', ');
      problemasAprobacion.push(`${p.aprobacion.de} no figura como aprobador del centro ${centro.centro_costo} (aprobadores: ${lista})`);
    }
  }
  if (problemasAprobacion.length) {
    registrar(a, 'RC2', 'Aprobacion explicita de un aprobador del centro', 'BLOQUEA', `${problemasAprobacion.join('; ')}. Accion: pedir aprobacion al lider del centro.`);
  } else {
    registrar(a, 'RC2', 'Aprobacion explicita de un aprobador del centro', 'CUMPLE', `${aprobador!.nombre ?? aprobador!.email} aprobo por correo.`);
  }

  // RC3 tope del aprobador
  if (s.moneda !== 'COP') {
    registrar(a, 'RC3', 'Valor total dentro del tope del aprobador', 'BLOQUEA', `Los topes estan definidos en COP y la solicitud es en ${s.moneda}; no hay tasa de cambio en los maestros para compararlos.`);
  } else if (aprobador) {
    derivados.aprobador_tope = aprobador.tope;
    if (s.valor_total <= aprobador.tope) registrar(a, 'RC3', 'Valor total dentro del tope del aprobador', 'CUMPLE', `${cop(s.valor_total)} <= tope ${cop(aprobador.tope)}.`);
    else registrar(a, 'RC3', 'Valor total dentro del tope del aprobador', 'BLOQUEA', `${cop(s.valor_total)} supera el tope de ${aprobador.nombre ?? aprobador.email} (${cop(aprobador.tope)}). Accion: aprobacion de un nivel superior.`);
  } else if (centro) {
    const maximo = Math.max(...centro.aprobadores.map((x) => x.tope));
    if (s.valor_total > maximo) {
      registrar(a, 'RC3', 'Valor total dentro del tope del aprobador', 'BLOQUEA', `${cop(s.valor_total)} supera incluso el mayor tope del centro ${centro.centro_costo} (${cop(maximo)}). Accion: escalar a una autoridad superior.`);
    } else registrar(a, 'RC3', 'Valor total dentro del tope del aprobador', 'NO_APLICA', 'No evaluable: el remitente no es aprobador del centro (ver RC2).');
  } else registrar(a, 'RC3', 'Valor total dentro del tope del aprobador', 'NO_APLICA', 'No evaluable: el centro de costo no existe (ver RC4).');

  // RC4 subarea pertenece al centro
  if (!centro) registrar(a, 'RC4', 'Subarea pertenece al centro de costo', 'BLOQUEA', `El centro de costo ${s.centro_costo} no existe en el maestro.`);
  else if (!centro.subareas.some((x) => normalizarTexto(x) === normalizarTexto(s.subarea))) {
    registrar(a, 'RC4', 'Subarea pertenece al centro de costo', 'BLOQUEA', `La subarea "${s.subarea}" no pertenece a ${centro.centro_costo} (subareas: ${centro.subareas.join(', ')}).`);
  } else registrar(a, 'RC4', 'Subarea pertenece al centro de costo', 'CUMPLE', `${s.subarea} pertenece a ${centro.centro_costo}.`);

  // RC5 cotizacion vs solicitud (tolerancia 2 %)
  const c = p.cotizacion;
  if (!c) registrar(a, 'RC5', 'Cotizacion coincide con la solicitud (+-2 %)', 'CONFIRMA', 'No hay cotizacion en el paquete: confirmar si se crea sin ella.');
  else if (c.total === null) registrar(a, 'RC5', 'Cotizacion coincide con la solicitud (+-2 %)', 'CONFIRMA', 'No se pudo leer el total de la cotizacion: verificarlo manualmente.');
  else {
    const dif = Math.abs(c.total - s.valor_total) / s.valor_total;
    const avisos: string[] = [];
    if (dif > TOLERANCIA_COTIZACION) avisos.push(`la cotizacion suma ${cop(c.total)} y la solicitud ${cop(s.valor_total)} (diferencia ${(dif * 100).toFixed(1)} %, tolerancia 2 %)`);
    if (c.moneda && c.moneda !== s.moneda) avisos.push(`moneda de la cotizacion ${c.moneda} distinta de ${s.moneda}`);
    if (c.nit && s.proveedor_nit && normalizarNit(c.nit) !== normalizarNit(s.proveedor_nit)) avisos.push(`NIT de la cotizacion ${c.nit} distinto del de la solicitud ${normalizarNit(s.proveedor_nit)}`);
    if (c.nit && proveedor && normalizarNit(c.nit) !== normalizarNit(proveedor.nit)) avisos.push(`NIT de la cotizacion ${c.nit} distinto del del proveedor en maestro ${proveedor.nit}`);
    if (avisos.length) registrar(a, 'RC5', 'Cotizacion coincide con la solicitud (+-2 %)', 'CONFIRMA', `${avisos.join('; ')}.`);
    else registrar(a, 'RC5', 'Cotizacion coincide con la solicitud (+-2 %)', 'CUMPLE', `Cotizacion ${cop(c.total)} vs solicitud ${cop(s.valor_total)} (${(dif * 100).toFixed(2)} %).`);
  }

  // RC6 indicador de IVA
  if (s.indicador_iva === undefined || s.indicador_iva === '') {
    if (proveedor) {
      derivados.indicador_iva = proveedor.indicador_iva_default;
      registrar(a, 'RC6', 'Indicador de IVA informado', 'CONFIRMA', `La solicitud no informa indicador de IVA; se derivo ${proveedor.indicador_iva_default} del proveedor ${proveedor.nombre}. Confirmar.`);
    } else registrar(a, 'RC6', 'Indicador de IVA informado', 'BLOQUEA', 'La solicitud no informa indicador de IVA y no se puede derivar sin proveedor valido.');
  } else registrar(a, 'RC6', 'Indicador de IVA informado', 'CUMPLE', `Indicador ${s.indicador_iva}.`);

  // RC7 condiciones de pago
  if (s.condiciones_pago === undefined || s.condiciones_pago === '') {
    if (proveedor) {
      derivados.condiciones_pago = proveedor.condiciones_pago_default;
      registrar(a, 'RC7', 'Condiciones de pago informadas', 'DERIVADO', `Derivadas del proveedor: ${proveedor.condiciones_pago_default}.`);
    } else registrar(a, 'RC7', 'Condiciones de pago informadas', 'BLOQUEA', 'No informadas y no se pueden derivar sin proveedor valido.');
  } else registrar(a, 'RC7', 'Condiciones de pago informadas', 'CUMPLE', `Condicion ${s.condiciones_pago}.`);

  // RC8 retroactividad (factura anterior a la solicitud)
  let retroactiva = false;
  if (!p.factura) registrar(a, 'RC8', 'Sin factura anterior a la solicitud', 'CUMPLE', 'No hay factura en el paquete.');
  else if (!p.factura.fecha) registrar(a, 'RC8', 'Sin factura anterior a la solicitud', 'CONFIRMA', 'Hay una factura pero no se pudo leer su fecha de emision: verificar si la compra es retroactiva.');
  else if (p.factura.fecha < s.fecha_solicitud) {
    retroactiva = true;
    registrar(a, 'RC8', 'Sin factura anterior a la solicitud', 'CONFIRMA', `Compra retroactiva: la factura ${p.factura.numero ?? '(sin numero)'} es del ${p.factura.fecha} y la solicitud del ${s.fecha_solicitud}. Se crea solo con confirmacion y queda marcada para el control.`);
  } else registrar(a, 'RC8', 'Sin factura anterior a la solicitud', 'CUMPLE', `Factura del ${p.factura.fecha}, posterior o igual a la solicitud.`);

  // RC9 fecha de aprobacion
  if (!p.aprobacion) registrar(a, 'RC9', 'Aprobacion no anterior a la solicitud', 'NO_APLICA', 'Sin correo de aprobacion (ver RC2).');
  else if (fechaLocal(p.aprobacion.fecha) < s.fecha_solicitud) {
    registrar(a, 'RC9', 'Aprobacion no anterior a la solicitud', 'CONFIRMA', `La aprobacion es del ${fechaLocal(p.aprobacion.fecha)} y la solicitud del ${s.fecha_solicitud}: se aprobo antes de existir la solicitud.`);
  } else registrar(a, 'RC9', 'Aprobacion no anterior a la solicitud', 'CUMPLE', `Aprobacion del ${fechaLocal(p.aprobacion.fecha)}.`);

  // RC10 aritmetica
  const calculado = s.cantidad * s.valor_unitario;
  if (Math.abs(calculado - s.valor_total) > TOLERANCIA_ARITMETICA) {
    registrar(a, 'RC10', 'cantidad x valor unitario = valor total', 'BLOQUEA', `${s.cantidad} x ${cop(s.valor_unitario)} = ${cop(calculado)}, pero el valor total es ${cop(s.valor_total)}.`);
  } else registrar(a, 'RC10', 'cantidad x valor unitario = valor total', 'CUMPLE', `${s.cantidad} x ${cop(s.valor_unitario)} = ${cop(calculado)}.`);

  // RC11 (supuesto): los codigos informados deben existir en los maestros
  const codigosIva = s.indicador_iva ? [s.indicador_iva] : [];
  const desconocidos: string[] = [];
  for (const cod of codigosIva) if (!m.indicadoresIva.some((x) => x.codigo === cod)) desconocidos.push(`indicador de IVA "${cod}"`);
  if (s.condiciones_pago && !m.condicionesPago.some((x) => x.codigo === s.condiciones_pago)) desconocidos.push(`condicion de pago "${s.condiciones_pago}"`);
  if (derivados.indicador_iva && !m.indicadoresIva.some((x) => x.codigo === derivados.indicador_iva)) desconocidos.push(`indicador de IVA derivado "${derivados.indicador_iva}"`);
  if (derivados.condiciones_pago && !m.condicionesPago.some((x) => x.codigo === derivados.condiciones_pago)) desconocidos.push(`condicion de pago derivada "${derivados.condiciones_pago}"`);
  if (desconocidos.length) registrar(a, 'RC11', 'Codigos de IVA y pago existen en maestros', 'BLOQUEA', `Codigos inexistentes en los maestros: ${desconocidos.join(', ')}.`);
  else registrar(a, 'RC11', 'Codigos de IVA y pago existen en maestros', 'CUMPLE', 'Codigos validos.');

  return { apta: a.bloqueos.length === 0, bloqueos: a.bloqueos, confirmaciones: a.confirmaciones, derivados, retroactiva, controles: a.controles };
}
