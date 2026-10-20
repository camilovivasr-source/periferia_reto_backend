import { createHash } from 'node:crypto';

export const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

/** JSON con claves ordenadas: mismo contenido, mismo hash. */
export function jsonEstable(valor: unknown): string {
  const orden = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(orden);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, orden(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(orden(valor));
}

/** Minusculas, sin tildes ni puntuacion, espacios colapsados. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "900.555.111-2" -> "900555111" (sin puntos ni digito de verificacion). */
export function normalizarNit(nit: string): string {
  return nit.split('-')[0].replace(/\D/g, '');
}

/** "11.400.000" -> 11400000; "1.234,50" -> 1234.5; "1234.50" -> 1234.5. null si no es un monto. */
export function parsearMonto(texto: string): number | null {
  const t = texto.trim().replace(/[^\d.,]/g, '');
  if (!t) return null;
  let limpio: string;
  if (t.includes(',')) limpio = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) limpio = t.replace(/\./g, '');
  else limpio = t;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

export const soloFecha = (iso: string) => iso.slice(0, 10);

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const redondear = (n: number, decimales = 2) => {
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
};
