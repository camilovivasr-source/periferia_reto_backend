import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const port='3017', child=spawn(process.execPath,['dist/src/server.js'],{env:{...process.env,PORT:port,AGENT_MODE:'practice',STATE_STORE:'memory',GEMINI_API_KEY:''},stdio:['ignore','pipe','pipe']});
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Servidor no inicio')),10000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Servidor termino '+code));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
 const base='http://127.0.0.1:'+port;
 async function post(route,data){const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
 assert.equal((await (await fetch(base+'/health')).json()).ok,true);
 const a=await post('/api/chat',{message:'validar sol-003'});assert.equal(a.data.result.estado,'REQUIERE_APROBACION');
 const approved=await post('/api/confirmar',{solicitudId:'sol-003',snapshot:a.data.result.snapshot,justificacion:'Revision de prueba autorizada'});assert.equal(approved.data.estado,'LISTA_PARA_CREAR');
 const created=await post('/api/chat',{message:'crear sol-003'});assert.equal(created.data.result.estado,'CREADA');
 assert.equal((await post('/api/chat',{message:'crear sol-002'})).data.result.estado,'RECHAZADA');
 assert.equal((await post('/api/chat',{message:4})).status,400);
 console.log('HTTP OK: salud, herramientas, confirmacion, creacion, bloqueo y entrada invalida');
}finally{child.kill();}
