import type { Mensaje } from '../llm/adapter.js';
import { ConfirmacionSesion } from './confirmacion.js';
import type { EntradaHistorial } from './tipos.js';

const MAX_SESIONES = 200;
const MAX_MENSAJES_CONTEXTO = 80;

export type Sesion = {
  id: string;
  /** Conversacion con el modelo (sin el system prompt). */
  mensajes: Mensaje[];
  /** Lo que ve la interfaz al recargar. */
  historial: EntradaHistorial[];
  confirmacion: ConfirmacionSesion;
  tokens: number;
  actualizada: number;
  /** Cola para atender un solo turno a la vez por sesion. */
  cola: Promise<unknown>;
};

/** Sesiones en memoria con expulsion de la mas antigua; el contexto enviado al modelo se recorta por turnos completos. */
export class Sesiones {
  private readonly porId = new Map<string, Sesion>();

  obtener(id: string): Sesion {
    let s = this.porId.get(id);
    if (!s) {
      this.expulsarSiLlena();
      s = { id, mensajes: [], historial: [], confirmacion: new ConfirmacionSesion(), tokens: 0, actualizada: Date.now(), cola: Promise.resolve() };
      this.porId.set(id, s);
    }
    s.actualizada = Date.now();
    return s;
  }

  historial(id: string): EntradaHistorial[] | null {
    return this.porId.get(id)?.historial ?? null;
  }

  /** Recorta empezando en un mensaje del usuario para no separar una llamada a herramienta de su resultado. */
  recortarContexto(s: Sesion): void {
    if (s.mensajes.length <= MAX_MENSAJES_CONTEXTO) return;
    let i = s.mensajes.length - MAX_MENSAJES_CONTEXTO;
    while (i < s.mensajes.length && s.mensajes[i].rol !== 'user') i++;
    s.mensajes = s.mensajes.slice(i);
  }

  private expulsarSiLlena(): void {
    if (this.porId.size < MAX_SESIONES) return;
    const vieja = [...this.porId.values()].sort((a, b) => a.actualizada - b.actualizada)[0];
    this.porId.delete(vieja.id);
  }
}
