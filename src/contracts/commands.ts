// COMPLETAR(PRD): Ajustar IDs al repositorio real y campos de comandos. Mantener .strict() cuando deba rechazarse información extra.
// Ver ficha de este archivo en ARQUITECTURA.md.
import { z } from 'zod';
export const idSchema=z.string().regex(/^sol-\d{3}$/);
export const requestCommand=z.object({solicitudId:idSchema}).strict();
export const confirmationCommand=requestCommand.extend({snapshot:z.string().length(64),justificacion:z.string().trim().min(10).max(2000)}).strict();
export const chatCommand=z.object({message:z.string().min(1).max(4000)}).strict();
export type RequestCommand=z.infer<typeof requestCommand>;
export type ConfirmationCommand=z.infer<typeof confirmationCommand>;
