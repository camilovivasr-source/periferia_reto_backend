import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ejecutarHerramienta } from '../src/tools/registry.js';
import type { ConfirmacionPuerto, ToolContext } from '../src/tools/types.js';

/** Cada archivo de prueba escribe en su propio out/ temporal. */
export async function usarOutTemporal() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'oc-out-'));
  process.env.OUT_DIR = dir;
  return dir;
}

/** Puerto de confirmacion controlable: representa a la persona que escribe "confirmo". */
export function humanoSimulado() {
  const pendientes = new Map<string, string>();
  const concedidas = new Map<string, string>();
  const puerto: ConfirmacionPuerto = {
    registrar: (caso, huella) => void pendientes.set(caso, huella),
    concedida: (caso, huella) => concedidas.get(caso) === huella,
    consumir: (caso) => void (pendientes.delete(caso), concedidas.delete(caso)),
  };
  return {
    puerto,
    pendientes,
    confirmar(caso: string) {
      const h = pendientes.get(caso);
      if (h) concedidas.set(caso, h);
    },
  };
}

export function ejecutor(confirmacion?: ConfirmacionPuerto) {
  const ctx: ToolContext = { directory: process.cwd(), sessionId: 'test', actor: 'tester', confirmacion };
  return (name: string, args: Record<string, unknown>) => ejecutarHerramienta(name, args, ctx);
}
