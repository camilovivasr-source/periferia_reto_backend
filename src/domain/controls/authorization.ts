import type { Bundle,Approval,Check,ReviewerPolicy } from '../models.js';
import { approvalScope } from '../reviewer.js';
import { check } from './common.js';
export function authorizationControls(b:Bundle,human?:Approval,policies:ReviewerPolicy[]=[]):Check[]{
 const s=b.solicitud,cc=b.masters.centros.find(c=>c.id===s.centroCosto),scope=approvalScope(b,human??b.aprobacion,policies);
 const within=!!cc&&(s.totalCentavos<=cc.topeCentavos||scope.valid);
 return [check('TOPE',within,within?'Monto cubierto por tope o autorizacion suficiente':'Excede tope; requiere autoridad superior',true),check('APROBACION',scope.valid,scope.valid?'Evidencia vigente y autoridad suficiente':'Aprobacion ausente, insuficiente o desactualizada',true)];
}
