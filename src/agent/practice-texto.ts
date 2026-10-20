export type ResultadoTool = { nombre: string; ok: boolean; data?: unknown; error?: string };
type Hallazgos = Array<{ codigo: string; detalle: string }>;

const hallazgos = (xs: Hallazgos) => xs.map((x) => `- **${x.codigo}**: ${x.detalle}`);
const dinero = (n: number) => n.toLocaleString('es-CO');

/** Redacta la respuesta del modo practica a partir de los resultados de las herramientas (sin inventar nada). */
export function redactar(caso: string | null, resultados: ResultadoTool[]): string {
  const de = (nombre: string) => resultados.find((r) => r.nombre === nombre);

  const casos = de('oc_listar_casos');
  if (casos?.ok) return tablaCasos(casos.data as Array<{ caso: string; proveedor: string; valor_total: number; estado: string; numero_oc: string | null }>);
  const control = de('oc_resumen_control');
  if (control?.ok) {
    const d = control.data as { intentos: number; oc_creadas: unknown[]; porcentaje_retroactivas: number };
    return `Control: ${d.intentos} intento(s), ${d.oc_creadas.length} OC creada(s), ${d.porcentaje_retroactivas} % retroactivas.`;
  }

  const lineas: string[] = [`**${caso}** (modo practica)`];
  const paquete = de('oc_leer_paquete');
  if (paquete && !paquete.ok) return `No pude leer el paquete: ${paquete.error}`;

  const validar = de('oc_validar');
  const v = validar?.ok ? (validar.data as { apta: boolean; bloqueos: Hallazgos; confirmaciones: Hallazgos; retroactiva: boolean }) : null;
  if (v) {
    lineas.push(v.apta ? 'Resultado: **apta** para crear.' : 'Resultado: **no apta**. No se crea la OC.');
    if (v.bloqueos.length) lineas.push('Bloqueos:', ...hallazgos(v.bloqueos));
    if (v.confirmaciones.length) lineas.push('Confirmaciones requeridas:', ...hallazgos(v.confirmaciones));
    if (v.retroactiva) lineas.push('Marcada como **retroactiva** en el control.');
  } else if (validar) lineas.push(`Validacion: ${validar.error}`);

  const payload = de('oc_construir_payload');
  if (payload?.ok) lineas.push('', ...tablaPayload((payload.data as { payload: Payload }).payload));

  const crear = de('oc_crear');
  if (crear?.ok) {
    const d = crear.data as { numero_oc: string; idempotente: boolean };
    lineas.push('', `**OC ${d.numero_oc}** ${d.idempotente ? 'ya existia (idempotente)' : 'creada'}.`);
  } else if (crear) lineas.push('', `No se creo la OC: ${crear.error}`);
  else if (v?.apta && v.confirmaciones.length) lineas.push('', '¿Confirmas que cree la OC con estas excepciones? Responde **confirmo** para continuar.');
  return lineas.join('\n');
}

type Payload = {
  proveedor: { nombre: string; codigo_sap: string };
  moneda: string;
  condiciones_pago: string;
  totales: { total: number };
  posiciones: Array<{ descripcion: string; cantidad: number; unidad: string; centro_costo: string; subarea: string; indicador_iva: string }>;
};

function tablaPayload(p: Payload): string[] {
  const pos = p.posiciones[0];
  return [
    '| Campo | Valor |', '|---|---|',
    `| Proveedor | ${p.proveedor.nombre} (${p.proveedor.codigo_sap}) |`,
    `| Posicion 10 | ${pos.descripcion} · ${pos.cantidad} ${pos.unidad} |`,
    `| Centro / subarea | ${pos.centro_costo} / ${pos.subarea} |`,
    `| IVA / pago | ${pos.indicador_iva} / ${p.condiciones_pago} |`,
    `| Total | ${p.moneda} ${dinero(p.totales.total)} |`,
  ];
}

function tablaCasos(casos: Array<{ caso: string; proveedor: string; valor_total: number; estado: string; numero_oc: string | null }>): string {
  const filas = casos.map((c) => `| ${c.caso} | ${c.proveedor} | ${dinero(c.valor_total)} | ${c.estado}${c.numero_oc ? ` (OC ${c.numero_oc})` : ''} |`);
  return ['Casos disponibles (modo practica):', '', '| Caso | Proveedor | Valor | Estado |', '|---|---|---|---|', ...filas].join('\n');
}
