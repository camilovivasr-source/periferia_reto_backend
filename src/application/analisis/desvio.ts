import { fechaLocal, type Entorno } from '../../data.js';
import { cargarUniverso, dias, porcentaje } from './casos.js';

type TipoEvento = 'cotizacion' | 'solicitud' | 'aprobacion' | 'factura' | 'oc';
export type Evento = { tipo: TipoEvento; fecha: string; detalle: string };

const ORDEN_ESPERADO: TipoEvento[] = ['cotizacion', 'solicitud', 'aprobacion', 'factura'];

type Grupo = { clave: string; casos: number; retroactivas: number; porcentaje: number };
const agrupar = (filas: Array<{ clave: string; retroactiva: boolean }>): Grupo[] => {
  const m = new Map<string, { casos: number; retroactivas: number }>();
  for (const f of filas) {
    const g = m.get(f.clave) ?? { casos: 0, retroactivas: 0 };
    g.casos++;
    if (f.retroactiva) g.retroactivas++;
    m.set(f.clave, g);
  }
  return [...m].map(([clave, g]) => ({ clave, ...g, porcentaje: porcentaje(g.retroactivas, g.casos) })).sort((a, b) => b.porcentaje - a.porcentaje || b.casos - a.casos);
};

/** Desvio de proceso: linea de tiempo por caso (cotizacion -> solicitud -> aprobacion -> factura -> OC) y retroactividad agregada. */
export async function desvioProceso(env: Entorno) {
  const { casos } = await cargarUniverso(env);
  const detalle = casos.map(({ caso, paquete: p, validacion, oc }) => {
    const eventos: Evento[] = [];
    if (p.cotizacion?.fecha) eventos.push({ tipo: 'cotizacion', fecha: p.cotizacion.fecha, detalle: p.cotizacion.referencia ?? 'cotizacion' });
    eventos.push({ tipo: 'solicitud', fecha: p.solicitud.fecha_solicitud, detalle: p.solicitud.solicitud_id });
    if (p.aprobacion) eventos.push({ tipo: 'aprobacion', fecha: fechaLocal(p.aprobacion.fecha), detalle: p.aprobacion.de });
    if (p.factura?.fecha) eventos.push({ tipo: 'factura', fecha: p.factura.fecha, detalle: p.factura.numero ?? 'factura' });
    if (oc) eventos.push({ tipo: 'oc', fecha: oc.fecha.slice(0, 10), detalle: oc.numero_oc });
    eventos.sort((a, b) => a.fecha.localeCompare(b.fecha));

    const secuencia = eventos.filter((e) => ORDEN_ESPERADO.includes(e.tipo)).map((e) => e.tipo);
    const esperada = ORDEN_ESPERADO.filter((t) => secuencia.includes(t));
    const solicitud = p.solicitud.fecha_solicitud;
    return {
      caso,
      solicitud_id: p.solicitud.solicitud_id,
      centro_costo: p.solicitud.centro_costo,
      proveedor: p.solicitud.proveedor_nombre,
      retroactiva: validacion.retroactiva,
      dias_factura_antes_de_solicitud: p.factura?.fecha && p.factura.fecha < solicitud ? dias(p.factura.fecha, solicitud) : 0,
      dias_cotizacion_a_solicitud: p.cotizacion?.fecha ? dias(p.cotizacion.fecha, solicitud) : null,
      secuencia_correcta: secuencia.join() === esperada.join(),
      eventos,
    };
  });
  return {
    resumen: {
      casos: detalle.length,
      retroactivas: detalle.filter((d) => d.retroactiva).length,
      porcentaje: porcentaje(detalle.filter((d) => d.retroactiva).length, detalle.length),
      dias_promedio_de_desvio: detalle.filter((d) => d.retroactiva).length
        ? Math.round((detalle.reduce((s, d) => s + d.dias_factura_antes_de_solicitud, 0) / detalle.filter((d) => d.retroactiva).length) * 10) / 10
        : 0,
    },
    por_centro: agrupar(detalle.map((d) => ({ clave: d.centro_costo, retroactiva: d.retroactiva }))),
    por_proveedor: agrupar(detalle.map((d) => ({ clave: d.proveedor, retroactiva: d.retroactiva }))),
    casos: detalle,
  };
}
