import { LlmError, type LlamadaHerramienta, type LlmAdapter } from '../llm/adapter.js';
import { definiciones, ejecutarHerramienta } from '../tools/registry.js';
import type { ToolContext } from '../tools/types.js';
import { sugerir } from './sugerencias.js';
import { Sesiones, type Sesion } from './sesiones.js';
import type { EntradaHistorial, EventoAgente, LlamadaUI, RespuestaChat } from './tipos.js';

export type OpcionesAgente = {
  llm: LlmAdapter;
  directory: string;
  /** System prompt completo (comportamiento + conocimiento). */
  sistema: string;
  maxIteraciones: number;
  maxTokensSesion: number;
  actor: string;
  /** Etiqueta para la interfaz: "LLM" o "PRACTICA SIN LLM". */
  modo: string;
};

const MAX_MENSAJE = 4000;
const ahora = () => new Date().toISOString();

/**
 * Ciclo del agente: mensaje del usuario -> (modelo -> herramientas)* -> respuesta.
 * El modelo interpreta y pide herramientas; el servidor valida argumentos, ejecuta y decide la confirmacion humana.
 */
export class Agente {
  private readonly sesiones = new Sesiones();

  constructor(private readonly o: OpcionesAgente) {}

  get proveedor() {
    return { proveedor: this.o.llm.proveedor, modelo: this.o.llm.modelo, modo: this.o.modo };
  }

  historial(id: string): EntradaHistorial[] | null {
    return this.sesiones.historial(id);
  }

  /** Atiende un turno. Un solo turno a la vez por sesion. */
  turno(sessionId: string, mensaje: string, onEvento?: (e: EventoAgente) => void): Promise<RespuestaChat> {
    const sesion = this.sesiones.obtener(sessionId);
    const resultado = sesion.cola.then(() => this.atender(sesion, mensaje, onEvento));
    sesion.cola = resultado.catch(() => undefined);
    return resultado;
  }

  private async atender(s: Sesion, texto: string, onEvento?: (e: EventoAgente) => void): Promise<RespuestaChat> {
    const mensaje = texto.slice(0, MAX_MENSAJE);
    const llamadas: LlamadaUI[] = [];
    s.historial.push({ rol: 'user', contenido: mensaje, ts: ahora() });

    let reply: string;
    if (s.tokens >= this.o.maxTokensSesion) {
      reply = 'Esta sesion alcanzo su limite de uso. Abre una sesion nueva para seguir.';
    } else {
      s.confirmacion.aplicarMensaje(mensaje);
      s.mensajes.push({ rol: 'user', contenido: mensaje });
      this.sesiones.recortarContexto(s);
      reply = await this.conversar(s, llamadas, onEvento);
    }
    s.confirmacion.cerrarTurno();

    const pendientes = s.confirmacion.listarPendientes();
    const respuesta: RespuestaChat = {
      sessionId: s.id,
      reply,
      toolCalls: llamadas,
      needsConfirmation: pendientes.length > 0,
      pendientes,
      sugerencias: sugerir(llamadas, pendientes),
      modo: this.o.modo,
      tokensSesion: s.tokens,
    };
    s.historial.push({ rol: 'assistant', contenido: reply, ts: ahora(), toolCalls: llamadas, needsConfirmation: respuesta.needsConfirmation });
    return respuesta;
  }

  /** Bucle modelo <-> herramientas con tope de iteraciones. Un error del proveedor no tumba la sesion (CA5). */
  private async conversar(s: Sesion, llamadas: LlamadaUI[], onEvento?: (e: EventoAgente) => void): Promise<string> {
    const ctx: ToolContext = { directory: this.o.directory, sessionId: s.id, actor: this.o.actor, confirmacion: s.confirmacion };
    try {
      for (let i = 0; i < this.o.maxIteraciones; i++) {
        const r = await this.o.llm.enviar([{ rol: 'system', contenido: this.o.sistema }, ...s.mensajes], definiciones());
        s.tokens += r.tokens;
        s.mensajes.push(r.mensaje);
        const pedidas = r.mensaje.llamadas;
        if (!pedidas?.length) return r.mensaje.contenido.trim() || 'No tengo nada mas que agregar. ¿Que solicitud quieres procesar?';

        for (const llamada of pedidas) llamadas.push(await this.ejecutar(s, ctx, llamada, onEvento));
      }
      const resumen = llamadas.map((c) => c.resumen).slice(-3).join(' | ');
      const reply = `Alcance el limite de ${this.o.maxIteraciones} pasos en este turno. Esto es lo que logre: ${resumen}. Dime si quieres que continue.`;
      s.mensajes.push({ rol: 'assistant', contenido: reply });
      return reply;
    } catch (e) {
      const reply = e instanceof LlmError ? e.message : 'Ocurrio un error inesperado en el agente. La sesion sigue activa; intenta de nuevo.';
      s.mensajes.push({ rol: 'assistant', contenido: reply });
      return reply;
    }
  }

  private async ejecutar(s: Sesion, ctx: ToolContext, l: LlamadaHerramienta, onEvento?: (e: EventoAgente) => void): Promise<LlamadaUI> {
    onEvento?.({ tipo: 'tool_start', id: l.id, nombre: l.nombre, args: l.args, ts: ahora() });
    const res = await ejecutarHerramienta(l.nombre, l.args, ctx);

    // Una validacion que ya no pide confirmacion invalida la que estaba pendiente.
    const caso = (l.args as { caso?: unknown }).caso;
    const sigue = (res.data as { requiere_confirmacion?: boolean } | undefined)?.requiere_confirmacion === true;
    if (l.nombre === 'oc_validar' && typeof caso === 'string' && !sigue) s.confirmacion.descartar(caso);

    const ui: LlamadaUI = {
      id: l.id,
      nombre: l.nombre,
      args: res.args,
      ok: res.ok,
      resumen: res.resumen,
      ms: res.ms,
      resultado: res.ok ? res.data : { error: res.error, ...(JSON.parse(res.texto) as object) },
      ts: ahora(),
    };
    onEvento?.({ tipo: 'tool_end', llamada: ui });
    s.mensajes.push({ rol: 'tool', llamadaId: l.id, nombre: l.nombre, contenido: res.texto });
    return ui;
  }
}
