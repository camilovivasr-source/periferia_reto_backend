import type { ApprovalStore,AuditStore } from '../../domain/ports.js';
import type { StoredApproval,AuditEvent } from '../../domain/models.js';
import { MemoryState } from './state.js';
export class MemoryApprovalStore implements ApprovalStore{
 constructor(private readonly state=new MemoryState()){}
 async get(id:string){return this.state.reviews.get(id);}
 async set(id:string,value:StoredApproval){if(this.state.orders.has(id))throw Error('OC creada: no modificar decision');this.state.reviews.set(id,value);}
}
export class MemoryAuditStore implements AuditStore{
 constructor(private readonly state=new MemoryState()){}
 async append(event:AuditEvent){this.state.audit.push(event);}
 async list(id:string){return this.state.audit.filter(e=>e.solicitudId===id);}
}
