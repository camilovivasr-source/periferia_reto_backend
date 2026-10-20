// COMPLETAR(PRD): Agregar historial por sesión, streaming o recuperación de contexto solo si se exige. Asegurar que el agente pide datos en vez de inventarlos.
// Ver ficha de este archivo en ARQUITECTURA.md.
import type { ChatMessage,LlmProvider,ToolRegistry,Trace,AgentEvent } from './agent/contracts.js';
import { practiceAction } from './agent/practice.js';
export function createChatAgent(deps:{tools:ToolRegistry;provider?:LlmProvider;prompt:()=>Promise<string>;maxSteps:number}){
 return async function chat(message:string,onEvent?:(event:AgentEvent)=>void){
  const trace:Trace[]=[];
  const run=async(name:string,args:unknown)=>{const start=Date.now(),id=String(trace.length)+'-'+start;onEvent?.({type:'tool_start',id,name,args,timestamp:new Date().toISOString()});let result:unknown;try{result=await deps.tools.execute(name,args);}catch(e){const err=e as {code?:string;name?:string;issues?:{path:(string|number)[];message:string}[]};result=err.code==='ENOENT'?{code:'DATA_VALIDATION_ERROR',error:'Falta un insumo requerido; revisar archivos de la solicitud'}:err.name==='ZodError'?{code:'DATA_VALIDATION_ERROR',error:'Datos requeridos ausentes o invalidos',details:err.issues?.map(i=>({campo:i.path.join('.'),motivo:i.message}))}:{code:'TOOL_ERROR',error:e instanceof Error?e.message:'Fallo tecnico'};}trace.push({name,args,result});onEvent?.({type:'tool_end',id,name,result,timestamp:new Date().toISOString(),durationMs:Date.now()-start});return result;};
  if(!deps.provider){const action=practiceAction(message),result=await run(action.name,action.args);return {mode:'PRACTICA SIN LLM',reply:action.name==='listarSolicitudes'?'Escribe validar sol-001 o crear sol-001. Modo de comandos sin LLM.':JSON.stringify(result,null,2),trace,result};}
  const messages:ChatMessage[]=[{role:'system',content:await deps.prompt()},{role:'user',content:message}];
  for(let i=0;i<deps.maxSteps;i++){
   const msg=await deps.provider.complete(messages,deps.tools.definitions);messages.push(msg);
   if(!msg.tool_calls?.length)return {mode:'LLM',reply:msg.content??'Sin texto',trace};
   for(const call of msg.tool_calls){let result:unknown;try{result=await run(call.function.name,JSON.parse(call.function.arguments));}catch{result={error:'Argumentos JSON invalidos'};trace.push({name:call.function.name,args:null,result});}messages.push({role:'tool',tool_call_id:call.id,name:call.function.name,content:JSON.stringify(result)});}
  }
  return {mode:'LLM',reply:'Limite de pasos alcanzado. Revisa herramientas antes de continuar.',trace};
 };
}
