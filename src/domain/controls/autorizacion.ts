import { bloquea, cop, cumple, noAplica, type Regla } from './tipos.js';

export const rc2Aprobacion: Regla = {
  codigo: 'RC2',
  nombre: 'Aprobacion explicita de un aprobador del centro',
  evaluar({ paquete, centro, aprobador }) {
    const a = paquete.aprobacion;
    if (!a) return bloquea('no hay correo de aprobacion. Accion: pedir aprobacion al lider del centro.');
    const problemas: string[] = [];
    if (!a.aprobado) problemas.push('el correo no contiene un "Aprobado" explicito');
    if (!centro) problemas.push(`el centro ${paquete.solicitud.centro_costo} no existe, no hay aprobadores que verificar`);
    else if (!aprobador) {
      const lista = centro.aprobadores.map((x) => x.email).join(', ');
      problemas.push(`${a.de} no figura como aprobador del centro ${centro.centro_costo} (aprobadores: ${lista})`);
    }
    if (problemas.length) return bloquea(`${problemas.join('; ')}. Accion: pedir aprobacion al lider del centro.`);
    return cumple(`${aprobador!.nombre ?? aprobador!.email} aprobo por correo.`);
  },
};

export const rc3Tope: Regla = {
  codigo: 'RC3',
  nombre: 'Valor total dentro del tope del aprobador',
  evaluar({ paquete, centro, aprobador }) {
    const s = paquete.solicitud;
    if (s.moneda !== 'COP') return bloquea(`Los topes estan definidos en COP y la solicitud es en ${s.moneda}; no hay tasa de cambio en los maestros para compararlos.`);
    if (aprobador) {
      const base = { derivados: { aprobador_tope: aprobador.tope } };
      if (s.valor_total <= aprobador.tope) return { ...cumple(`${cop(s.valor_total)} <= tope ${cop(aprobador.tope)}.`), ...base };
      return { ...bloquea(`${cop(s.valor_total)} supera el tope de ${aprobador.nombre ?? aprobador.email} (${cop(aprobador.tope)}). Accion: aprobacion de un nivel superior.`), ...base };
    }
    if (!centro) return noAplica('No evaluable: el centro de costo no existe (ver RC4).');
    // Sin aprobador valido (RC2 ya bloquea) se compara con el mayor tope del centro para dar la accion correcta.
    const maximo = Math.max(...centro.aprobadores.map((x) => x.tope));
    if (s.valor_total > maximo) return bloquea(`${cop(s.valor_total)} supera incluso el mayor tope del centro ${centro.centro_costo} (${cop(maximo)}). Accion: escalar a una autoridad superior.`);
    return noAplica('No evaluable: el remitente no es aprobador del centro (ver RC2).');
  },
};
