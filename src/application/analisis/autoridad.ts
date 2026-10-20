import type { Entorno } from '../../data.js';
import { cargarUniverso, porcentaje } from './casos.js';

/** Matriz de autoridad: aprobadores por centro con su tope, uso real en los casos, y consulta "quien puede aprobar X en Y". */
export async function autoridad(env: Entorno, consulta?: { centro: string; monto: number }) {
  const { casos, maestros } = await cargarUniverso(env);
  const matriz = maestros.centros.map((centro) => ({
    centro_costo: centro.centro_costo,
    nombre: centro.nombre ?? centro.centro_costo,
    subareas: centro.subareas,
    aprobadores: centro.aprobadores.map((a) => ({
      email: a.email,
      nombre: a.nombre ?? a.email,
      tope: a.tope,
      casos: casos
        .filter((c) => c.paquete.solicitud.centro_costo === centro.centro_costo && c.paquete.aprobacion?.de === a.email.toLowerCase())
        .map((c) => ({ caso: c.caso, valor: c.paquete.solicitud.valor_total, uso_pct: porcentaje(c.paquete.solicitud.valor_total, a.tope), dentro_del_tope: c.paquete.solicitud.valor_total <= a.tope })),
    })),
    casos_sin_autoridad: casos
      .filter((c) => c.paquete.solicitud.centro_costo === centro.centro_costo && !centro.aprobadores.some((a) => a.email.toLowerCase() === c.paquete.aprobacion?.de))
      .map((c) => ({ caso: c.caso, aprobo: c.paquete.aprobacion?.de ?? null, valor: c.paquete.solicitud.valor_total })),
  }));

  let respuesta: null | { centro: string; monto: number; centro_existe: boolean; pueden_aprobar: Array<{ email: string; nombre: string; tope: number; holgura: number }>; requiere_escalar: boolean; tope_maximo: number | null };
  respuesta = null;
  if (consulta) {
    const centro = maestros.centros.find((c) => c.centro_costo === consulta.centro.toUpperCase());
    const pueden = (centro?.aprobadores ?? []).filter((a) => a.tope >= consulta.monto).map((a) => ({ email: a.email, nombre: a.nombre ?? a.email, tope: a.tope, holgura: a.tope - consulta.monto }));
    respuesta = {
      centro: consulta.centro.toUpperCase(),
      monto: consulta.monto,
      centro_existe: !!centro,
      pueden_aprobar: pueden,
      requiere_escalar: !!centro && pueden.length === 0,
      tope_maximo: centro ? Math.max(...centro.aprobadores.map((a) => a.tope)) : null,
    };
  }
  return { matriz, consulta: respuesta };
}
