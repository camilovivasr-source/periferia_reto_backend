// Un comando para probar todo en local: levanta el backend (8080) y, si esta al lado, el frontend (3000).
//   npm run dev:all        (sin GEMINI_API_KEY ni AGENT_MODE=vertex arranca en modo practica)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const frontend = path.resolve(process.env.FRONTEND_DIR ?? path.join(raiz, '..', 'periferia_reto_frontend'));
const hijos = [];
const lanzar = (nombre, cwd, args, env) => {
  const h = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  h.on('exit', (c) => { if (c) console.error(`[${nombre}] termino con codigo ${c}`); });
  hijos.push(h);
};

lanzar('backend', raiz, ['--import', 'tsx', 'src/server.ts'], { PORT: '8080' });
if (existsSync(path.join(frontend, 'src', 'server.mjs'))) {
  lanzar('frontend', frontend, ['src/server.mjs'], { PORT: '3000', BACKEND_URL: 'http://127.0.0.1:8080', BACKEND_AUTH: 'none' });
  console.log('Abre http://localhost:3000');
} else {
  console.log(`Frontend no encontrado en ${frontend}: solo el backend en http://localhost:8080 (FRONTEND_DIR=… para indicarlo).`);
}
const salir = () => { for (const h of hijos) h.kill(); process.exit(0); };
process.on('SIGINT', salir);
process.on('SIGTERM', salir);
