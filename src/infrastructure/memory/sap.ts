import { hash } from '../../domain/fingerprint.js';
import type { Order } from '../../domain/models.js';
import type { SapPort } from '../../domain/ports.js';
import { MemoryState } from './state.js';
export class MemorySap implements SapPort{
 constructor(private readonly state=new MemoryState()){}
 async get(id:string){return this.state.orders.get(id);}
 async create(solicitudId:string,snapshot:string,expectedReviewHash?:string):Promise<Order>{
  const old=this.state.orders.get(solicitudId);
  if(old){if(old.snapshot!==snapshot)throw Error('Solicitud modificada despues de crear OC');return old;}
  if(expectedReviewHash!==undefined&&hash(this.state.reviews.get(solicitudId)??null)!==expectedReviewHash)throw Error('Decision cambio durante creacion: revalidar');
  const order={id:'OC-'+hash({solicitudId,snapshot}).slice(0,10).toUpperCase(),solicitudId,snapshot};this.state.orders.set(solicitudId,order);return order;
 }
 count(){return this.state.orders.size;}
}
