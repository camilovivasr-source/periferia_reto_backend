// COMPLETAR(PRD): Adaptar tamaño si la entrada real incorpora documentos; definir límite y errores operativos.
// Ver ficha de este archivo en ARQUITECTURA.md.
import type { IncomingMessage } from 'node:http';
export class BodyTooLargeError extends Error{}
export async function readJsonBody(req:IncomingMessage){
 let size=0;const chunks:Buffer[]=[];
 for await(const chunk of req){size+=chunk.length;if(size>16384)throw new BodyTooLargeError('Entrada demasiado grande');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
