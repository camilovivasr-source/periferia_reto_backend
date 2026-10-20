import { z } from 'zod';
import type { LlmProvider,ChatMessage,ToolDefinition } from '../../agent/contracts.js';
import type { Config } from '../../config/env.js';
const partSchema=z.object({text:z.string().optional(),thought:z.boolean().optional(),thoughtSignature:z.string().optional(),functionCall:z.object({id:z.string().optional(),name:z.string(),args:z.record(z.unknown()).optional()}).passthrough().optional()}).passthrough();
const responseSchema=z.object({candidates:z.array(z.object({content:z.object({parts:z.array(partSchema)})})).min(1)});
type Content={role:'user'|'model';parts:unknown[]};
/** Gemini native generateContent; preserve thought signatures and function IDs. */
export class GeminiProvider implements LlmProvider{
 constructor(private readonly config:Config,private readonly request:typeof fetch=globalThis.fetch){}
 async complete(messages:ChatMessage[],tools:ToolDefinition[]):Promise<ChatMessage>{
  const contents:Content[]=[];
  const callIds=new Map<string,{name:string;nativeId?:string}>();
  for(const msg of messages){
   if(msg.role==='system')continue;
   if(msg.role==='assistant'){
    const raw=msg.providerParts;
    for(const call of msg.tool_calls??[]){const native=(raw??[]).map(p=>partSchema.parse(p)).find(p=>p.functionCall?.id===call.id)?.functionCall?.id;callIds.set(call.id,{name:call.function.name,nativeId:native});}
    contents.push({role:'model',parts:raw??[{text:msg.content??''}]});
   }else if(msg.role==='tool'){
    const call=callIds.get(msg.tool_call_id??'');
    const fn={name:msg.name??call?.name,response:{result:JSON.parse(msg.content??'{}')},...(call?.nativeId?{id:call.nativeId}:{})};
    if(!fn.name)throw Error('Resultado de herramienta sin llamada asociada');
    const last=contents.at(-1);if(last?.role==='user')last.parts.push({functionResponse:fn});else contents.push({role:'user',parts:[{functionResponse:fn}]});
   }else contents.push({role:'user',parts:[{text:msg.content??''}]});
  }
  const body={systemInstruction:{parts:[{text:messages.filter(m=>m.role==='system').map(m=>m.content).join('\n')}]},contents,tools:[{functionDeclarations:tools.map(t=>({name:t.function.name,description:t.function.description,parametersJsonSchema:t.function.parameters}))}],generationConfig:{temperature:0.1}};
  const response=await this.request(`https://generativelanguage.googleapis.com/v1beta/models/${this.config.geminiModel}:generateContent`,{method:'POST',headers:{'x-goog-api-key':this.config.geminiApiKey??'','Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(this.config.timeoutMs)});
  if(!response.ok)throw Error(`Gemini HTTP ${response.status}: revisar acceso al modelo, cuota y credencial en servidor`);
  const parsed=responseSchema.safeParse(await response.json());
  if(!parsed.success)throw Error('Gemini no devolvio candidato util; revisar bloqueo o formato del proveedor');
  const parts=parsed.data.candidates[0].content.parts;
  const calls=parts.flatMap((p,i)=>p.functionCall?[{id:p.functionCall.id??`gemini-${messages.length}-${i}`,type:'function' as const,function:{name:p.functionCall.name,arguments:JSON.stringify(p.functionCall.args??{})}}]:[]);
  return {role:'assistant',content:parts.filter(p=>!p.thought).map(p=>p.text??'').join(''),...(calls.length?{tool_calls:calls}:{}),providerParts:parts};
 }
}
