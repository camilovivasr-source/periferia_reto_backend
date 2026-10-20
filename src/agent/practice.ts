import type { LlmAdapter, LlamadaHerramienta, Mensaje, Respuesta } from '../llm/adapter.js';
import { interpretarRespuesta } from './loop.js';

/**
 * Modo practica: un "modelo" determinista que traduce comandos simples a llamadas de herramientas.
 * Pasa por el mismo ciclo, las mismas herramientas y la misma barrera de confirmacion que el modelo real.
 * No es un agente conversacional: sirve para verificar la integracion cuando no hay clave de modelo.
 */
export class PracticaAdapter implements LlmAdapter {
  readonly proveedor = 'practica';
  readonly modelo = 'comandos-sin-llm';

  async enviar(mensajes: Mensaje[]): Promise<Respuesta> {
    const ultimoUser = mensajes.map((m, i) => ({ m, i })).filter((x) => x.m.rol === 'user').at(-1)!;
    const texto = (ultimoUser.m as { contenido: string }).contenido;
    const turno = mensajes.slice(ultimoUser.i + 1);
    const resultados = turno.filter((m): m is Extract<Mensaje, { rol: 'tool' }> => m.rol === 'tool').map((m) => ({ nombre: m.nombre, ...(JSON.parse(m.contenido) as { ok: boolean; data?: Record<string, unknown>; error?: string }) }));
    const caso = this.caso(mensajes, ultimoUser.i);
    const llama = (nombre: string, args: Record<string, unknown>, n: number): LlamadaHerramienta => ({ id: `p-${ultimoUser.i}-${n}`, nombre, args });
    const respuesta = (contenido: string, llamadas?: LlamadaHerramienta[]): Respuesta => ({ mensaje: { rol: 'assistant', contenido, ...(llamadas ? { llamadas } : {}) }, tokens: 0 });

    const quiereCrear = caso !== null && interpretarRespuesta(texto) === 'confirma';
    const soloValidar = /(no (la )?crees|sin crear|solo (valida|revisa|muestra))/i.test(texto);

    if (!caso) return respuesta('Modo practica (sin modelo). Escribe por ejemplo: **procesa sol-004**, y luego **confirmo** para crear la OC. Casos: sol-001 a sol-006.');
    if (resultados.length === 0) {
      if (quiereCrear && !/\b(procesa|valida|revisa)\w*/i.test(texto)) return respuesta('', [llama('oc_crear', { caso, confirmado: true }, 0)]);
      return respuesta('', [llama('oc_leer_paquete', { caso }, 0), llama('oc_validar', { caso }, 1)]);
    }
    const validar = resultados.find((r) => r.nombre === 'oc_validar');
    const crear = resultados.find((r) => r.nombre === 'oc_crear');
    const construir = resultados.find((r) => r.nombre === 'oc_construir_payload');
    if (validar?.ok && (validar.data as { apta: boolean }).apta && !construir && !crear) {
      return respuesta('', [llama('oc_construir_payload', { caso }, 2), llama('oc_generar_evidencia', { caso }, 3)]);
    }
    const confirmaciones = ((validar?.data as { confirmaciones?: unknown[] } | undefined)?.confirmaciones ?? []).length;
    if (construir && !crear && !confirmaciones && !soloValidar) return respuesta('', [llama('oc_crear', { caso }, 4)]);
    return respuesta(this.redactar(caso, resultados, texto));
  }

  private caso(mensajes: Mensaje[], hasta: number): string | null {
    for (let i = hasta; i >= 0; i--) {
      const m = mensajes[i];
      if (m.rol === 'user') {
        const c = /sol-\d{3}/i.exec(m.contenido);
        if (c) return c[0].toLowerCase();
      }
    }
    return null;
  }

  private redactar(caso: string, rs: Array<{ nombre: string; ok: boolean; data?: Record<string, unknown>; error?: string }>, _texto: string): string {
    const por = (n: string) => rs.find((r) => r.nombre === n);
    const L: string[] = [`**${caso}** (modo practica)`];
    const paquete = por('oc_leer_paquete');
    if (paquete && !paquete.ok) return `No pude leer el paquete: ${paquete.error}`;
    const v = por('oc_validar');
    const hallazgos = (xs: unknown) => (xs as Array<{ codigo: string; detalle: string }> | undefined ?? []).map((x) => `- **${x.codigo}**: ${x.detalle}`);
    if (v?.ok) {
      const d = v.data as { apta: boolean; bloqueos: unknown[]; confirmaciones: unknown[]; retroactiva: boolean };
      L.push(d.apta ? 'Resultado: **apta** para crear.' : 'Resultado: **no apta**. No se crea la OC.');
      if (d.bloqueos.length) L.push('Bloqueos:', ...hallazgos(d.bloqueos));
      if (d.confirmaciones.length) L.push('Confirmaciones requeridas:', ...hallazgos(d.confirmaciones));
      if (d.retroactiva) L.push('Marcada como **retroactiva** en el control.');
    } else if (v) L.push(`Validacion: ${v.error}`);
    const p = por('oc_construir_payload');
    if (p?.ok) {
      const pl = p.data!.payload as { proveedor: { nombre: string; codigo_sap: string }; moneda: string; condiciones_pago: string; totales: { total: number }; posiciones: Array<{ descripcion: string; cantidad: number; unidad: string; centro_costo: string; subarea: string; indicador_iva: string }> };
      const pos = pl.posiciones[0];
      L.push('', '| Campo | Valor |', '|---|---|', `| Proveedor | ${pl.proveedor.nombre} (${pl.proveedor.codigo_sap}) |`, `| Posicion 10 | ${pos.descripcion} · ${pos.cantidad} ${pos.unidad} |`, `| Centro / subarea | ${pos.centro_costo} / ${pos.subarea} |`, `| IVA / pago | ${pos.indicador_iva} / ${pl.condiciones_pago} |`, `| Total | ${pl.moneda} ${pl.totales.total.toLocaleString('es-CO')} |`);
    }
    const c = por('oc_crear');
    if (c?.ok) L.push('', `**OC ${String(c.data!.numero_oc)}** ${c.data!.idempotente ? 'ya existia (idempotente)' : 'creada'}.`);
    else if (c) L.push('', `No se creo la OC: ${c.error}`);
    else if (v?.ok && (v.data as { apta: boolean; confirmaciones: unknown[] }).apta && (v.data as { confirmaciones: unknown[] }).confirmaciones.length) {
      L.push('', '¿Confirmas que cree la OC con estas excepciones? Responde **confirmo** para continuar.');
    }
    return L.join('\n');
  }
}
