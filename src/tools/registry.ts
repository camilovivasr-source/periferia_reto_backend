import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as oc from './oc.js';
import type { ToolContext, ToolDef } from './types.js';
import { entornoDe } from '../data.js';
import { registrarLlamada } from '../out.js';
import { resumir } from './resumen.js';

export type HerramientaDef = { name: string; description: string; parameters: Record<string, unknown> };

type Registrada = { name: string; description: string; schema: z.ZodObject<z.ZodRawShape>; execute: (args: never, ctx: ToolContext) => Promise<string> };

/** El nombre que ve el modelo es <archivo>_<export>: oc_leer_paquete, oc_validar, ... */
const ORDEN = ['leer_paquete', 'validar', 'construir_payload', 'generar_evidencia', 'crear', 'listar_casos', 'consultar_maestro', 'resumen_control'];
const orden = (n: string) => (ORDEN.includes(n) ? ORDEN.indexOf(n) : ORDEN.length);

const registro: Registrada[] = Object.entries(oc as Record<string, ToolDef<z.ZodRawShape>>)
  .sort(([a], [b]) => orden(a) - orden(b))
  .map(([nombre, def]) => ({
  name: `oc_${nombre}`,
  description: def.description,
  schema: z.object(def.args).strict(),
  execute: def.execute as unknown as Registrada['execute'],
}));

export const nombresHerramientas = () => registro.map((t) => t.name);

export function definiciones(): HerramientaDef[] {
  return registro.map((t) => {
    const { $schema: _omit, ...parameters } = zodToJsonSchema(t.schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<string, unknown>;
    return { name: t.name, description: t.description, parameters };
  });
}

export type ResultadoHerramienta = {
  name: string;
  args: unknown;
  ok: boolean;
  texto: string;
  data: unknown;
  error?: string;
  resumen: string;
  ms: number;
};

/**
 * Unico punto por el que pasan el agente y el demo: valida argumentos con zod antes de ejecutar,
 * devuelve el error al modelo si no cumplen y deja rastro en out/log.jsonl. Nunca lanza.
 */
export async function ejecutarHerramienta(name: string, crudo: unknown, ctx: ToolContext): Promise<ResultadoHerramienta> {
  const inicio = Date.now();
  const terminar = async (texto: string, args: unknown): Promise<ResultadoHerramienta> => {
    let parsed: { ok?: boolean; data?: unknown; error?: string } = {};
    try {
      parsed = JSON.parse(texto);
    } catch {
      parsed = { ok: false, error: 'La herramienta devolvio un resultado que no es JSON' };
    }
    const r: ResultadoHerramienta = { name, args, ok: parsed.ok === true, texto, data: parsed.data, error: parsed.error, resumen: '', ms: Date.now() - inicio };
    r.resumen = resumir(name, parsed);
    await registrarLlamada(entornoDe(ctx.directory).outDir, { sessionId: ctx.sessionId, tool: name, args, ok: r.ok, resumen: r.resumen, ms: r.ms, resultado: texto.length > 6000 ? texto.slice(0, 6000) + '…' : texto }).catch(() => undefined);
    return r;
  };

  const tool = registro.find((t) => t.name === name);
  if (!tool) return terminar(JSON.stringify({ ok: false, error: `Herramienta desconocida: ${name}. Disponibles: ${nombresHerramientas().join(', ')}` }), crudo);
  const args = tool.schema.safeParse(crudo ?? {});
  if (!args.success) {
    const detalle = args.error.issues.map((i) => `${i.path.join('.') || 'argumentos'}: ${i.message}`).join('; ');
    return terminar(JSON.stringify({ ok: false, error: `Argumentos invalidos para ${name}: ${detalle}` }), crudo);
  }
  try {
    return await terminar(await tool.execute(args.data as never, ctx), args.data);
  } catch (e) {
    return terminar(JSON.stringify({ ok: false, error: `Fallo tecnico en ${name}: ${e instanceof Error ? e.message : 'desconocido'}` }), args.data);
  }
}
