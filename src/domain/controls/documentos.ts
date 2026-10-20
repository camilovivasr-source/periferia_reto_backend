import { fechaLocal } from '../../data.js';
import { normalizarNit } from '../util.js';
import { confirma, cop, cumple, noAplica, type Regla } from './tipos.js';

const TOLERANCIA_COTIZACION = 0.02;

export const rc5Cotizacion: Regla = {
  codigo: 'RC5',
  nombre: 'Cotizacion coincide con la solicitud (+-2 %)',
  evaluar({ paquete, proveedor }) {
    const s = paquete.solicitud;
    const c = paquete.cotizacion;
    if (!c) return confirma('No hay cotizacion en el paquete: confirmar si se crea sin ella.');
    if (c.total === null) return confirma('No se pudo leer el total de la cotizacion: verificarlo manualmente.');
    const diferencia = Math.abs(c.total - s.valor_total) / s.valor_total;
    const avisos: string[] = [];
    if (diferencia > TOLERANCIA_COTIZACION) {
      avisos.push(`la cotizacion suma ${cop(c.total)} y la solicitud ${cop(s.valor_total)} (diferencia ${(diferencia * 100).toFixed(1)} %, tolerancia 2 %)`);
    }
    if (c.moneda && c.moneda !== s.moneda) avisos.push(`moneda de la cotizacion ${c.moneda} distinta de ${s.moneda}`);
    if (c.nit && s.proveedor_nit && normalizarNit(c.nit) !== normalizarNit(s.proveedor_nit)) {
      avisos.push(`NIT de la cotizacion ${c.nit} distinto del de la solicitud ${normalizarNit(s.proveedor_nit)}`);
    }
    if (c.nit && proveedor && normalizarNit(c.nit) !== normalizarNit(proveedor.nit)) {
      avisos.push(`NIT de la cotizacion ${c.nit} distinto del del proveedor en maestro ${proveedor.nit}`);
    }
    if (avisos.length) return confirma(`${avisos.join('; ')}.`);
    return cumple(`Cotizacion ${cop(c.total)} vs solicitud ${cop(s.valor_total)} (${(diferencia * 100).toFixed(2)} %).`);
  },
};

export const rc8Retroactiva: Regla = {
  codigo: 'RC8',
  nombre: 'Sin factura anterior a la solicitud',
  evaluar({ paquete }) {
    const f = paquete.factura;
    const fechaSolicitud = paquete.solicitud.fecha_solicitud;
    if (!f) return cumple('No hay factura en el paquete.');
    if (!f.fecha) return confirma('Hay una factura pero no se pudo leer su fecha de emision: verificar si la compra es retroactiva.');
    if (f.fecha < fechaSolicitud) {
      return confirma(`Compra retroactiva: la factura ${f.numero ?? '(sin numero)'} es del ${f.fecha} y la solicitud del ${fechaSolicitud}. Se crea solo con confirmacion y queda marcada para el control.`, { retroactiva: true });
    }
    return cumple(`Factura del ${f.fecha}, posterior o igual a la solicitud.`);
  },
};

export const rc9FechaAprobacion: Regla = {
  codigo: 'RC9',
  nombre: 'Aprobacion no anterior a la solicitud',
  evaluar({ paquete }) {
    const a = paquete.aprobacion;
    if (!a) return noAplica('Sin correo de aprobacion (ver RC2).');
    const fecha = fechaLocal(a.fecha);
    if (fecha < paquete.solicitud.fecha_solicitud) {
      return confirma(`La aprobacion es del ${fecha} y la solicitud del ${paquete.solicitud.fecha_solicitud}: se aprobo antes de existir la solicitud.`);
    }
    return cumple(`Aprobacion del ${fecha}.`);
  },
};
