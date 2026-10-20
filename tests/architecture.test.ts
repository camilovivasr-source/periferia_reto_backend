import { MemorySap } from '../src/infrastructure/memory/sap.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir,readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRuntime } from '../src/bootstrap.js';
import { PurchaseService } from '../src/application/purchase-service.js';
import { MemoryApprovalStore } from '../src/infrastructure/memory/approval-store.js';

test('dominio y aplicacion no importan infraestructura ni transporte',async()=>{
 async function walk(dir:string):Promise<string[]>{const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?walk(path.join(dir,e.name)):Promise.resolve([path.join(dir,e.name)])))).flat();}
 for(const file of [...await walk('src/domain'),...await walk('src/application')]){
  const source=await readFile(file,'utf8');
  assert.doesNotMatch(source,/from\s+['"](?:node:(?:fs|http|https)|[^'"]*(?:infrastructure|bootstrap|\/config\/|\/http\/|\/tools\/))/,'Dependencia de capa no permitida en '+file);
 }
});
test('servicio acepta repositorio y SAP inyectados y no crea si hay bloqueo',async()=>{
 const b=await createRuntime({withoutLlm:true}).repository.load('sol-002');let sapCalls=0;
 const service=new PurchaseService({list:async()=>[b.solicitud.id],load:async()=>b},{get:async()=>undefined,create:async()=>{sapCalls++;throw Error('No deberia llamarse');}},new MemoryApprovalStore(),{append:async()=>{},list:async()=>[]});
 assert.equal((await service.crear({solicitudId:b.solicitud.id})).estado,'RECHAZADA');assert.equal(sapCalls,0);
});
test('cada runtime conserva aprobaciones y ordenes independientes',async()=>{
 const a=createRuntime({withoutLlm:true}),b=createRuntime({withoutLlm:true});
 const r=await a.service.verificar({solicitudId:'sol-003'});
 await a.service.confirmar({solicitudId:'sol-003',snapshot:r.snapshot,justificacion:'Revision de prueba autorizada'},'lider-1');
 assert.equal((await a.service.crear({solicitudId:'sol-003'})).estado,'CREADA');
 assert.equal((await b.service.crear({solicitudId:'sol-003'})).estado,'REQUIERE_APROBACION');
 assert.equal((b.sap as MemorySap).count(),0);
});
test('catalogo LLM no ofrece aprobacion humana y rechaza herramientas ajenas',async()=>{
 const runtime=createRuntime({withoutLlm:true});
 assert.ok(runtime.tools.definitions.every(t=>!/confirmar|aprobar/i.test(t.function.name)));
 await assert.rejects(()=>runtime.tools.execute('aprobarCompra',{solicitudId:'sol-003'}));
});

test('modo real sin credenciales falla y no simula respuestas',()=>{
 const r=createRuntime({withoutLlm:true});
 assert.throws(()=>createRuntime({config:{...r.config,agentMode:'llm',geminiApiKey:undefined}}),/Modo LLM/);
 assert.equal(createRuntime({config:{...r.config,agentMode:'practice',geminiApiKey:undefined}}).mode,'PRACTICA SIN LLM');
});
