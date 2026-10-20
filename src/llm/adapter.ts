import type { HerramientaDef } from '../tools/registry.js';

export type LlamadaHerramienta = { id: string; nombre: string; args: Record<string, unknown> };

export type Mensaje =
  | { rol: 'system'; contenido: string }
  | { rol: 'user'; contenido: string }
  /** `crudo` conserva las partes nativas del proveedor (firmas de razonamiento) para devolverlas tal cual. */
  | { rol: 'assistant'; contenido: string; llamadas?: LlamadaHerramienta[]; crudo?: unknown[] }
  | { rol: 'tool'; llamadaId: string; nombre: string; contenido: string };

export type MensajeAsistente = Extract<Mensaje, { rol: 'assistant' }>;
export type Respuesta = { mensaje: MensajeAsistente; tokens: number };

/** Interfaz propia del proveedor: cambiar de modelo no toca el ciclo del agente. */
export interface LlmAdapter {
  readonly proveedor: string;
  readonly modelo: string;
  enviar(mensajes: Mensaje[], herramientas: HerramientaDef[]): Promise<Respuesta>;
}

/** Error del proveedor con un mensaje apto para mostrar al usuario (nunca incluye claves). */
export class LlmError extends Error {}
