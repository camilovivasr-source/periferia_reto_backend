import { Firestore,FieldValue } from '@google-cloud/firestore';
import { z } from 'zod';
import type { ApprovalStore,SapPort,AuditStore } from '../../domain/ports.js';
import type { StoredApproval,Order,AuditEvent } from '../../domain/models.js';
import { hash } from '../../domain/fingerprint.js';
import { approvalSchema } from '../files/schemas.js';
const stored=z.object({snapshot:z.string(),approval:approvalSchema.optional(),rejection:z.object({actorId:z.string(),justificacion:z.string(),fecha:z.string()}).optional()}).refine(v=>!!v.approval!==!!v.rejection,'Decision debe ser aprobacion o rechazo');
const orderSchema=z.object({id:z.string(),solicitudId:z.string(),snapshot:z.string()});
export class FirestoreApprovalStore implements ApprovalStore{
 constructor(private readonly db:Firestore){}
 async get(id:string){const doc=await this.db.collection('purchaseApprovals').doc(id).get();return doc.exists?stored.parse(doc.data()):undefined;}
 async set(id:string,value:StoredApproval){
  await this.db.runTransaction(async tx=>{const order=await tx.get(this.db.collection('purchaseOrders').doc(id));if(order.exists)throw Error('OC creada: no modificar decision');tx.set(this.db.collection('purchaseApprovals').doc(id),{...stored.parse(value),updatedAt:FieldValue.serverTimestamp()});});
 }
}
export class FirestoreSap implements SapPort{
 constructor(private readonly db:Firestore){}
 async get(id:string){const doc=await this.db.collection('purchaseOrders').doc(id).get();return doc.exists?orderSchema.parse(doc.data()):undefined;}
 async create(solicitudId:string,snapshot:string,expectedReviewHash?:string):Promise<Order>{
  const ref=this.db.collection('purchaseOrders').doc(solicitudId);
  return this.db.runTransaction(async tx=>{
   const existing=await tx.get(ref);if(existing.exists){const order=orderSchema.parse(existing.data());if(order.snapshot!==snapshot)throw Error('Solicitud modificada despues de crear OC');return order;}
   const review=await tx.get(this.db.collection('purchaseApprovals').doc(solicitudId));
   if(expectedReviewHash!==undefined&&hash(review.exists?stored.parse(review.data()):null)!==expectedReviewHash)throw Error('Decision cambio durante creacion: revalidar');
   const order={id:'OC-'+hash({solicitudId,snapshot}).slice(0,10).toUpperCase(),solicitudId,snapshot};tx.create(ref,{...order,createdAt:FieldValue.serverTimestamp()});return order;
  });
 }
}
export class FirestoreAuditStore implements AuditStore{
 constructor(private readonly db:Firestore){}
 async append(event:AuditEvent){await this.db.collection('purchaseAudit').doc(event.id).set(event);}
 async list(id:string){const docs=await this.db.collection('purchaseAudit').where('solicitudId','==',id).limit(200).get();return docs.docs.map(d=>d.data() as AuditEvent).sort((a,b)=>a.fecha.localeCompare(b.fecha));}
}
