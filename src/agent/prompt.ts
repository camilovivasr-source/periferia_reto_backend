import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Carga el system prompt (comportamiento) y el conocimiento del proceso, que viven en archivos aparte. */
export async function cargarSistema(directory: string): Promise<string> {
  const [prompt, conocimiento] = await Promise.all([
    readFile(path.join(directory, 'agent', 'prompt.md'), 'utf8'),
    readFile(path.join(directory, 'src', 'knowledge', 'ordenes-compra.md'), 'utf8'),
  ]);
  return `${prompt}\n\n---\n\n${conocimiento}`;
}
