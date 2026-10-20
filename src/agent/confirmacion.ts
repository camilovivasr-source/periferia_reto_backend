import type { ConfirmacionPuerto } from '../application/tipos.js';
import type { Hallazgo } from '../schemas.js';
import type { Pendiente } from './tipos.js';

/**
 * Interpreta la respuesta humana a una pregunta de confirmacion.
 * Si el mensaje es una pregunta, no cuenta como confirmacion.
 */
export function interpretarRespuesta(texto: string): 'confirma' | 'rechaza' | 'otro' {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/[?¿]/.test(t)) return 'otro';
  if (/\b(no|cancela\w*|rechaz\w*|detente|espera|todavia no|aun no)\b/.test(t)) return 'rechaza';
  if (/\b(confirmo|confirmado|confirmada|si|adelante|procede|proceder|crea\w*|hazlo|dale|ok|okay|de acuerdo|autorizo|acepto)\b/.test(t)) return 'confirma';
  return 'otro';
}

export const casosMencionados = (texto: string): string[] => [...new Set([...texto.toLowerCase().matchAll(/sol-\d{3}/g)].map((m) => m[0]))];

/**
 * Estado de confirmaciones de UNA sesion. La concesion la da la persona (su mensaje), no el modelo:
 * dura un solo turno y solo vale para la huella exacta que se le mostro.
 */
export class ConfirmacionSesion implements ConfirmacionPuerto {
  private readonly pendientes = new Map<string, { huella: string; confirmaciones: Hallazgo[] }>();
  private readonly concedidas = new Map<string, string>();

  registrar(caso: string, huella: string, confirmaciones: Hallazgo[]): void {
    this.pendientes.set(caso, { huella, confirmaciones });
  }

  concedida(caso: string, huella: string): boolean {
    return this.concedidas.get(caso) === huella;
  }

  consumir(caso: string): void {
    this.pendientes.delete(caso);
    this.concedidas.delete(caso);
  }

  descartar(caso: string): void {
    this.pendientes.delete(caso);
  }

  /** Aplica el mensaje del usuario: "confirmo" concede, "no" descarta; se limita a los casos que nombre, si nombra alguno. */
  aplicarMensaje(mensaje: string): void {
    this.concedidas.clear();
    if (!this.pendientes.size) return;
    const mencionados = casosMencionados(mensaje);
    const alcance = [...this.pendientes.keys()].filter((c) => !mencionados.length || mencionados.includes(c));
    const respuesta = interpretarRespuesta(mensaje);
    if (respuesta === 'confirma') for (const c of alcance) this.concedidas.set(c, this.pendientes.get(c)!.huella);
    if (respuesta === 'rechaza') for (const c of alcance) this.pendientes.delete(c);
  }

  /** La concesion no sobrevive al turno. */
  cerrarTurno(): void {
    this.concedidas.clear();
  }

  listarPendientes(): Pendiente[] {
    return [...this.pendientes].map(([caso, v]) => ({ caso, confirmaciones: v.confirmaciones }));
  }
}
