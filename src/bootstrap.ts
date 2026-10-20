// COMPLETAR(PRD): Seleccionar adaptadores y proveedor permitidos por el reto. Si añades persistencia o identidad real, conectar aquí.
// Ver ficha de este archivo en ARQUITECTURA.md.
import { readFile } from 'node:fs/promises';
import { readConfig,type Config } from './config/env.js';
import { FixtureRepository } from './infrastructure/files/fixture-repository.js';
import { MemoryState } from './infrastructure/memory/state.js';
import { MemorySap } from './infrastructure/memory/sap.js';
import { MemoryApprovalStore,MemoryAuditStore } from './infrastructure/memory/approval-store.js';
import { GeminiProvider } from './infrastructure/llm/gemini.js';
import { Firestore } from '@google-cloud/firestore';
import { FirestoreSap,FirestoreApprovalStore,FirestoreAuditStore } from './infrastructure/firestore/state.js';
import { PurchaseService } from './application/purchase-service.js';
import { createOcTools } from './tools/oc.js';
import { createChatAgent } from './agent.js';
import type { LlmProvider } from './agent/contracts.js';
/** Punto unico de ensamblaje. Cada llamada crea estado independiente para tests/demo. */
export function createRuntime(options:{config?:Config;provider?:LlmProvider;withoutLlm?:boolean}={}){
 const config=options.config??readConfig(),repository=new FixtureRepository(config.fixturesDir);
 const db=config.stateStore==='firestore'?new Firestore({databaseId:config.firestoreDatabase}):undefined;
 const memory=new MemoryState(),sap=db?new FirestoreSap(db):new MemorySap(memory),approvals=db?new FirestoreApprovalStore(db):new MemoryApprovalStore(memory),audit=db?new FirestoreAuditStore(db):new MemoryAuditStore(memory);
 const service=new PurchaseService(repository,sap,approvals,audit,config.reviewerPolicies),tools=createOcTools(service,repository);
 let provider=options.withoutLlm?undefined:options.provider;
 if(!options.withoutLlm&&!provider&&config.agentMode==='llm'){
  if(!config.geminiApiKey)throw Error('Modo LLM: configura GEMINI_API_KEY (GEMINI_MODEL=gemini-2.5-flash) en .env. Para estudiar sin modelo usa npm run dev:practice; no sustituye al agente final.');
  provider=new GeminiProvider(config);
 }
 const chat=createChatAgent({tools,provider,prompt:()=>readFile('agent/prompt.md','utf8'),maxSteps:config.maxSteps});
 return {config,repository,sap,approvals,audit,service,tools,chat,mode:provider?'LLM':'PRACTICA SIN LLM'};
}
export type Runtime=ReturnType<typeof createRuntime>;
