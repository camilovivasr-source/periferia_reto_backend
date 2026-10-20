import { randomUUID } from 'node:crypto';
import { validate } from '../domain/validate.js';
import { hash } from '../domain/fingerprint.js';
import { authority } from '../domain/reviewer.js';
import type { RequestRepository,SapPort,ApprovalStore,AuditStore } from '../domain/ports.js';
import type { Bundle,Result,StoredApproval,ReviewerPolicy } from '../domain/models.js';
import type { RequestCommand,ConfirmationCommand } from '../contracts/commands.js';
export class PurchaseService{
 constructor(private readonly repository:RequestRepository,readonly sap:SapPort,private readonly approvals:ApprovalStore,private readonly audit:AuditStore,private readonly policies:ReviewerPolicy[]=[]){ }
 private async evaluate(b:Bundle):Promise<{result:Result;decision:StoredApproval|undefined}>{
  const decision=await this.approvals.get(b.solicitud.id),active=decision?.snapshot===b.snapshot?decision:undefined;
  const result=validate(b,active?.approval,this.policies);result.resumen=b.solicitud;
  if(active?.rejection){result.estado='RECHAZADA';result.controles.push({codigo:'RECHAZO_HUMANO',resultado:'BLOQUEA',motivo:active.rejection.justificacion});}
  const order=await this.sap.get(b.solicitud.id);
  if(order){if(order.snapshot!==b.snapshot)throw Error('OC creada con otra version; revision manual requerida');result.estado='CREADA';result.oc=order.id;result.sap={simulado:true,oc:order.id,solicitudId:order.solicitudId};}
  return {result,decision};
 }
 private async log(b:Bundle,action:string,actorId:string,justificacion?:string,oc?:string){await this.audit.append({id:randomUUID(),solicitudId:b.solicitud.id,action,actorId,fecha:new Date().toISOString(),snapshot:b.snapshot,...(justificacion?{justificacion}:{}),...(oc?{oc}:{})});}
 async verificar({solicitudId}:RequestCommand){return (await this.evaluate(await this.repository.load(solicitudId))).result;}
 async inspeccionar(command:RequestCommand,actorId?:string){
  const b=await this.repository.load(command.solicitudId),{result}=await this.evaluate(b),p=actorId?authority(b,actorId,this.policies):undefined;
  const blocked=result.controles.some(c=>c.resultado==='BLOQUEA'),retro=b.facturaDatos?.valida&&b.facturaDatos.fecha!<b.solicitud.fechaSolicitud;
  const scope=!!p&&p.centros.includes(b.solicitud.centroCosto),can=scope&&b.solicitud.totalCentavos<=p!.topeCentavos&&(!retro||p!.puedeRetroactiva);
  result.revision={actorId,puedeAprobar:result.estado!=='CREADA'&&!blocked&&can,puedeRechazar:result.estado!=='CREADA'&&scope,motivo:!actorId?'Iniciar sesion de revisor':!scope?'Actor sin alcance para este centro':!can?'Se requiere autoridad superior o de retroactividad':blocked?'Corregir controles bloqueantes':'Revision autorizada dentro del alcance configurado'};
  return {...result,auditoria:await this.audit.list(command.solicitudId)};
 }
 async crear({solicitudId}:RequestCommand){
  const b=await this.repository.load(solicitudId),{result,decision}=await this.evaluate(b);
  if(result.estado==='CREADA')return result;
  if(result.estado!=='LISTA_PARA_CREAR')return result;
  const order=await this.sap.create(solicitudId,b.snapshot,hash(decision??null));
  await this.log(b,'OC_CREADA','sistema',undefined,order.id);
  return {...result,estado:'CREADA' as const,oc:order.id,sap:{simulado:true as const,oc:order.id,solicitudId}};
 }
 async confirmar(command:ConfirmationCommand,actor:string){
  this.reason(command.justificacion);const b=await this.repository.load(command.solicitudId);
  if(command.snapshot!==b.snapshot)throw Error('Datos cambiaron: revalidar');
  if(await this.sap.get(command.solicitudId))throw Error('OC creada: no modificar decision');
  const stored=await this.approvals.get(command.solicitudId);if(stored?.snapshot===b.snapshot&&stored.rejection)throw Error('Solicitud rechazada: reabrir requiere procedimiento explicito');
  const p=authority(b,actor,this.policies);if(!p||!p.centros.includes(b.solicitud.centroCosto)||b.solicitud.totalCentavos>p.topeCentavos)throw Error('Actor sin autoridad suficiente');
  const approval={solicitudId:command.solicitudId,aprobadorId:actor,montoCentavos:b.solicitud.totalCentavos,requestHash:hash(b.solicitud),justificacion:command.justificacion,fecha:new Date().toISOString()};
  const trial=validate(b,approval,this.policies);
  if(trial.estado!=='LISTA_PARA_CREAR')throw Error('La aprobacion no resuelve controles: '+trial.controles.filter(c=>c.resultado!=='CUMPLE').map(c=>c.codigo).join(', '));
  await this.approvals.set(command.solicitudId,{snapshot:b.snapshot,approval});await this.log(b,'APROBACION_HUMANA',actor,command.justificacion);return this.verificar(command);
 }
 async rechazar(command:ConfirmationCommand,actor:string){
  this.reason(command.justificacion);const b=await this.repository.load(command.solicitudId);
  if(command.snapshot!==b.snapshot)throw Error('Datos cambiaron: revalidar');
  if(await this.sap.get(command.solicitudId))throw Error('OC creada: no se puede rechazar');
  const p=authority(b,actor,this.policies);if(!p||!p.centros.includes(b.solicitud.centroCosto))throw Error('Actor sin alcance para este centro');
  await this.approvals.set(command.solicitudId,{snapshot:b.snapshot,rejection:{actorId:actor,justificacion:command.justificacion,fecha:new Date().toISOString()}});await this.log(b,'RECHAZO_HUMANO',actor,command.justificacion);return this.verificar(command);
 }
 private reason(value:string){if(!value||value.trim().length<10)throw Error('Justificacion requerida: minimo 10 caracteres');}
}
