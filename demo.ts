import assert from 'node:assert/strict';
import { createRuntime } from './src/bootstrap.js';
import { readConfig } from './src/config/env.js';
import { readFile } from 'node:fs/promises';
const runtime=createRuntime({withoutLlm:true,config:{...readConfig(),stateStore:'memory'}});
const expected=JSON.parse(await readFile('fixtures/reto-03/expected.educativo.json','utf8'));
let failures=0,created=0;
for(const solicitudId of await runtime.repository.list()){
 try{const r=await runtime.tools.execute('crearOrdenCompraSAP',{solicitudId}) as import('./src/domain/models.js').Result;assert.equal(r.estado,expected[solicitudId]);if(r.estado==='CREADA')created++;console.log(JSON.stringify({solicitudId,estado:r.estado,oc:r.oc??null,motivos:r.controles.filter(c=>c.resultado!=='CUMPLE')},null,2));}
 catch(e){failures++;console.error(solicitudId,e instanceof Error?e.message:e);}
}
console.log(`Demo educativo: ${failures} fallos; ${created} OC en memoria. Sin LLM.`);
process.exitCode=failures?1:0;
