import type { Entorno } from '../../data.js';
import { construirPayload } from '../../domain/payload.js';
import { cargarUniverso } from './casos.js';

const celda = (v: unknown): string => {
  const t = String(v ?? '');
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

const COLUMNAS = ['estado', 'numero_oc', 'solicitud_id', 'sociedad', 'org_compras', 'proveedor_sap', 'proveedor_nit', 'moneda', 'condiciones_pago', 'posicion', 'descripcion', 'cantidad', 'unidad', 'precio_unitario', 'precio_incluye_iva', 'indicador_iva', 'centro_costo', 'subarea', 'aprobador', 'evidencia_sha256', 'excepciones'];

/**
 * Plan B del PRD (7.5): archivo de carga masiva con las OC listas para pegar/cargar en SAP.
 * Incluye las ya creadas y las aptas; las bloqueadas no salen nunca.
 */
export async function exportarCargaSap(env: Entorno): Promise<{ csv: string; filas: number; omitidas: string[] }> {
  const { casos, maestros } = await cargarUniverso(env);
  const lineas = [COLUMNAS.join(';')];
  const omitidas: string[] = [];
  for (const c of casos) {
    if (!c.validacion.apta) {
      omitidas.push(c.caso);
      continue;
    }
    const { payload } = construirPayload(c.paquete, maestros, c.validacion);
    const estado = c.oc ? 'CREADA' : c.validacion.confirmaciones.length ? 'REQUIERE_CONFIRMACION' : 'LISTA';
    for (const pos of payload.posiciones) {
      lineas.push(
        [estado, c.oc?.numero_oc ?? '', payload.referencia.solicitud_id, payload.sociedad, payload.organizacion_compras, payload.proveedor.codigo_sap, payload.proveedor.nit, payload.moneda, payload.condiciones_pago, pos.numero, pos.descripcion, pos.cantidad, pos.unidad, pos.precio_unitario, pos.precio_incluye_iva, pos.indicador_iva, pos.centro_costo, pos.subarea, payload.aprobador.email, payload.aprobador.evidencia_sha256, payload.excepciones.map((e) => e.codigo).join('|')]
          .map(celda)
          .join(';'),
      );
    }
  }
  return { csv: lineas.join('\n') + '\n', filas: lineas.length - 1, omitidas };
}
