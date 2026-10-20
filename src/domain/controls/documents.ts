// COMPLETAR(PRD): Definir campos a contrastar, precedencia de correo/cotización y eventos reales de retroactividad. Distinguir factura presente de irregularidad comprobada.
// Ver ficha de este archivo en ARQUITECTURA.md.
import type { Bundle,Check,Approval,ReviewerPolicy } from '../models.js';
import { approvalScope } from '../reviewer.js';
import { check } from './common.js';
export function documentControls(b:Bundle,human?:Approval,policies:ReviewerPolicy[]=[]):Check[]{
 const s=b.solicitud,f=b.cotizacionDatos;
 const checks=[check('COTIZACION',f.nit===s.nit&&f.baseCentavos===String(s.baseCentavos)&&f.ivaCentavos===String(s.ivaCentavos)&&f.totalCentavos===String(s.totalCentavos)&&f.condicionPago===s.condicionPago,'NIT, importes y pago deben coincidir con cotizacion')];
 if(b.facturaDatos){const inv=b.facturaDatos;checks.push(check('FACTURA_FECHA',inv.valida,'Fecha de factura debe ser reconocida'),check('RETROACTIVA',inv.valida&&!!inv.fecha&&(inv.fecha>=s.fechaSolicitud||approvalScope(b,human,policies).retroactive),'Regla educativa: factura anterior requiere revision especial',true));}
 return checks;
}
