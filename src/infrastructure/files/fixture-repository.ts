// COMPLETAR(PRD): Agregar mapper explícito si los datos externos no coinciden con modelo interno; validar correo según controles requeridos. Definir archivos opcionales.
// Ver ficha de este archivo en ARQUITECTURA.md.
import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { requestSchema,approvalSchema,mastersSchema,idSchema } from './schemas.js';
import { parseQuotation,parseInvoice } from './document-parser.js';
import { hash } from '../../domain/fingerprint.js';
import type { Bundle } from '../../domain/models.js';
import type { RequestRepository } from '../../domain/ports.js';
const json=async(p:string)=>JSON.parse(await readFile(p,'utf8')) as unknown;
async function optional(p:string){try{return await readFile(p,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}}

export class FixtureRepository implements RequestRepository {
 constructor(private readonly root:string){}
async list(){return (await readdir(path.join(this.root,'solicitudes'))).filter(v=>idSchema.safeParse(v).success).sort();}
async load(id:string):Promise<Bundle>{
 idSchema.parse(id);
 const dir=path.join(this.root,'solicitudes',id),m=path.join(this.root,'maestros');
 const [raw,correo,cotizacion,aprobacionText,factura,proveedores,centros,impuestos,pagos]=await Promise.all([
 json(path.join(dir,'solicitud.json')),json(path.join(dir,'correo.json')),readFile(path.join(dir,'cotizacion.txt'),'utf8'),optional(path.join(dir,'aprobacion.json')),optional(path.join(dir,'factura.txt')),json(path.join(m,'proveedores.json')),json(path.join(m,'centros-costo.json')),json(path.join(m,'indicadores-iva.json')),json(path.join(m,'condiciones-pago.json'))]);
 const solicitud=requestSchema.parse(raw);if(solicitud.id!==id)throw Error('ID de carpeta y solicitud no coinciden');
 const masters=mastersSchema.parse({proveedores,centros,impuestos,pagos});
 const aprobacion=aprobacionText?approvalSchema.parse(JSON.parse(aprobacionText)):undefined;
 const snapshot=hash({solicitud,correo,cotizacion,aprobacion,factura,masters});
 const cotizacionDatos=parseQuotation(cotizacion);
 const facturaDatos=factura?parseInvoice(factura):undefined;
 return {solicitud,correo,cotizacion,cotizacionDatos,aprobacion,factura,facturaDatos,masters,snapshot};
}

}
