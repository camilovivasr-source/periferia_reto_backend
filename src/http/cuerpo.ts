import type { IncomingMessage } from 'node:http';

const MAX_BYTES = 16_384;
export const MAX_BYTES_CARPETA = 600_000;

export class CuerpoGrande extends Error {}

export async function leerJson(req: IncomingMessage, maximo = MAX_BYTES): Promise<unknown> {
  let bytes = 0;
  const partes: Buffer[] = [];
  for await (const parte of req) {
    bytes += (parte as Buffer).length;
    if (bytes > maximo) throw new CuerpoGrande('Entrada demasiado grande');
    partes.push(parte as Buffer);
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}
