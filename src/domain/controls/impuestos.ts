import { bloquea, confirma, cumple, derivado, type Regla } from './tipos.js';

const vacio = (v: string | undefined) => v === undefined || v === '';

export const rc6IndicadorIva: Regla = {
  codigo: 'RC6',
  nombre: 'Indicador de IVA informado',
  evaluar({ paquete, proveedor }) {
    const informado = paquete.solicitud.indicador_iva;
    if (!vacio(informado)) return cumple(`Indicador ${informado}.`);
    if (!proveedor) return bloquea('La solicitud no informa indicador de IVA y no se puede derivar sin proveedor valido.');
    const valor = proveedor.indicador_iva_default;
    return confirma(`La solicitud no informa indicador de IVA; se derivo ${valor} del proveedor ${proveedor.nombre}. Confirmar.`, { derivados: { indicador_iva: valor } });
  },
};

export const rc7CondicionesPago: Regla = {
  codigo: 'RC7',
  nombre: 'Condiciones de pago informadas',
  evaluar({ paquete, proveedor }) {
    const informado = paquete.solicitud.condiciones_pago;
    if (!vacio(informado)) return cumple(`Condicion ${informado}.`);
    if (!proveedor) return bloquea('No informadas y no se pueden derivar sin proveedor valido.');
    const valor = proveedor.condiciones_pago_default;
    return derivado(`Derivadas del proveedor: ${valor}.`, { condiciones_pago: valor });
  },
};

/** Supuesto propio (no esta en el PRD): los codigos de IVA y pago, informados o derivados, deben existir en los maestros. */
export const rc11CodigosMaestros: Regla = {
  codigo: 'RC11',
  nombre: 'Codigos de IVA y pago existen en maestros',
  evaluar({ paquete, maestros }, previos) {
    const s = paquete.solicitud;
    const iva = s.indicador_iva || previos.indicador_iva;
    const pago = s.condiciones_pago || previos.condiciones_pago;
    const desconocidos: string[] = [];
    if (iva && !maestros.indicadoresIva.some((x) => x.codigo === iva)) desconocidos.push(`indicador de IVA "${iva}"`);
    if (pago && !maestros.condicionesPago.some((x) => x.codigo === pago)) desconocidos.push(`condicion de pago "${pago}"`);
    return desconocidos.length ? bloquea(`Codigos inexistentes en los maestros: ${desconocidos.join(', ')}.`) : cumple('Codigos validos.');
  },
};
