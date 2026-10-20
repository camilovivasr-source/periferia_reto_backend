import { z } from 'zod';
import { LlmError, type LlmAdapter, type Mensaje, type Respuesta } from './adapter.js';
import type { HerramientaDef } from '../tools/registry.js';

const parteSchema = z
  .object({
    text: z.string().optional(),
    thought: z.boolean().optional(),
    functionCall: z.object({ id: z.string().optional(), name: z.string(), args: z.record(z.unknown()).optional() }).passthrough().optional(),
  })
  .passthrough();
const respuestaSchema = z.object({
  candidates: z.array(z.object({ content: z.object({ parts: z.array(parteSchema).default([]) }).optional(), finishReason: z.string().optional() })).min(1),
  usageMetadata: z.object({ totalTokenCount: z.number().optional() }).passthrough().optional(),
});

type Contenido = { role: 'user' | 'model'; parts: unknown[] };
const REINTENTABLES = new Set([429, 500, 502, 503, 504]);

export class GeminiAdapter implements LlmAdapter {
  readonly proveedor = 'google-gemini';
  constructor(
    readonly modelo: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly http: typeof fetch = globalThis.fetch,
  ) {}

  private contenidos(mensajes: Mensaje[]): Contenido[] {
    const salida: Contenido[] = [];
    const idsNativos = new Map<string, string | undefined>();
    for (const m of mensajes) {
      if (m.rol === 'system') continue;
      if (m.rol === 'user') salida.push({ role: 'user', parts: [{ text: m.contenido }] });
      else if (m.rol === 'assistant') {
        for (const p of (m.crudo ?? []).map((x) => parteSchema.parse(x))) if (p.functionCall) idsNativos.set(p.functionCall.id ?? '', p.functionCall.id);
        salida.push({ role: 'model', parts: m.crudo ?? [{ text: m.contenido }] });
      } else {
        const nativo = idsNativos.get(m.llamadaId);
        let respuesta: unknown;
        try {
          respuesta = JSON.parse(m.contenido);
        } catch {
          respuesta = { texto: m.contenido };
        }
        const parte = { functionResponse: { name: m.nombre, response: { result: respuesta }, ...(nativo ? { id: nativo } : {}) } };
        const ultimo = salida.at(-1);
        if (ultimo?.role === 'user' && ultimo.parts.every((p) => (p as { functionResponse?: unknown }).functionResponse)) ultimo.parts.push(parte);
        else salida.push({ role: 'user', parts: [parte] });
      }
    }
    return salida;
  }

  async enviar(mensajes: Mensaje[], herramientas: HerramientaDef[]): Promise<Respuesta> {
    const cuerpo = {
      systemInstruction: { parts: [{ text: mensajes.filter((m) => m.rol === 'system').map((m) => m.contenido).join('\n\n') }] },
      contents: this.contenidos(mensajes),
      tools: [{ functionDeclarations: herramientas.map((h) => ({ name: h.name, description: h.description, parametersJsonSchema: h.parameters })) }],
      generationConfig: { temperature: 0.1 },
    };
    let respuesta: Response | undefined;
    for (let intento = 0; intento < 2; intento++) {
      try {
        respuesta = await this.http(`https://generativelanguage.googleapis.com/v1beta/models/${this.modelo}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
          throw new LlmError(`El modelo no respondio en ${Math.round(this.timeoutMs / 1000)} s. Intenta de nuevo en un momento.`);
        }
        throw new LlmError('No se pudo contactar al proveedor del modelo. Revisa la conexion del servidor.');
      }
      if (respuesta.ok || !REINTENTABLES.has(respuesta.status) || intento === 1) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!respuesta || !respuesta.ok) {
      const estado = respuesta?.status ?? 0;
      const causa = estado === 429 ? 'cuota agotada o demasiadas peticiones' : estado === 401 || estado === 403 ? 'clave o permisos del modelo invalidos' : estado === 404 ? 'modelo no disponible' : 'error del proveedor';
      throw new LlmError(`El proveedor del modelo respondio HTTP ${estado} (${causa}). No es un rechazo de la compra.`);
    }
    const parsed = respuestaSchema.safeParse(await respuesta.json());
    if (!parsed.success) throw new LlmError('El modelo no devolvio una respuesta utilizable (posible bloqueo de contenido).');
    const partes = parsed.data.candidates[0].content?.parts ?? [];
    const llamadas = partes.flatMap((p, i) =>
      p.functionCall ? [{ id: p.functionCall.id ?? `g-${mensajes.length}-${i}`, nombre: p.functionCall.name, args: p.functionCall.args ?? {} }] : [],
    );
    return {
      mensaje: {
        rol: 'assistant',
        contenido: partes.filter((p) => !p.thought).map((p) => p.text ?? '').join(''),
        ...(llamadas.length ? { llamadas } : {}),
        crudo: partes,
      },
      tokens: parsed.data.usageMetadata?.totalTokenCount ?? 0,
    };
  }
}
