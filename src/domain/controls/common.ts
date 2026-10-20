// COMPLETAR(PRD): Ajustar estructura de evidencia si necesitas valor esperado, obtenido, fuente y referencia de documento.
// Ver ficha de este archivo en ARQUITECTURA.md.
import type { Check } from '../models.js';
export const check=(codigo:string,ok:boolean,motivo:string,pending=false):Check=>({codigo,resultado:ok?'CUMPLE':pending?'PENDIENTE':'BLOQUEA',motivo});
