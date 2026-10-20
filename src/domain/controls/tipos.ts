import type { CentroCosto, Control, Derivados, Maestros, Paquete, Proveedor } from '../../schemas.js';

/** Aprobador del centro de costo cuyo correo coincide con el remitente de la aprobacion. */
export type Aprobador = CentroCosto['aprobadores'][number];

/** Todo lo que una regla necesita saber, resuelto una sola vez por `validar`. */
export type ContextoValidacion = {
  paquete: Paquete;
  maestros: Maestros;
  proveedor: Proveedor | null;
  centro: CentroCosto | null;
  aprobador: Aprobador | null;
};

/** Lo que una regla decide. `derivados` y `retroactiva` son efectos de negocio que se acumulan. */
export type Veredicto = {
  estado: Control['estado'];
  detalle: string;
  derivados?: Derivados;
  retroactiva?: boolean;
};

/** Una regla de control: pura, sin I/O, trazable por su codigo RC. */
export type Regla = {
  codigo: string;
  nombre: string;
  evaluar(ctx: ContextoValidacion, derivadosPrevios: Derivados): Veredicto;
};

export const cumple = (detalle: string): Veredicto => ({ estado: 'CUMPLE', detalle });
export const bloquea = (detalle: string): Veredicto => ({ estado: 'BLOQUEA', detalle });
export const confirma = (detalle: string, extra: Partial<Veredicto> = {}): Veredicto => ({ estado: 'CONFIRMA', detalle, ...extra });
export const derivado = (detalle: string, derivados: Derivados): Veredicto => ({ estado: 'DERIVADO', detalle, derivados });
export const noAplica = (detalle: string): Veredicto => ({ estado: 'NO_APLICA', detalle });

export const cop = (n: number) => n.toLocaleString('es-CO');
