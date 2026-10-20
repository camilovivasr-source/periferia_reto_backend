import type { Maestros, Paquete, Proveedor } from '../../schemas.js';
import { normalizarNit, normalizarTexto } from '../util.js';
import { bloquea, cumple, type Regla } from './tipos.js';

/** Por NIT; si la solicitud no trae NIT, por nombre normalizado. Un NIT desconocido no se reintenta por nombre. */
export function resolverProveedor(p: Paquete, m: Maestros): Proveedor | null {
  const { proveedor_nit, proveedor_nombre } = p.solicitud;
  if (proveedor_nit) return m.proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(proveedor_nit)) ?? null;
  const nombre = normalizarTexto(proveedor_nombre);
  return m.proveedores.find((x) => normalizarTexto(x.nombre) === nombre) ?? null;
}

export const rc1Proveedor: Regla = {
  codigo: 'RC1',
  nombre: 'Proveedor existe y esta activo',
  evaluar({ paquete, proveedor }) {
    const s = paquete.solicitud;
    if (!proveedor) {
      const referencia = s.proveedor_nit ? `NIT ${s.proveedor_nit}` : `nombre "${s.proveedor_nombre}"`;
      return bloquea(`El proveedor (${referencia}) no existe en el maestro de proveedores. Accion: solicitar su alta en SAP antes de crear la OC.`);
    }
    if (!proveedor.activo) return bloquea(`El proveedor ${proveedor.nombre} (${proveedor.codigo_sap}) esta inactivo en el maestro.`);
    return { ...cumple(`${proveedor.nombre} (SAP ${proveedor.codigo_sap}).`), derivados: { proveedor_codigo_sap: proveedor.codigo_sap } };
  },
};
