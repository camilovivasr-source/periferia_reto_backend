import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  FIXTURES_DIR: z.string().default('fixtures/reto-03'),
  OUT_DIR: z.string().default('out'),
  AGENT_MODE: z.enum(['auto', 'llm', 'practice']).default('auto'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().regex(/^[a-zA-Z0-9_.-]+$/).default('gemini-2.5-flash'),
  MAX_ITERACIONES: z.coerce.number().int().min(1).max(60).default(25),
  MAX_TOKENS_SESION: z.coerce.number().int().min(1000).default(300_000),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45_000),
  ACTOR: z.string().min(1).default('analista-administrativa'),
});

export type Config = ReturnType<typeof readConfig>;

/** Lee variables de entorno. La clave del modelo solo vive aqui, nunca en el front ni en logs. */
export function readConfig(env: NodeJS.ProcessEnv = process.env, directory: string = process.cwd()) {
  const e = envSchema.parse(env);
  const apiKey = e.GEMINI_API_KEY?.trim() || undefined;
  const mode: 'llm' | 'practice' = e.AGENT_MODE === 'auto' ? (apiKey ? 'llm' : 'practice') : e.AGENT_MODE;
  if (mode === 'llm' && !apiKey) throw new Error('AGENT_MODE=llm requiere GEMINI_API_KEY en el entorno del servidor');
  return {
    directory,
    port: e.PORT,
    fixturesDir: path.resolve(directory, e.FIXTURES_DIR),
    outDir: path.resolve(directory, e.OUT_DIR),
    mode,
    geminiApiKey: apiKey,
    geminiModel: e.GEMINI_MODEL,
    maxIteraciones: e.MAX_ITERACIONES,
    maxTokensSesion: e.MAX_TOKENS_SESION,
    llmTimeoutMs: e.LLM_TIMEOUT_MS,
    actor: e.ACTOR,
  };
}
