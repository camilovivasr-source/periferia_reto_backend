import type { z } from 'zod';
import type { Invocacion } from '../application/tipos.js';

export type { ConfirmacionPuerto } from '../application/tipos.js';

/** Contexto de una llamada a herramienta: quien invoca (PRD 6.2) mas la sesion para el registro. */
export type ToolContext = Invocacion & { sessionId: string };

export type ToolDef<S extends z.ZodRawShape> = {
  description: string;
  args: S;
  execute(args: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<string>;
};
