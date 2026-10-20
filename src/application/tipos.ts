import type { Hallazgo } from '../schemas.js';

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

/** Quien invoca un caso de uso: raiz del proyecto, actor humano y puerto de confirmacion. */
export type Invocacion = {
  directory: string;
  actor?: string;
  confirmacion?: ConfirmacionPuerto;
};
