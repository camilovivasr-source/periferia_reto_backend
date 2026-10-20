import { cargarMaestros, leerPaquete, listarCasos, type Entorno } from '../../data.js';
import { validar } from '../../domain/validate.js';
import { SapMock } from '../../sap/mock.js';
import type { Maestros, Paquete, Validacion } from '../../schemas.js';

export type CasoAnalizado = {
  caso: string;
  paquete: Paquete;
  validacion: Validacion;
  oc: { numero_oc: string; fecha: string } | null;
};

export type Universo = { maestros: Maestros; casos: CasoAnalizado[]; conError: Array<{ caso: string; error: string }> };

/** Carga todos los casos con su validacion y su OC (si existe). Un caso con datos malos no impide analizar los demas. */
export async function cargarUniverso(env: Entorno): Promise<Universo> {
  const [nombres, maestros] = await Promise.all([listarCasos(env), cargarMaestros(env)]);
  const sap = new SapMock(env);
  const casos: CasoAnalizado[] = [];
  const conError: Universo['conError'] = [];
  for (const caso of nombres) {
    try {
      const paquete = await leerPaquete(env, caso);
      casos.push({ caso, paquete, validacion: validar(paquete, maestros), oc: await sap.buscarOrdenPorReferencia(paquete.solicitud.solicitud_id) });
    } catch (e) {
      conError.push({ caso, error: e instanceof Error ? e.message : 'error de datos' });
    }
  }
  return { maestros, casos, conError };
}

export const dias = (desde: string, hasta: string): number => Math.round((Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`) - Date.parse(`${desde.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
export const porcentaje = (parte: number, total: number): number => (total ? Math.round((parte / total) * 1000) / 10 : 0);
