// COMPLETAR(PRD): Mapear claves reales, tipos de maestros, documentos opcionales, formatos de fecha/dinero y evidencia disponible. Si la estructura externa cambia, no contaminar el dominio.
// Ver ficha de este archivo en ARQUITECTURA.md.
import { z } from 'zod';
const cents=z.number().int().nonnegative().max(100_000_000_000);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+'T00:00:00Z');return !isNaN(d.valueOf())&&d.toISOString().slice(0,10)===v;},'Fecha calendario invalida');
import { idSchema } from '../../contracts/commands.js';
export { idSchema };
export const requestSchema=z.object({id:idSchema,nit:z.string().min(1),centroCosto:z.string(),baseCentavos:cents,ivaCentavos:cents,totalCentavos:cents,indicadorIva:z.string(),condicionPago:z.string(),fechaSolicitud:date});
export const approvalSchema=z.object({solicitudId:idSchema,aprobadorId:z.string(),montoCentavos:cents,requestHash:z.string(),justificacion:z.string().optional(),fecha:z.string().optional()});
export const mastersSchema=z.object({proveedores:z.array(z.object({nit:z.string(),activo:z.boolean(),condicionPago:z.string()})),centros:z.array(z.object({id:z.string(),liderId:z.string(),topeCentavos:cents})),impuestos:z.array(z.object({codigo:z.string(),tasaPuntosBase:z.number().int().min(0).max(10000)})),pagos:z.array(z.object({codigo:z.string(),dias:z.number().int().nonnegative()}))});
