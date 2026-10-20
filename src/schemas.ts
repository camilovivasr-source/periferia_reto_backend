import { z } from 'zod';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'debe tener formato AAAA-MM-DD');

export const SolicitudSchema = z.object({
  solicitud_id: z.string().min(1),
  solicitante: z.string().min(1),
  proveedor_nombre: z.string().min(1),
  proveedor_nit: z.string().optional(),
  descripcion: z.string().min(1),
  centro_costo: z.string().min(1),
  subarea: z.string().min(1),
  cantidad: z.number({ invalid_type_error: 'debe ser numerico' }).positive(),
  valor_unitario: z.number({ invalid_type_error: 'debe ser numerico' }).nonnegative(),
  valor_total: z.number({ invalid_type_error: 'debe ser numerico' }).positive(),
  moneda: z.enum(['COP', 'USD']),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: fecha,
});
export type Solicitud = z.infer<typeof SolicitudSchema>;

export const CorreoSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  cuerpo: z.string().optional(),
  adjuntos: z.array(z.string()).optional(),
});

export const AprobacionRawSchema = z.object({
  de: z.string(),
  para: z.string().optional(),
  cc: z.array(z.string()).optional(),
  fecha: z.string(),
  asunto: z.string(),
  cuerpo: z.string(),
});
export type AprobacionRaw = z.infer<typeof AprobacionRawSchema>;

export const ProveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
});
export const CentroCostoSchema = z.object({
  centro_costo: z.string(),
  nombre: z.string().optional(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({ email: z.string(), nombre: z.string().optional(), tope: z.number() })),
});
export const IndicadorIvaSchema = z.object({ codigo: z.string(), descripcion: z.string(), tasa: z.number() });
export const CondicionPagoSchema = z.object({ codigo: z.string(), descripcion: z.string(), dias: z.number() });

export type Proveedor = z.infer<typeof ProveedorSchema>;
export type CentroCosto = z.infer<typeof CentroCostoSchema>;
export type IndicadorIva = z.infer<typeof IndicadorIvaSchema>;
export type CondicionPago = z.infer<typeof CondicionPagoSchema>;
export type Maestros = {
  proveedores: Proveedor[];
  centros: CentroCosto[];
  indicadoresIva: IndicadorIva[];
  condicionesPago: CondicionPago[];
};

/** Paquete normalizado (PRD 7.2). Los campos que el texto libre no permite leer quedan en null. */
export type Paquete = {
  correo: { id: string; de: string; asunto: string; fecha: string };
  solicitud: Solicitud;
  cotizacion: {
    referencia: string | null;
    fecha: string | null;
    base_gravable: number | null;
    iva: number | null;
    proveedor: string;
    nit: string | null;
    total: number | null;
    moneda: string | null;
    validez_hasta: string | null;
    items: Array<{ descripcion: string; cantidad: number | null }>;
    texto: string;
  } | null;
  aprobacion: { de: string; para: string | null; cc: string[]; asunto: string; fecha: string; aprobado: boolean; texto: string } | null;
  factura: { numero: string | null; fecha: string | null; total: number | null; texto: string } | null;
  faltantes: string[];
};

export type Hallazgo = { codigo: string; detalle: string };
export type Control = {
  codigo: string;
  regla: string;
  estado: 'CUMPLE' | 'BLOQUEA' | 'CONFIRMA' | 'DERIVADO' | 'NO_APLICA';
  detalle: string;
};
export type Derivados = {
  proveedor_codigo_sap?: string;
  indicador_iva?: string;
  condiciones_pago?: string;
  aprobador_tope?: number;
};
export type Validacion = {
  apta: boolean;
  bloqueos: Hallazgo[];
  confirmaciones: Hallazgo[];
  derivados: Derivados;
  retroactiva: boolean;
  controles: Control[];
};

export const OrdenCompraSchema = z.object({
  referencia: z.object({ solicitud_id: z.string(), correo_id: z.string(), cotizacion_ref: z.string().nullable() }),
  sociedad: z.literal('1000'),
  organizacion_compras: z.literal('1000'),
  proveedor: z.object({ codigo_sap: z.string(), nit: z.string(), nombre: z.string() }),
  moneda: z.enum(['COP', 'USD']),
  condiciones_pago: z.string(),
  aprobador: z.object({ email: z.string(), fecha_aprobacion: z.string(), evidencia_sha256: z.string().length(64) }),
  posiciones: z
    .array(
      z.object({
        numero: z.number().int().positive(),
        descripcion: z.string().max(40),
        cantidad: z.number().positive(),
        unidad: z.enum(['UN', 'H', 'MES']),
        precio_unitario: z.number().nonnegative(),
        precio_incluye_iva: z.boolean(),
        centro_costo: z.string(),
        subarea: z.string(),
        indicador_iva: z.string(),
      }),
    )
    .min(1),
  totales: z.object({ base: z.number(), iva: z.number(), total: z.number() }),
  excepciones: z.array(z.object({ codigo: z.string(), detalle: z.string(), confirmado_por: z.string().nullable() })),
});
export type OrdenCompra = z.infer<typeof OrdenCompraSchema>;

export type Fuente =
  | 'solicitud'
  | 'cotizacion'
  | 'correo'
  | 'aprobacion'
  | 'derivado'
  | 'constante'
  | 'maestro.proveedores'
  | 'maestro.centros-costo'
  | 'maestro.indicadores-iva'
  | 'maestro.condiciones-pago';
export type Trazabilidad = Array<{ campo: string; valor: unknown; fuente: Fuente; nota?: string }>;
