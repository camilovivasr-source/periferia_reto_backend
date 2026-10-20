import type { Hallazgo } from '../schemas.js';

/** Una llamada a herramienta tal como la ve la interfaz (nombre, argumentos, resultado y tiempo). */
export type LlamadaUI = {
  id: string;
  nombre: string;
  args: unknown;
  ok: boolean;
  resumen: string;
  ms: number;
  resultado: unknown;
  ts: string;
};

export type Pendiente = { caso: string; confirmaciones: Hallazgo[] };

export type EventoAgente =
  | { tipo: 'tool_start'; id: string; nombre: string; args: unknown; ts: string }
  | { tipo: 'tool_end'; llamada: LlamadaUI };

export type RespuestaChat = {
  sessionId: string;
  reply: string;
  toolCalls: LlamadaUI[];
  needsConfirmation: boolean;
  pendientes: Pendiente[];
  sugerencias: string[];
  modo: string;
  tokensSesion: number;
};

export type EntradaHistorial = {
  rol: 'user' | 'assistant';
  contenido: string;
  ts: string;
  toolCalls?: LlamadaUI[];
  needsConfirmation?: boolean;
};
