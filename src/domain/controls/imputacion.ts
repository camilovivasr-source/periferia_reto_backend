import { normalizarTexto } from '../util.js';
import { bloquea, cumple, type Regla } from './tipos.js';

export const rc4Subarea: Regla = {
  codigo: 'RC4',
  nombre: 'Subarea pertenece al centro de costo',
  evaluar({ paquete, centro }) {
    const s = paquete.solicitud;
    if (!centro) return bloquea(`El centro de costo ${s.centro_costo} no existe en el maestro.`);
    if (!centro.subareas.some((x) => normalizarTexto(x) === normalizarTexto(s.subarea))) {
      return bloquea(`La subarea "${s.subarea}" no pertenece a ${centro.centro_costo} (subareas: ${centro.subareas.join(', ')}).`);
    }
    return cumple(`${s.subarea} pertenece a ${centro.centro_costo}.`);
  },
};
