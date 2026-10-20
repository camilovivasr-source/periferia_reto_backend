import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  FIXTURES_DIR: z.string().default('fixtures/reto-03'),
  OUT_DIR: z.string().default('out'),
  // auto: Vertex si hay GEMINI_VERTEX=1, Gemini (AI Studio) si hay clave, si no modo practica.
  AGENT_MODE: z.enum(['auto', 'vertex', 'gemini', 'llm', 'practice']).default('auto'),
  GEMINI_VERTEX: z.string().optional(),
  VERTEX_LOCATION: z.string().regex(/^[a-z0-9-]+$/).default('us-central1'),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().regex(/^[a-zA-Z0-9_.-]+$/).default('gemini-2.5-flash'),
  MAX_ITERACIONES: z.coerce.number().int().min(1).max(60).default(25),
  MAX_TOKENS_SESION: z.coerce.number().int().min(1000).default(300_000),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45_000),
  ACTOR: z.string().min(1).default('analista-administrativa'),
  // Supuesto de negocio para el indicador de ahorro: minutos de digitacion manual por OC.
  MINUTOS_MANUALES_POR_OC: z.coerce.number().min(0).max(240).default(12),
});

export type Config = ReturnType<typeof readConfig>;

/** Lee variables de entorno. La clave del modelo solo vive aqui, nunca en el front ni en logs. */
export function readConfig(env: NodeJS.ProcessEnv = process.env, directory: string = process.cwd()) {
  const e = envSchema.parse(env);
  const apiKey = e.GEMINI_API_KEY?.trim() || undefined;
  const vertexPedido = ['1', 'true', 'yes'].includes((e.GEMINI_VERTEX ?? '').toLowerCase());
  const pedido = e.AGENT_MODE === 'llm' ? 'gemini' : e.AGENT_MODE;
  const mode: 'vertex' | 'gemini' | 'practice' =
    pedido === 'auto' ? (vertexPedido ? 'vertex' : apiKey ? 'gemini' : 'practice') : pedido;
  if (mode === 'gemini' && !apiKey) throw new Error('El modo gemini requiere GEMINI_API_KEY en el entorno del servidor');
  return {
    directory,
    port: e.PORT,
    fixturesDir: path.resolve(directory, e.FIXTURES_DIR),
    outDir: path.resolve(directory, e.OUT_DIR),
    mode,
    geminiApiKey: apiKey,
    vertexLocation: e.VERTEX_LOCATION,
    projectId: e.GOOGLE_CLOUD_PROJECT,
    geminiModel: e.GEMINI_MODEL,
    maxIteraciones: e.MAX_ITERACIONES,
    maxTokensSesion: e.MAX_TOKENS_SESION,
    llmTimeoutMs: e.LLM_TIMEOUT_MS,
    actor: e.ACTOR,
    minutosManualesPorOc: e.MINUTOS_MANUALES_POR_OC,
  };
}
