import { normalizarNit, parsearMonto, sumarDias } from './util.js';
import type { Paquete } from '../schemas.js';

type Cotizacion = NonNullable<Paquete['cotizacion']>;
type Factura = NonNullable<Paquete['factura']>;

const linea = (texto: string, etiqueta: RegExp) => etiqueta.exec(texto)?.[1]?.trim() ?? null;

/** Lee el texto libre de la cotizacion. Lo que no se puede leer queda en null; nunca se inventa. */
export function parsearCotizacion(texto: string): Cotizacion {
  const nit = linea(texto, /^NIT:\s*(.+)$/m);
  const total = /^TOTAL[^:\n]*:\s*(COP|USD)?\s*([\d.,]+)/im.exec(texto);
  const fecha = linea(texto, /^Fecha:\s*(\d{4}-\d{2}-\d{2})/m);
  const validez = /^Validez de la oferta:\s*(\d+)\s*d[ií]as/im.exec(texto);
  const items = [...texto.matchAll(/^\d+\.\s*(.+?)\s*\|\s*Cantidad:\s*([\d.,]+)/gm)].map((m) => ({
    descripcion: m[1].trim(),
    cantidad: parsearMonto(m[2]),
  }));
  const base = /^Base gravable:\s*(?:COP|USD)?\s*([\d.,]+)/im.exec(texto);
  const iva = /^IVA[^:\n]*:\s*(?:COP|USD)?\s*([\d.,]+)/im.exec(texto);
  return {
    referencia: linea(texto, /^COTIZACI[ÓO]N\s+(\S+)/m),
    fecha,
    base_gravable: base ? parsearMonto(base[1]) : null,
    iva: iva ? parsearMonto(iva[1]) : null,
    proveedor: linea(texto, /^Proveedor:\s*(.+)$/m) ?? '',
    nit: nit ? normalizarNit(nit) : null,
    total: total ? parsearMonto(total[2]) : null,
    moneda: total?.[1]?.toUpperCase() ?? null,
    validez_hasta: fecha && validez ? sumarDias(fecha, Number(validez[1])) : null,
    items,
    texto,
  };
}

export function parsearFactura(texto: string): Factura {
  const total = /^TOTAL:\s*(?:COP|USD)?\s*([\d.,]+)/im.exec(texto);
  return {
    numero: linea(texto, /FACTURA[^\n]*?No\.\s*(\S+)/i),
    fecha: linea(texto, /Fecha de emisi[óo]n:\s*(\d{4}-\d{2}-\d{2})/i),
    total: total ? parsearMonto(total[1]) : null,
    texto,
  };
}

/** "Aprobado" explicito y sin negacion previa ("no aprobado", "no esta aprobado"). */
export function esAprobacion(cuerpo: string): boolean {
  if (!/\baprobad[oa]\b/i.test(cuerpo)) return false;
  return !/\bno\s+(?:est[áa]\s+|queda\s+|fue\s+)?aprobad[oa]\b/i.test(cuerpo);
}
