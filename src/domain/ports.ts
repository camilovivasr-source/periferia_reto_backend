// COMPLETAR(PRD): Extender contratos si necesitas persistencia, consultas de estado ERP o auditoría exigida. Para store remoto, convertir operaciones a asíncronas y propagar await.
// Ver ficha de este archivo en ARQUITECTURA.md.
import type { Bundle,Order,StoredApproval,AuditEvent } from './models.js';
/** Contratos: el dominio y servicio no conocen disco ni SAP concreto. */
export interface RequestRepository {list():Promise<string[]>;load(id:string):Promise<Bundle>;}
export interface SapPort {get(id:string):Promise<Order|undefined>;create(solicitudId:string,snapshot:string,expectedReviewHash?:string):Promise<Order>;}
export interface ApprovalStore {get(id:string):Promise<StoredApproval|undefined>;set(id:string,value:StoredApproval):Promise<void>;}

export interface AuditStore{append(event:AuditEvent):Promise<void>;list(id:string):Promise<AuditEvent[]>;}
