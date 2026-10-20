import { Agente } from './agent/loop.js';
import { PracticaAdapter } from './agent/practice.js';
import { cargarSistema } from './agent/prompt.js';
import type { Config } from './config.js';
import { GeminiAdapter, destinoAiStudio, destinoVertex } from './llm/gemini.js';
import type { LlmAdapter } from './llm/adapter.js';

/** Elige el proveedor del modelo segun la configuracion. Es el unico lugar que conoce las implementaciones concretas. */
export function crearLlm(config: Config): LlmAdapter {
  switch (config.mode) {
    case 'vertex':
      return new GeminiAdapter(config.geminiModel, destinoVertex({ project: config.projectId, location: config.vertexLocation }), config.llmTimeoutMs);
    case 'gemini':
      return new GeminiAdapter(config.geminiModel, destinoAiStudio(config.geminiApiKey!), config.llmTimeoutMs);
    case 'practice':
      return new PracticaAdapter();
  }
}

export async function crearAgente(config: Config): Promise<Agente> {
  return new Agente({
    llm: crearLlm(config),
    directory: config.directory,
    sistema: await cargarSistema(config.directory),
    maxIteraciones: config.maxIteraciones,
    maxTokensSesion: config.maxTokensSesion,
    actor: config.actor,
    modo: config.mode === 'practice' ? 'PRACTICA SIN LLM' : 'LLM',
  });
}
