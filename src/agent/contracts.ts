// COMPLETAR(PRD): Ajustar a las capacidades del proveedor; conservar independencia del formato de reglas de compra.
// Ver ficha de este archivo en ARQUITECTURA.md.
export type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
export type ChatMessage={role:'system'|'user'|'assistant'|'tool';content:string|null;tool_calls?:ToolCall[];tool_call_id?:string;name?:string;providerParts?:unknown[]};
export type ToolDefinition={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
export interface LlmProvider{complete(messages:ChatMessage[],tools:ToolDefinition[]):Promise<ChatMessage>;}
export interface ToolRegistry{definitions:ToolDefinition[];execute(name:string,args:unknown):Promise<unknown>;}
export type Trace={name:string;args:unknown;result:unknown};

export type AgentEvent={type:'tool_start'|'tool_end';id:string;name:string;args?:unknown;result?:unknown;timestamp:string;durationMs?:number};
