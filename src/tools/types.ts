import type { z } from 'zod';
import type { Hallazgo } from '../domain/types.js';

/**
 * Puerto de confirmacion humana. Lo implementa quien conduce la conversacion (servidor o demo),
 * nunca el modelo: asi un `confirmado: true` escrito por el modelo no concede nada por si solo.
 */
export interface ConfirmacionPuerto {
  /** Deja constancia de que se pidio confirmar `huella` para `caso` (el front la resalta). */
  registrar(caso: string, huella: string, confirmaciones: Hallazgo[]): void;
  /** El humano confirmo, en su ultimo mensaje, exactamente esta huella. */
  concedida(caso: string, huella: string): boolean;
  /** La confirmacion se consume al crear. */
  consumir(caso: string): void;
}

export type ToolContext = {
  directory: string;
  sessionId: string;
  actor?: string;
  confirmacion?: ConfirmacionPuerto;
};

export type ToolDef<S extends z.ZodRawShape> = {
  description: string;
  args: S;
  execute(args: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<string>;
};
