import type { OrdenCompra } from '../domain/types.js';

/** Puerto hacia SAP. El dominio sabe si la compra cumple; el adaptador sabe como hablar con SAP. */
export interface SapAdapter {
  consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null>;
  crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }>;
  buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string; fecha: string } | null>;
}
