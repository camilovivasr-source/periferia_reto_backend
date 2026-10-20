import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Hallazgo } from '../domain/types.js';
import { LlmError, type LlmAdapter, type Mensaje } from '../llm/adapter.js';
import { definiciones, ejecutarHerramienta } from '../tools/registry.js';
import type { ConfirmacionPuerto } from '../tools/types.js';

export type LlamadaUI = {
  id: string;
  nombre: string;
  args: unknown;
  ok: boolean;
  resumen: string;
  ms: number;
  resultado: unknown;
  ts: string;
};
export type Pendiente = { caso: string; confirmaciones: Hallazgo[] };
export type EventoAgente =
  | { tipo: 'tool_start'; id: string; nombre: string; args: unknown; ts: string }
  | { tipo: 'tool_end'; llamada: LlamadaUI };
export type RespuestaChat = {
  sessionId: string;
  reply: string;
  toolCalls: LlamadaUI[];
  needsConfirmation: boolean;
  pendientes: Pendiente[];
  modo: string;
  tokensSesion: number;
};
export type EntradaHistorial = { rol: 'user' | 'assistant'; contenido: string; ts: string; toolCalls?: LlamadaUI[]; needsConfirmation?: boolean };

type Sesion = {
  id: string;
  mensajes: Mensaje[];
  historial: EntradaHistorial[];
  pendientes: Map<string, { huella: string; confirmaciones: Hallazgo[] }>;
  concedidas: Map<string, string>;
  tokens: number;
  actualizada: number;
  cola: Promise<unknown>;
};

export type OpcionesAgente = {
  llm: LlmAdapter;
  directory: string;
  sistema: string;
  maxIteraciones: number;
  maxTokensSesion: number;
  actor: string;
  modo: string;
};

const MAX_MENSAJE = 4000;
const MAX_SESIONES = 200;
const MAX_MENSAJES_CONTEXTO = 80;

/** Carga el system prompt (comportamiento) y el conocimiento del proceso, que viven en archivos aparte. */
export async function cargarSistema(directory: string): Promise<string> {
  const [prompt, conocimiento] = await Promise.all([
    readFile(path.join(directory, 'agent', 'prompt.md'), 'utf8'),
    readFile(path.join(directory, 'src', 'knowledge', 'ordenes-compra.md'), 'utf8'),
  ]);
  return `${prompt}\n\n---\n\n${conocimiento}`;
}

/**
 * Interpreta la respuesta humana a una pregunta de confirmacion.
 * Si el mensaje es una pregunta, no cuenta como confirmacion.
 */
export function interpretarRespuesta(texto: string): 'confirma' | 'rechaza' | 'otro' {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/[?¿]/.test(t)) return 'otro';
  if (/\b(no|cancela\w*|rechaz\w*|detente|espera|todavia no|aun no)\b/.test(t)) return 'rechaza';
  if (/\b(confirmo|confirmado|confirmada|si|adelante|procede|proceder|crea\w*|hazlo|dale|ok|okay|de acuerdo|autorizo|acepto)\b/.test(t)) return 'confirma';
  return 'otro';
}

const casosMencionados = (texto: string) => [...new Set([...texto.toLowerCase().matchAll(/sol-\d{3}/g)].map((m) => m[0]))];

export class Agente {
  private readonly sesiones = new Map<string, Sesion>();
  constructor(private readonly o: OpcionesAgente) {}

  get proveedor() {
    return { proveedor: this.o.llm.proveedor, modelo: this.o.llm.modelo, modo: this.o.modo };
  }

  private sesion(id: string): Sesion {
    let s = this.sesiones.get(id);
    if (!s) {
      if (this.sesiones.size >= MAX_SESIONES) {
        const vieja = [...this.sesiones.values()].sort((a, b) => a.actualizada - b.actualizada)[0];
        this.sesiones.delete(vieja.id);
      }
      s = { id, mensajes: [], historial: [], pendientes: new Map(), concedidas: new Map(), tokens: 0, actualizada: Date.now(), cola: Promise.resolve() };
      this.sesiones.set(id, s);
    }
    s.actualizada = Date.now();
    return s;
  }

  historial(id: string): EntradaHistorial[] | null {
    return this.sesiones.get(id)?.historial ?? null;
  }

  /** Un solo turno a la vez por sesion. */
  turno(sessionId: string, mensaje: string, onEvento?: (e: EventoAgente) => void): Promise<RespuestaChat> {
    const s = this.sesion(sessionId);
    const resultado = s.cola.then(() => this.ejecutarTurno(s, mensaje, onEvento));
    s.cola = resultado.catch(() => undefined);
    return resultado;
  }

  private puerto(s: Sesion): ConfirmacionPuerto {
    return {
      registrar: (caso, huella, confirmaciones) => void s.pendientes.set(caso, { huella, confirmaciones }),
      concedida: (caso, huella) => s.concedidas.get(caso) === huella,
      consumir: (caso) => {
        s.pendientes.delete(caso);
        s.concedidas.delete(caso);
      },
    };
  }

  /** La confirmacion la concede la persona (su mensaje), no el modelo. Se limita a los casos mencionados, si hay. */
  private aplicarRespuestaHumana(s: Sesion, mensaje: string) {
    s.concedidas.clear();
    if (!s.pendientes.size) return;
    const mencionados = casosMencionados(mensaje);
    const alcance = [...s.pendientes.keys()].filter((c) => !mencionados.length || mencionados.includes(c));
    const que = interpretarRespuesta(mensaje);
    if (que === 'confirma') for (const c of alcance) s.concedidas.set(c, s.pendientes.get(c)!.huella);
    if (que === 'rechaza') for (const c of alcance) s.pendientes.delete(c);
  }

  private recortar(s: Sesion) {
    if (s.mensajes.length <= MAX_MENSAJES_CONTEXTO) return;
    let i = s.mensajes.length - MAX_MENSAJES_CONTEXTO;
    while (i < s.mensajes.length && s.mensajes[i].rol !== 'user') i++;
    s.mensajes = s.mensajes.slice(i);
  }

  private async ejecutarTurno(s: Sesion, texto: string, onEvento?: (e: EventoAgente) => void): Promise<RespuestaChat> {
    const mensaje = texto.slice(0, MAX_MENSAJE);
    const llamadas: LlamadaUI[] = [];
    const ahora = () => new Date().toISOString();
    s.historial.push({ rol: 'user', contenido: mensaje, ts: ahora() });
    let reply = '';

    if (s.tokens >= this.o.maxTokensSesion) {
      reply = 'Esta sesion alcanzo su limite de uso. Abre una sesion nueva para seguir.';
    } else {
      this.aplicarRespuestaHumana(s, mensaje);
      s.mensajes.push({ rol: 'user', contenido: mensaje });
      this.recortar(s);
      const ctx = { directory: this.o.directory, sessionId: s.id, actor: this.o.actor, confirmacion: this.puerto(s) };
      try {
        for (let i = 0; i < this.o.maxIteraciones; i++) {
          const r = await this.o.llm.enviar([{ rol: 'system', contenido: this.o.sistema }, ...s.mensajes], definiciones());
          s.tokens += r.tokens;
          s.mensajes.push(r.mensaje);
          if (!r.mensaje.llamadas?.length) {
            reply = r.mensaje.contenido.trim() || 'No tengo nada mas que agregar. ¿Que solicitud quieres procesar?';
            break;
          }
          for (const l of r.mensaje.llamadas) {
            onEvento?.({ tipo: 'tool_start', id: l.id, nombre: l.nombre, args: l.args, ts: ahora() });
            const res = await ejecutarHerramienta(l.nombre, l.args, ctx);
            const caso = typeof (l.args as { caso?: unknown }).caso === 'string' ? (l.args as { caso: string }).caso : null;
            if (l.nombre === 'oc_validar' && caso && (res.data as { requiere_confirmacion?: boolean } | undefined)?.requiere_confirmacion !== true) s.pendientes.delete(caso);
            const ui: LlamadaUI = { id: l.id, nombre: l.nombre, args: res.args, ok: res.ok, resumen: res.resumen, ms: res.ms, resultado: res.ok ? res.data : { error: res.error, ...(JSON.parse(res.texto) as object) }, ts: ahora() };
            llamadas.push(ui);
            onEvento?.({ tipo: 'tool_end', llamada: ui });
            s.mensajes.push({ rol: 'tool', llamadaId: l.id, nombre: l.nombre, contenido: res.texto });
          }
          if (i === this.o.maxIteraciones - 1) {
            reply = `Alcance el limite de ${this.o.maxIteraciones} pasos en este turno. Esto es lo que logre: ${llamadas.map((c) => c.resumen).slice(-3).join(' | ')}. Dime si quieres que continue.`;
            s.mensajes.push({ rol: 'assistant', contenido: reply });
          }
        }
      } catch (e) {
        reply = e instanceof LlmError ? e.message : 'Ocurrio un error inesperado en el agente. La sesion sigue activa; intenta de nuevo.';
        s.mensajes.push({ rol: 'assistant', contenido: reply });
      }
    }
    s.concedidas.clear();
    const pendientes: Pendiente[] = [...s.pendientes].map(([caso, v]) => ({ caso, confirmaciones: v.confirmaciones }));
    const respuesta: RespuestaChat = { sessionId: s.id, reply, toolCalls: llamadas, needsConfirmation: pendientes.length > 0, pendientes, modo: this.o.modo, tokensSesion: s.tokens };
    s.historial.push({ rol: 'assistant', contenido: reply, ts: ahora(), toolCalls: llamadas, needsConfirmation: respuesta.needsConfirmation });
    return respuesta;
  }
}
