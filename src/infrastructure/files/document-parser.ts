// COMPLETAR(PRD): Adaptar cotizaciones y facturas reales. Si el LLM extrae información, validar su salida y su trazabilidad. No confundir extracción con autorización.
// Ver ficha de este archivo en ARQUITECTURA.md.
import type { InvoiceData } from '../../domain/models.js';
/** Formato educativo clave: valor. Cambiar aqui al recibir cotizacion oficial. */
export function parseQuotation(text:string):Record<string,string>{
 const entries=text.trim().split(/\r?\n/).map(line=>{const i=line.indexOf(':');if(i<1)throw Error('Formato de cotizacion no reconocido');return [line.slice(0,i).trim(),line.slice(i+1).trim()];});
 if(new Set(entries.map(([key])=>key)).size!==entries.length)throw Error('Campos repetidos en cotizacion');
 return Object.fromEntries(entries);
}
export function parseInvoice(text:string):InvoiceData{
 const fecha=/^fechaFactura:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(text)?.[1];
 const date=new Date((fecha??'')+'T00:00:00Z');
 const valida=!!fecha&&!isNaN(date.valueOf())&&date.toISOString().slice(0,10)===fecha;
 return {fecha,valida};
}
