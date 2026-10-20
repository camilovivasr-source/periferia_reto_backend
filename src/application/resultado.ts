import { DatosError } from '../data.js';
import { PayloadError } from '../domain/payload.js';

/** Contrato de salida de toda herramienta: JSON { ok:true, data } o { ok:false, error, ... }. Nunca se lanza. */
export const ok = (data: unknown): string => JSON.stringify({ ok: true, data });
export const fallo = (error: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ ok: false, error, ...extra });

/** Convierte excepciones en errores legibles; un fallo tecnico no se presenta como rechazo de negocio. */
export async function seguro(tarea: () => Promise<string>): Promise<string> {
  try {
    return await tarea();
  } catch (e) {
    if (e instanceof DatosError || e instanceof PayloadError) return fallo(e.message);
    return fallo(`Error tecnico inesperado: ${e instanceof Error ? e.message : 'desconocido'}. No es un rechazo de negocio.`);
  }
}
