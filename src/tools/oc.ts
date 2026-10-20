// COMPLETAR(PRD): Separar proveedor/topes/impuestos si el PRD pide herramientas específicas; sincronizar JSON Schema del modelo y Zod. No exponer aprobación como herramienta LLM.
// Ver ficha de este archivo en ARQUITECTURA.md.
import { z } from 'zod';
import { requestCommand } from '../contracts/commands.js';
import type { PurchaseService } from '../application/purchase-service.js';
import type { RequestRepository } from '../domain/ports.js';
import type { ToolRegistry,ToolDefinition } from '../agent/contracts.js';
/** Solo contratos y despacho. No leer archivos, aprobar ni implementar reglas aqui. */
export function createOcTools(service:PurchaseService,repository:RequestRepository):ToolRegistry{
 const definitions:ToolDefinition[]=[
  {type:'function',function:{name:'listarSolicitudes',description:'Lista identificadores disponibles',parameters:{type:'object',properties:{},additionalProperties:false}}},
  ...['verificarProveedor','consultarImpuestosYPagos','validarPresupuestoYTope','validarSolicitud','crearOrdenCompraSAP'].map(name=>({type:'function' as const,function:{name,description:name==='validarSolicitud'?'Evalua controles y retorna evidencia':'Revalida todos los controles; crea solo si cumple',parameters:{type:'object',properties:{solicitudId:{type:'string',pattern:'^sol-\\d{3}$'}},required:['solicitudId'],additionalProperties:false}}}))
 ];
 return {definitions,async execute(name,args){
  if(name==='listarSolicitudes'){z.object({}).strict().parse(args);return {solicitudes:await repository.list()};}
  const groups:Record<string,string[]>={verificarProveedor:['PROVEEDOR'],consultarImpuestosYPagos:['IVA','TOTAL','PAGO','COTIZACION'],validarPresupuestoYTope:['CENTRO','TOPE','APROBACION','RETROACTIVA']};
  if(groups[name]){const result=await service.verificar(requestCommand.parse(args));return {...result,controles:result.controles.filter(c=>groups[name].includes(c.codigo))};}
  if(name==='validarSolicitud')return service.verificar(requestCommand.parse(args));
  if(name==='crearOrdenCompraSAP')return service.crear(requestCommand.parse(args));
  throw Error('Herramienta no permitida');
 }};
}
