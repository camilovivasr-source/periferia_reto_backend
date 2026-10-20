import type { Approval,Bundle,ReviewerPolicy } from './models.js';
import { hash } from './fingerprint.js';
export function authority(b:Bundle,actor:string,policies:ReviewerPolicy[]){
 const configured=policies.find(p=>p.id===actor),cc=b.masters.centros.find(c=>c.id===b.solicitud.centroCosto);
 if(configured)return configured;
 return cc?.liderId===actor?{id:actor,centros:[cc.id],topeCentavos:cc.topeCentavos,puedeRetroactiva:false}:undefined;
}
export function approvalScope(b:Bundle,a:Approval|undefined,policies:ReviewerPolicy[]){
 const p=a?authority(b,a.aprobadorId,policies):undefined,s=b.solicitud;
 const valid=!!a&&!!p&&p.centros.includes(s.centroCosto)&&s.totalCentavos<=p.topeCentavos&&a.solicitudId===s.id&&a.montoCentavos===s.totalCentavos&&a.requestHash===hash(s);
 return {valid,retroactive:valid&&!!p?.puedeRetroactiva&&!!a?.justificacion?.trim()};
}
