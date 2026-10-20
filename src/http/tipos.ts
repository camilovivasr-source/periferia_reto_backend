import type { IncomingMessage, ServerResponse } from 'node:http';

/** Contexto de una peticion: lo que cada ruta necesita para responder. */
export type Peticion = { req: IncomingMessage; res: ServerResponse; url: URL; requestId: string; coincidencia: RegExpExecArray };
export type Ruta = { metodo: 'GET' | 'POST'; patron: RegExp; manejar(p: Peticion): Promise<void> };

export function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function adjunto(res: ServerResponse, tipo: string, nombre: string, cuerpo: string | Buffer): void {
  res.writeHead(200, { 'Content-Type': tipo, 'Content-Disposition': `attachment; filename="${nombre}"`, 'Cache-Control': 'no-store' });
  res.end(cuerpo);
}
