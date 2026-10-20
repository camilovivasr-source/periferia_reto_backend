import type { LlamadaHerramienta, LlmAdapter, Mensaje, Respuesta } from '../llm/adapter.js';
import { interpretarRespuesta } from './confirmacion.js';
import { redactar, type ResultadoTool } from './practice-texto.js';

type Intencion = 'listar' | 'control' | 'procesar' | 'crear' | 'ayuda';

const AYUDA = 'Modo practica (sin modelo). Escribe por ejemplo: **procesa sol-004**, y luego **confirmo** para crear la OC. Casos: sol-001 a sol-006.';

/**
 * Modo practica: un "modelo" determinista que traduce comandos simples a llamadas de herramientas.
 * Pasa por el mismo ciclo, las mismas herramientas y la misma barrera de confirmacion que el modelo real.
 * No es un agente conversacional: sirve para verificar la integracion cuando no hay modelo disponible.
 */
export class PracticaAdapter implements LlmAdapter {
  readonly proveedor = 'practica';
  readonly modelo = 'comandos-sin-llm';

  async enviar(mensajes: Mensaje[]): Promise<Respuesta> {
    const indiceUsuario = mensajes.map((m) => m.rol).lastIndexOf('user');
    const texto = (mensajes[indiceUsuario] as { contenido: string }).contenido;
    const resultados = resultadosDelTurno(mensajes.slice(indiceUsuario + 1));
    const caso = casoVigente(mensajes, indiceUsuario);
    const llamada = (nombre: string, args: Record<string, unknown>, n: number): LlamadaHerramienta => ({ id: `p-${indiceUsuario}-${n}`, nombre, args });
    const pide = (...llamadas: LlamadaHerramienta[]): Respuesta => ({ mensaje: { rol: 'assistant', contenido: '', llamadas }, tokens: 0 });
    const dice = (contenido: string): Respuesta => ({ mensaje: { rol: 'assistant', contenido }, tokens: 0 });

    if (resultados.length > 0) return this.siguientePaso(caso, texto, resultados, llamada, pide, dice);

    switch (entender(texto, caso)) {
      case 'listar': return pide(llamada('oc_listar_casos', {}, 0));
      case 'control': return pide(llamada('oc_resumen_control', {}, 0));
      case 'crear': return pide(llamada('oc_crear', { caso, confirmado: true }, 0));
      case 'procesar': return pide(llamada('oc_leer_paquete', { caso }, 0), llamada('oc_validar', { caso }, 1));
      default: return dice(AYUDA);
    }
  }

  /** Decide, segun los resultados ya obtenidos en este turno, que herramienta sigue o cuando redactar la respuesta. */
  private siguientePaso(
    caso: string | null,
    texto: string,
    resultados: ResultadoTool[],
    llamada: (n: string, a: Record<string, unknown>, i: number) => LlamadaHerramienta,
    pide: (...l: LlamadaHerramienta[]) => Respuesta,
    dice: (c: string) => Respuesta,
  ): Respuesta {
    const de = (nombre: string) => resultados.find((r) => r.nombre === nombre);
    const validar = de('oc_validar');
    const validacion = validar?.ok ? (validar.data as { apta: boolean; confirmaciones: unknown[] }) : null;

    if (validacion?.apta && !de('oc_construir_payload') && !de('oc_crear')) {
      return pide(llamada('oc_construir_payload', { caso }, 2), llamada('oc_generar_evidencia', { caso }, 3));
    }
    const soloRevisar = /(no (la )?crees|sin crear|solo (valida|revisa|muestra))/i.test(texto);
    if (de('oc_construir_payload') && !de('oc_crear') && !validacion?.confirmaciones.length && !soloRevisar) {
      return pide(llamada('oc_crear', { caso }, 4));
    }
    return dice(redactar(caso, resultados));
  }
}

function resultadosDelTurno(mensajes: Mensaje[]): ResultadoTool[] {
  return mensajes
    .filter((m): m is Extract<Mensaje, { rol: 'tool' }> => m.rol === 'tool')
    .map((m) => ({ nombre: m.nombre, ...(JSON.parse(m.contenido) as Omit<ResultadoTool, 'nombre'>) }));
}

/** El caso que se nombro en el mensaje actual o, si no, en el ultimo mensaje del usuario que lo nombro. */
function casoVigente(mensajes: Mensaje[], desde: number): string | null {
  for (let i = desde; i >= 0; i--) {
    const m = mensajes[i];
    const caso = m.rol === 'user' ? /sol-\d{3}/i.exec(m.contenido) : null;
    if (caso) return caso[0].toLowerCase();
  }
  return null;
}

function entender(texto: string, caso: string | null): Intencion {
  if (/\b(casos|disponibles|lista\w*|panorama)\b/i.test(texto)) return 'listar';
  if (/\b(resumen|control|retroactiv\w*)\b/i.test(texto)) return 'control';
  if (!caso) return 'ayuda';
  const procesa = /\b(procesa|valida|revisa)\w*/i.test(texto);
  if (!procesa && interpretarRespuesta(texto) === 'confirma') return 'crear';
  return 'procesar';
}
