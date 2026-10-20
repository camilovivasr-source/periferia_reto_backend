import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizarTexto } from '../domain/util.js';

type Seccion = { fuente: string; titulo: string; texto: string; tokens: Set<string> };

const FUENTES = [
  ['PRD del reto (docs/PRD.md)', 'docs/PRD.md'],
  ['Conocimiento del proceso (src/knowledge/ordenes-compra.md)', 'src/knowledge/ordenes-compra.md'],
] as const;
const VACIAS = new Set('de la el los las un una y o a en que se por con para del al es lo como su sus si no mas cual cuales que qué'.split(' '));
const MAX_TEXTO = 1800;

const tokens = (t: string) => new Set(normalizarTexto(t).split(' ').filter((w) => w.length > 2 && !VACIAS.has(w)));

let cache: Promise<Seccion[]> | null = null;

/** Parte los documentos por encabezados Markdown; cada seccion conserva el titulo de su capitulo. */
async function secciones(directory: string): Promise<Seccion[]> {
  const todas: Seccion[] = [];
  for (const [fuente, ruta] of FUENTES) {
    const texto = await readFile(path.join(directory, ruta), 'utf8').catch(() => '');
    let capitulo = '';
    for (const bloque of texto.split(/\n(?=#{2,3} )/)) {
      const titulo = /^#{2,3} (.+)/.exec(bloque)?.[1]?.trim() ?? 'Introduccion';
      if (bloque.startsWith('## ')) capitulo = titulo;
      const completo = capitulo && capitulo !== titulo ? `${capitulo} › ${titulo}` : titulo;
      todas.push({ fuente, titulo: completo, texto: bloque.trim(), tokens: tokens(`${completo} ${completo} ${bloque}`) });
    }
  }
  return todas;
}

/**
 * Busqueda por palabras clave en el PRD y en el conocimiento del proceso (sin embeddings: son pocos documentos y
 * se necesita la cita textual). Devuelve las secciones mas relevantes para que el agente responda con fuente.
 */
export async function consultarConocimiento(directory: string, pregunta: string, maximo = 3) {
  cache ??= secciones(directory);
  const q = tokens(pregunta);
  const puntuadas = (await cache)
    .map((s) => ({ s, puntos: [...q].reduce((n, w) => n + (s.tokens.has(w) ? 1 : 0) + (normalizarTexto(s.titulo).includes(w) ? 2 : 0), 0) }))
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, maximo);
  return {
    pregunta,
    resultados: puntuadas.map(({ s, puntos }) => ({ fuente: s.fuente, seccion: s.titulo, relevancia: puntos, texto: s.texto.length > MAX_TEXTO ? `${s.texto.slice(0, MAX_TEXTO)}…` : s.texto })),
    nota: puntuadas.length ? undefined : 'No hay secciones que coincidan; reformula con terminos del proceso (OC, cotizacion, RC5, retroactiva…).',
  };
}
