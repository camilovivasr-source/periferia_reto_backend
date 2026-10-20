import { bloquea, cop, cumple, type Regla } from './tipos.js';

const TOLERANCIA = 1;

export const rc10Aritmetica: Regla = {
  codigo: 'RC10',
  nombre: 'cantidad x valor unitario = valor total',
  evaluar({ paquete }) {
    const { cantidad, valor_unitario, valor_total } = paquete.solicitud;
    const calculado = cantidad * valor_unitario;
    if (Math.abs(calculado - valor_total) > TOLERANCIA) {
      return bloquea(`${cantidad} x ${cop(valor_unitario)} = ${cop(calculado)}, pero el valor total es ${cop(valor_total)}.`);
    }
    return cumple(`${cantidad} x ${cop(valor_unitario)} = ${cop(calculado)}.`);
  },
};
