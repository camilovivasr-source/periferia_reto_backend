import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreSap,FirestoreApprovalStore } from '../src/infrastructure/firestore/state.js';
function fakeDb(){
 const values=new Map<string,unknown>();
 const doc=(key:string)=>({key,async get(){return {exists:values.has(key),data:()=>values.get(key)};},async set(value:unknown){values.set(key,value);}});
 const db={collection:(name:string)=>({doc:(id:string)=>doc(name+'/'+id)}),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({get:(ref:ReturnType<typeof doc>)=>ref.get(),set:(ref:ReturnType<typeof doc>,value:unknown)=>values.set(ref.key,value),create:(ref:ReturnType<typeof doc>,value:unknown)=>{if(values.has(ref.key))throw Error('Duplicado');values.set(ref.key,value);}})};
 return db as unknown as Firestore;
}
test('SAP Firestore usa transaccion e idempotencia entre instancias (DB simulada)',async()=>{
 const db=fakeDb(),a=new FirestoreSap(db),b=new FirestoreSap(db);
 assert.equal((await a.create('sol-001','snapshot')).id,(await b.create('sol-001','snapshot')).id);
 await assert.rejects(()=>b.create('sol-001','snapshot-modificado'));
});
test('aprobaciones Firestore se comparten entre instancias (DB simulada)',async()=>{
 const db=fakeDb(),a=new FirestoreApprovalStore(db),b=new FirestoreApprovalStore(db);
 const value={snapshot:'snapshot',approval:{solicitudId:'sol-003',aprobadorId:'lider-1',montoCentavos:119000000,requestHash:'hash'}};
 await a.set('sol-003',value);assert.deepEqual(await b.get('sol-003'),value);assert.equal(await b.get('sol-004'),undefined);
});
