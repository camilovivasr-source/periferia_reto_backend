/**
 * Verificacion sin modelo: procesa los casos de fixtures/reto-03/solicitudes llamando directamente a las
 * herramientas (las mismas que usa el agente). Uso: npm run demo
 */
import { rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { entornoDe, listarCasos } from './src/domain/data.js';
import { ejecutarHerramienta, type ResultadoHerramienta } from './src/tools/registry.js';
import type { ConfirmacionPuerto, ToolContext } from './src/tools/types.js';
import type { Hallazgo } from './src/domain/types.js';

const directory = process.cwd();
const env = entornoDe(directory);

// Confirmacion humana simulada: solo se concede cuando el demo lo indica, igual que un "confirmo" del usuario.
const pendientes = new Map<string, string>();
const concedidas = new Map<string, string>();
const humano: ConfirmacionPuerto & { confirmar(caso: string): void } = {
  registrar: (caso, huella, _c: Hallazgo[]) => void pendientes.set(caso, huella),
  concedida: (caso, huella) => concedidas.get(caso) === huella,
  consumir: (caso) => void (pendientes.delete(caso), concedidas.delete(caso)),
  confirmar(caso) {
    const h = pendientes.get(caso);
    if (h) concedidas.set(caso, h);
  },
};
const ctx: ToolContext = { directory, sessionId: 'demo', actor: 'analista-demo', confirmacion: humano };

const run = (name: string, args: Record<string, unknown>): Promise<ResultadoHerramienta> => ejecutarHerramienta(name, args, ctx);
const linea = (s = '') => console.log(s);
let fallos = 0;

async function procesar(caso: string) {
  linea(`\n=== ${caso} ${'='.repeat(60 - caso.length)}`);
  const paquete = await run('oc_leer_paquete', { caso });
  if (!paquete.ok) {
    fallos++;
    return linea(`  ERROR de datos: ${paquete.error}`);
  }
  const v = await run('oc_validar', { caso });
  const d = v.data as { apta: boolean; bloqueos: Hallazgo[]; confirmaciones: Hallazgo[]; retroactiva: boolean; derivados: Record<string, unknown> };
  linea(`  apta: ${d.apta}   retroactiva: ${d.retroactiva}`);
  for (const b of d.bloqueos) linea(`  BLOQUEO       ${b.codigo}: ${b.detalle}`);
  for (const c of d.confirmaciones) linea(`  CONFIRMACION  ${c.codigo}: ${c.detalle}`);
  if (Object.keys(d.derivados).length) linea(`  derivados: ${JSON.stringify(d.derivados)}`);

  if (d.apta) {
    const p = await run('oc_construir_payload', { caso });
    const e = await run('oc_generar_evidencia', { caso });
    linea(`  payload: ${p.resumen}`);
    linea(`  evidencia: ${e.resumen}`);
  }

  let r = await run('oc_crear', { caso });
  if (!r.ok && (JSON.parse(r.texto) as { requiere_confirmacion?: boolean }).requiere_confirmacion) {
    linea(`  oc_crear sin confirmar -> PENDIENTE: ${r.error}`);
    humano.confirmar(caso);
    linea(`  (el usuario confirma explicitamente)`);
    r = await run('oc_crear', { caso, confirmado: true });
  }
  linea(r.ok ? `  RESULTADO: ${r.resumen}` : `  RESULTADO: NO SE CREA OC -> ${r.error}`);
  return r;
}

await rm(env.outDir, { recursive: true, force: true }); // out/ limpio: resultado reproducible
linea('Demo del agente de OC (sin modelo de lenguaje)');
for (const caso of await listarCasos(env)) await procesar(caso);

linea('\n=== Idempotencia: sol-001 por segunda vez ' + '='.repeat(20));
const otra = await run('oc_crear', { caso: 'sol-001' });
const dato = otra.data as { numero_oc?: string; idempotente?: boolean } | undefined;
linea(`  ${otra.resumen}`);
if (!otra.ok || dato?.idempotente !== true) fallos++;

linea('\n=== out/control.csv ' + '='.repeat(40));
linea((await readFile(path.join(env.outDir, 'control.csv'), 'utf8')).trimEnd());
linea(`\nDemo terminado: ${fallos} error(es) tecnico(s).`);
process.exitCode = fallos ? 1 : 0;
