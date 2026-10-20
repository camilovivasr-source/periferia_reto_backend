import type { IncomingMessage } from 'node:http';

const MAX_BYTES = 16_384;

export class CuerpoGrande extends Error {}

export async function leerJson(req: IncomingMessage): Promise<unknown> {
  let bytes = 0;
  const partes: Buffer[] = [];
  for await (const parte of req) {
    bytes += (parte as Buffer).length;
    if (bytes > MAX_BYTES) throw new CuerpoGrande('Entrada demasiado grande');
    partes.push(parte as Buffer);
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}
