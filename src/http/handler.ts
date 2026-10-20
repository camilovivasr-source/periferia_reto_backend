import type { IncomingMessage,ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { Runtime } from '../bootstrap.js';
import { chatCommand,confirmationCommand,idSchema } from '../contracts/commands.js';
import { readJsonBody,BodyTooLargeError } from './body.js';
import { operator } from './operator.js';
export function createHandler(runtime:Runtime){return async(req:IncomingMessage,res:ServerResponse)=>{
 const requestId=randomUUID();res.setHeader('X-Request-Id',requestId);
 const send=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 try{
  if(req.method==='GET'&&req.url==='/health'){send(200,{ok:true,mode:runtime.mode,model:runtime.config.geminiModel,stateStore:runtime.config.stateStore,humanAuth:runtime.config.humanAuthMode});return;}
  if(req.method==='GET'&&req.url==='/api/solicitudes'){send(200,{ids:await runtime.repository.list()});return;}
  const detail=/^\/api\/solicitudes\/(sol-\d{3})$/.exec(req.url??'');
  if(req.method==='GET'&&detail){const solicitudId=idSchema.parse(detail[1]);send(200,await runtime.service.inspeccionar({solicitudId},operator(req,runtime.config,null)));return;}
  if(req.method!=='POST'||!['/api/chat','/api/confirmar','/api/rechazar'].includes(req.url??'')){send(404,{error:'Ruta no encontrada',requestId});return;}
  const input=await readJsonBody(req);
  if(req.url==='/api/chat'){
   const {message}=chatCommand.parse(input);
   if(req.headers.accept?.includes('text/event-stream')){
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
    const event=(data:unknown)=>{if(!res.destroyed)res.write('data: '+JSON.stringify(data)+'\n\n');};
    const ping=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},15000);
    try{event({type:'start',requestId});const result=await runtime.chat(message,event);event({type:'complete',...result,requestId});}catch{event({type:'error',error:'Fallo del agente o proveedor. Revisar configuracion y registros del servidor.',requestId});}finally{clearInterval(ping);res.end();}return;
   }
   send(200,await runtime.chat(message));return;
  }
  const actor=operator(req,runtime.config,input);if(!actor){send(403,{error:'Sesion de revisor requerida',requestId});return;}
  const command=confirmationCommand.parse(input);
  send(200,req.url==='/api/confirmar'?await runtime.service.confirmar(command,actor):await runtime.service.rechazar(command,actor));
 }catch(e){
  if(e instanceof ZodError){send(400,{code:'DATA_VALIDATION_ERROR',error:'Datos no validos',details:e.issues.map(i=>({campo:i.path.join('.'),motivo:i.message})),requestId});return;}
  const missing=(e as NodeJS.ErrnoException).code==='ENOENT';send(e instanceof BodyTooLargeError?413:missing?422:e instanceof SyntaxError?400:409,{code:missing?'DATA_VALIDATION_ERROR':'OPERATION_BLOCKED',error:missing?'Falta un insumo requerido. Revisar carpeta de solicitud y maestros.':e instanceof Error?e.message:'Fallo tecnico',requestId});
 }
};}
