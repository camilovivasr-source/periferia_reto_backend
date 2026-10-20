type Resultado = { ok?: boolean; data?: unknown; error?: string };
type Dic = Record<string, unknown>;

const lista = (v: unknown): Dic[] => (Array.isArray(v) ? (v as Dic[]) : []);
const codigos = (v: unknown) => lista(v).map((x) => String(x.codigo)).join(', ');

/** Linea corta para mostrar en el chat (nombre, que paso). El detalle completo viaja aparte. */
export function resumir(nombre: string, r: Resultado): string {
  if (!r.ok) return `Error: ${r.error ?? 'sin detalle'}`.slice(0, 220);
  const d = (r.data ?? {}) as Dic;
  switch (nombre) {
    case 'oc_leer_paquete': {
      const s = (d.solicitud ?? {}) as Dic;
      const falta = lista(d.faltantes).length || (Array.isArray(d.faltantes) ? d.faltantes.length : 0);
      return `Paquete ${String(s.solicitud_id)} · ${String(s.proveedor_nombre)} · ${String(s.moneda)} ${Number(s.valor_total).toLocaleString('es-CO')}${falta ? ` · faltan: ${(d.faltantes as string[]).join(', ')}` : ''}`;
    }
    case 'oc_validar':
      return `${d.apta ? 'APTA' : 'NO APTA'} · bloqueos: ${lista(d.bloqueos).length ? codigos(d.bloqueos) : 'ninguno'} · confirmaciones: ${lista(d.confirmaciones).length ? codigos(d.confirmaciones) : 'ninguna'}${d.retroactiva ? ' · RETROACTIVA' : ''}`;
    case 'oc_construir_payload': {
      const p = (d.payload ?? {}) as Dic;
      const t = (p.totales ?? {}) as Dic;
      return `Payload listo · ${lista(p.posiciones).length} posicion(es) · total ${Number(t.total).toLocaleString('es-CO')} · ${d.requiere_confirmacion ? 'requiere confirmacion' : 'sin confirmaciones'}`;
    }
    case 'oc_generar_evidencia':
      return `Evidencia ${String(d.ruta)} · sha256 ${String(d.sha256).slice(0, 12)}…`;
    case 'oc_crear':
      return d.idempotente ? `OC ${String(d.numero_oc)} ya existia (idempotente)` : `OC ${String(d.numero_oc)} creada`;
    case 'oc_consultar_conocimiento':
      return `${lista(d.resultados).length} seccion(es): ${lista(d.resultados).map((x) => String(x.seccion)).join(' | ')}`.slice(0, 220);
    case 'oc_leer_excel':
      return `${String(d.total)} fila(s), columnas: ${(d.columnas as string[]).join(', ')}`;
    case 'oc_listar_casos':
      return `${(r.data as unknown[]).length} casos listados`;
    case 'oc_consultar_maestro':
      return `${String(d.maestro)}: ${String(d.total)} registro(s)`;
    case 'oc_resumen_control':
      return `${String(d.intentos)} intento(s) · ${lista(d.oc_creadas).length} OC creada(s) · ${String(d.porcentaje_retroactivas)} % retroactivas`;
    default:
      return 'OK';
  }
}
