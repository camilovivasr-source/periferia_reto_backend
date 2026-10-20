import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/bootstrap.js';
import { readConfig } from '../src/config/env.js';
import { GeminiProvider } from '../src/infrastructure/llm/gemini.js';
test('Gemini: herramientas nativas, resultados y firmas opacas conservadas',async()=>{
 let rounds=0;const config={...readConfig(),geminiApiKey:'ficticia',stateStore:'memory' as const};
 const request:typeof fetch=async(input,init)=>{
  rounds++;assert.match(String(input),/models\/gemini-2.5-flash:generateContent/);const body=JSON.parse(String(init?.body));
  assert.equal(body.tools[0].functionDeclarations.some((v:{name:string})=>v.name==='validarSolicitud'),true);
  if(rounds===1)return Response.json({candidates:[{content:{role:'model',parts:[{functionCall:{name:'validarSolicitud',args:{solicitudId:'sol-001'}},thoughtSignature:'opaque-signature'}]}}]});
  assert.equal(body.contents[1].parts[0].thoughtSignature,'opaque-signature');
  const result=body.contents.at(-1).parts[0].functionResponse;assert.equal(result.name,'validarSolicitud');assert.equal(result.response.result.estado,'LISTA_PARA_CREAR');
  return Response.json({candidates:[{content:{role:'model',parts:[{text:'Validada por herramienta.'}]}}]});
 };
 const result=await createRuntime({config,provider:new GeminiProvider(config,request)}).chat('Valida sol-001');
 assert.equal(result.mode,'LLM');assert.equal(rounds,2);assert.equal(result.trace[0].name,'validarSolicitud');
});
