// COMPLETAR(PRD): Ajustar timeout, puerto y apagado ordenado si el entorno de despliegue lo exige.
// Ver ficha de este archivo en ARQUITECTURA.md.
import { createServer } from 'node:http';
import { createRuntime } from './bootstrap.js';
import { createHandler } from './http/handler.js';
const runtime=createRuntime(),server=createServer(createHandler(runtime));
server.requestTimeout=120000;
server.listen(runtime.config.port,'0.0.0.0',()=>console.log(`Chat de estudio: http://localhost:${runtime.config.port}`));
