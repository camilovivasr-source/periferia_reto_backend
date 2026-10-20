import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearAgente } from './bootstrap.js';
import { readConfig } from './config.js';
import { crearManejador } from './http/rutas.js';

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (esPrincipal) {
  const config = readConfig();
  const agente = await crearAgente(config);
  const server = createServer(crearManejador(config, agente));
  server.requestTimeout = 120_000;
  server.listen(config.port, '0.0.0.0', () => {
    const { proveedor, modelo, modo } = agente.proveedor;
    console.log(`Agente de OC en http://localhost:${config.port} (modo ${modo}, ${proveedor}/${modelo})`);
  });
}
