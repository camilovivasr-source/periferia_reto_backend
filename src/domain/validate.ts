import type { CentroCosto, Control, Derivados, Hallazgo, Maestros, Paquete, Validacion } from '../schemas.js';
import { rc2Aprobacion, rc3Tope } from './controls/autorizacion.js';
import { rc10Aritmetica } from './controls/aritmetica.js';
import { rc5Cotizacion, rc8Retroactiva, rc9FechaAprobacion } from './controls/documentos.js';
import { rc4Subarea } from './controls/imputacion.js';
import { rc6IndicadorIva, rc7CondicionesPago, rc11CodigosMaestros } from './controls/impuestos.js';
import { resolverProveedor, rc1Proveedor } from './controls/proveedor.js';
import type { Aprobador, ContextoValidacion, Regla } from './controls/tipos.js';

export { resolverProveedor };

/** Orden de evaluacion y de presentacion. RC11 va al final porque revisa tambien los valores derivados. */
export const REGLAS: readonly Regla[] = [
  rc1Proveedor, rc2Aprobacion, rc3Tope, rc4Subarea, rc5Cotizacion, rc6IndicadorIva,
  rc7CondicionesPago, rc8Retroactiva, rc9FechaAprobacion, rc10Aritmetica, rc11CodigosMaestros,
];

export const resolverCentro = (p: Paquete, m: Maestros): CentroCosto | null =>
  m.centros.find((c) => c.centro_costo === p.solicitud.centro_costo) ?? null;

function resolverAprobador(p: Paquete, centro: CentroCosto | null): Aprobador | null {
  if (!p.aprobacion || !centro) return null;
  return centro.aprobadores.find((x) => x.email.toLowerCase() === p.aprobacion!.de) ?? null;
}

/**
 * Aplica RC1..RC11 al paquete. Es la unica fuente de verdad de los controles: el chat, el demo y
 * `oc_crear` (que revalida siempre) llaman a esta misma funcion.
 */
export function validar(paquete: Paquete, maestros: Maestros): Validacion {
  const centro = resolverCentro(paquete, maestros);
  const ctx: ContextoValidacion = { paquete, maestros, proveedor: resolverProveedor(paquete, maestros), centro, aprobador: resolverAprobador(paquete, centro) };

  const controles: Control[] = [];
  const bloqueos: Hallazgo[] = [];
  const confirmaciones: Hallazgo[] = [];
  const derivados: Derivados = {};
  let retroactiva = false;

  for (const regla of REGLAS) {
    const v = regla.evaluar(ctx, derivados);
    controles.push({ codigo: regla.codigo, regla: regla.nombre, estado: v.estado, detalle: v.detalle });
    if (v.estado === 'BLOQUEA') bloqueos.push({ codigo: regla.codigo, detalle: v.detalle });
    if (v.estado === 'CONFIRMA') confirmaciones.push({ codigo: regla.codigo, detalle: v.detalle });
    Object.assign(derivados, v.derivados);
    retroactiva ||= v.retroactiva === true;
  }
  return { apta: bloqueos.length === 0, bloqueos, confirmaciones, derivados, retroactiva, controles };
}
