import type { Order,StoredApproval,AuditEvent } from '../../domain/models.js';
export class MemoryState{orders=new Map<string,Order>();reviews=new Map<string,StoredApproval>();audit:AuditEvent[]=[];}
