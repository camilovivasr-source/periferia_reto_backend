import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SapAdapter } from './adapter.js';
import type { OrdenCompra } from '../schemas.js';
import { normalizarNit } from '../domain/util.js';
import { cargarMaestros, type Entorno } from '../data.js';

const PRIMERA_OC = 4_500_000_001;
const colas = new Map<string, Promise<unknown>>();

/** Serializa operaciones sobre el mismo archivo dentro del proceso (numeracion sin saltos ni duplicados). */
function enCola<T>(clave: string, tarea: () => Promise<T>): Promise<T> {
  const previa = colas.get(clave) ?? Promise.resolve();
  const siguiente = previa.then(tarea, tarea);
  colas.set(clave, siguiente.catch(() => undefined));
  return siguiente;
}

type Registro = { numero_oc: string; fecha: string; solicitud_id: string; orden: OrdenCompra };

/** SAP simulado: persiste en out/sap/ordenes.jsonl. */
export class SapMock implements SapAdapter {
  private readonly archivo: string;
  constructor(private readonly env: Entorno) {
    this.archivo = path.join(env.outDir, 'sap', 'ordenes.jsonl');
  }

  private async leer(): Promise<Registro[]> {
    try {
      const texto = await readFile(this.archivo, 'utf8');
      return texto.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Registro);
    } catch {
      return [];
    }
  }

  async consultarProveedor(nit: string) {
    const { proveedores } = await cargarMaestros(this.env);
    const p = proveedores.find((x) => normalizarNit(x.nit) === normalizarNit(nit));
    return p ? { codigo_sap: p.codigo_sap, activo: p.activo } : null;
  }

  async buscarOrdenPorReferencia(solicitud_id: string) {
    const r = (await this.leer()).find((x) => x.solicitud_id === solicitud_id);
    return r ? { numero_oc: r.numero_oc, fecha: r.fecha } : null;
  }

  crearOrden(orden: OrdenCompra) {
    return enCola(this.archivo, async () => {
      const existentes = await this.leer();
      const previo = existentes.find((x) => x.solicitud_id === orden.referencia.solicitud_id);
      if (previo) return { numero_oc: previo.numero_oc, fecha: previo.fecha };
      const registro: Registro = {
        numero_oc: String(PRIMERA_OC + existentes.length),
        fecha: new Date().toISOString(),
        solicitud_id: orden.referencia.solicitud_id,
        orden,
      };
      await mkdir(path.dirname(this.archivo), { recursive: true });
      await appendFile(this.archivo, JSON.stringify(registro) + '\n', 'utf8');
      return { numero_oc: registro.numero_oc, fecha: registro.fecha };
    });
  }
}
