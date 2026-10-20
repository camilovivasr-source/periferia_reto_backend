// COMPLETAR(PRD): Definir qué campos invalidan aprobación; considerar serialización canónica si otros productores generan hashes.
// Ver ficha de este archivo en ARQUITECTURA.md.
import { createHash } from 'node:crypto';
/** Deteccion de cambios, NO identidad ni firma digital. */
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
