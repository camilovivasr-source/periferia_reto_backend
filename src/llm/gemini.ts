import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import { LlmError, type LlmAdapter, type Mensaje, type Respuesta } from './adapter.js';
import type { HerramientaDef } from '../tools/registry.js';

/** A donde y con que credenciales se llama a generateContent: AI Studio (clave) o Vertex AI (identidad del servicio). */
export type Destino = {
  proveedor: string;
  url(modelo: string): Promise<string>;
  cabeceras(): Promise<Record<string, string>>;
  /** Texto para el usuario cuando el proveedor rechaza la credencial. */
  ayudaPermisos: string;
};

export function destinoAiStudio(apiKey: string): Destino {
  return {
    proveedor: 'google-gemini',
    url: async (modelo) => `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
    cabeceras: async () => ({ 'x-goog-api-key': apiKey }),
    ayudaPermisos: 'clave o permisos del modelo invalidos',
  };
}

/**
 * Vertex AI con credenciales por defecto de la aplicacion (ADC): en Cloud Run, la cuenta de servicio del backend
 * (rol roles/aiplatform.user); en local, `gcloud auth application-default login`. No hay clave que guardar.
 */
export function destinoVertex(opciones: { project?: string; location: string; auth?: Pick<GoogleAuth, 'getAccessToken' | 'getProjectId'> }): Destino {
  const auth = opciones.auth ?? new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return {
    proveedor: 'google-vertex-ai',
    url: async (modelo) => {
      const proyecto = opciones.project || (await auth.getProjectId().catch(() => ''));
      if (!proyecto) throw new LlmError('No se pudo determinar el proyecto de Google Cloud para Vertex AI (defina GOOGLE_CLOUD_PROJECT).');
      const l = opciones.location;
      const host = l === 'global' ? 'aiplatform.googleapis.com' : `${l}-aiplatform.googleapis.com`;
      return `https://${host}/v1/projects/${proyecto}/locations/${l}/publishers/google/models/${modelo}:generateContent`;
    },
    cabeceras: async () => {
      const token = await auth.getAccessToken().catch(() => null);
      if (!token) throw new LlmError('No hay credenciales de Google Cloud para llamar a Vertex AI (ADC). Revise la cuenta de servicio del backend.');
      return { Authorization: `Bearer ${token}` };
    },
    ayudaPermisos: 'falta el rol roles/aiplatform.user de la cuenta de servicio, la API aiplatform.googleapis.com o el modelo no esta disponible en la region',
  };
}

type Esquema = Record<string, unknown>;
const TIPOS = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object']);

/**
 * JSON Schema (zod) -> subconjunto OpenAPI que aceptan Gemini y Vertex: tipos en mayusculas, sin
 * additionalProperties/$schema, y sin propiedades de objeto libre (el modelo no necesita enviar
 * paquete/derivados/payload: el servidor los ignora y recalcula).
 */
export function aEsquemaGemini(esquema: Esquema): Esquema {
  const salida: Esquema = {};
  const tipo = typeof esquema.type === 'string' && TIPOS.has(esquema.type) ? esquema.type : undefined;
  if (tipo) salida.type = tipo.toUpperCase();
  if (typeof esquema.description === 'string') salida.description = esquema.description;
  if (Array.isArray(esquema.enum)) salida.enum = esquema.enum;
  if (esquema.items && typeof esquema.items === 'object') salida.items = aEsquemaGemini(esquema.items as Esquema);
  if (esquema.properties && typeof esquema.properties === 'object') {
    const props: Record<string, Esquema> = {};
    for (const [k, v] of Object.entries(esquema.properties as Record<string, Esquema>)) {
      const libre = v.type === 'object' && !(v.properties && Object.keys(v.properties as object).length);
      if (!libre) props[k] = aEsquemaGemini(v);
    }
    salida.properties = props;
    const requeridos = (Array.isArray(esquema.required) ? (esquema.required as string[]) : []).filter((k) => k in props);
    if (requeridos.length) salida.required = requeridos;
  }
  return salida;
}

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
  readonly proveedor: string;
  constructor(
    readonly modelo: string,
    private readonly destino: Destino,
    private readonly timeoutMs: number,
    private readonly http: typeof fetch = globalThis.fetch,
  ) {
    this.proveedor = destino.proveedor;
  }

  /** Sin argumentos no se envia `parameters`: Vertex rechaza OBJECT sin propiedades. */
  private declaracion(h: HerramientaDef) {
    const parameters = aEsquemaGemini(h.parameters);
    const hay = parameters.properties && Object.keys(parameters.properties as object).length > 0;
    return { name: h.name, description: h.description, ...(hay ? { parameters } : {}) };
  }

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
      tools: [{ functionDeclarations: herramientas.map((h) => this.declaracion(h)) }],
      generationConfig: { temperature: 0.1 },
    };
    let respuesta: Response | undefined;
    for (let intento = 0; intento < 2; intento++) {
      try {
        respuesta = await this.http(await this.destino.url(this.modelo), {
          method: 'POST',
          headers: { ...(await this.destino.cabeceras()), 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        if (e instanceof LlmError) throw e;
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
      const causa = estado === 429 ? 'cuota agotada o demasiadas peticiones' : estado === 401 || estado === 403 ? this.destino.ayudaPermisos : estado === 404 ? 'modelo no disponible' : 'error del proveedor';
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
