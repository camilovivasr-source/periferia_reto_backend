import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const colas = new Map<string, Promise<unknown>>();
function enCola(clave: string, tarea: () => Promise<void>) {
  const previa = colas.get(clave) ?? Promise.resolve();
  const sig = previa.then(tarea, tarea);
  colas.set(clave, sig.catch(() => undefined));
  return sig;
}

const csv = (v: unknown) => {
  const t = String(v ?? '');
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export type FilaControl = {
  solicitud_id: string;
  resultado: 'CREADA' | 'CREADA_IDEMPOTENTE' | 'BLOQUEADA' | 'PENDIENTE_CONFIRMACION' | 'ERROR';
  numero_oc: string | null;
  retroactiva: boolean;
  bloqueos: string[];
  confirmaciones: string[];
};

/** out/control.csv: una fila por intento de creacion (exitoso, bloqueado o pendiente). */
export function registrarControl(outDir: string, fila: FilaControl) {
  const archivo = path.join(outDir, 'control.csv');
  return enCola(archivo, async () => {
    await mkdir(outDir, { recursive: true });
    const existe = await stat(archivo).then(() => true, () => false);
    if (!existe) await writeFile(archivo, 'solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n', 'utf8');
    const linea = [fila.solicitud_id, fila.resultado, fila.numero_oc ?? '', fila.retroactiva, fila.bloqueos.join('|'), fila.confirmaciones.join('|'), new Date().toISOString()].map(csv).join(',');
    await appendFile(archivo, linea + '\n', 'utf8');
  });
}

/** out/log.jsonl: toda llamada a herramienta (CA4). */
export function registrarLlamada(outDir: string, entrada: Record<string, unknown>) {
  const archivo = path.join(outDir, 'log.jsonl');
  return enCola(archivo, async () => {
    await mkdir(outDir, { recursive: true });
    await appendFile(archivo, JSON.stringify({ ts: new Date().toISOString(), ...entrada }) + '\n', 'utf8');
  });
}

export async function escribirArchivo(ruta: string, contenido: string | Buffer) {
  await mkdir(path.dirname(ruta), { recursive: true });
  await writeFile(ruta, contenido);
}
