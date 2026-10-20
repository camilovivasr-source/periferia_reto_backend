// COMPLETAR(PRD): Completar controles faltantes y política de prioridad de estados. Si se exige detener en el primer bloqueo, aplicarlo explícitamente.
// Ver ficha de este archivo en ARQUITECTURA.md.
import type { Bundle,Approval,Result,ReviewerPolicy } from './models.js';
import { referenceControls } from './controls/reference.js';
import { financialControls } from './controls/financial.js';
import { authorizationControls } from './controls/authorization.js';
import { documentControls } from './controls/documents.js';
/** Politicas educativas: sustituir segun PRD oficial. Sin lecturas ni llamadas externas. */
export function validate(b:Bundle,human?:Approval,policies:ReviewerPolicy[]=[]):Result{
 const controles=[...referenceControls(b),...financialControls(b),...documentControls(b,human,policies),...authorizationControls(b,human,policies)];
 const estado=controles.some(c=>c.resultado==='BLOQUEA')?'RECHAZADA':controles.some(c=>c.resultado==='PENDIENTE')?'REQUIERE_APROBACION':'LISTA_PARA_CREAR';
 return {solicitudId:b.solicitud.id,estado,controles,snapshot:b.snapshot};
}
