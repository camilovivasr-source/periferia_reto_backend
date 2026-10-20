// COMPLETAR(PRD): Definir moneda, unidades, descuentos, redondeo por posición/total y tolerancia oficial. No añadir tolerancias para ocultar errores.
// Ver ficha de este archivo en ARQUITECTURA.md.
import type { Bundle,Check } from '../models.js';
import { check } from './common.js';
export function financialControls(b:Bundle):Check[]{
 const s=b.solicitud,tax=b.masters.impuestos.find(t=>t.codigo===s.indicadorIva);
 const expected=tax?Math.round(s.baseCentavos*tax.tasaPuntosBase/10000):undefined;
 return [check('IVA',expected!==undefined&&expected===s.ivaCentavos,`IVA esperado=${expected??'indicador desconocido'}; informado=${s.ivaCentavos} centavos`),check('TOTAL',s.baseCentavos+s.ivaCentavos===s.totalCentavos,`Total esperado=${s.baseCentavos+s.ivaCentavos}; informado=${s.totalCentavos} centavos`)];
}
