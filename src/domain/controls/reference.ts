// COMPLETAR(PRD): Reemplazar igualdad al default por política real; validar subárea y relación con centro/líder. Determinar tratamiento de proveedor desconocido/inactivo.
// Ver ficha de este archivo en ARQUITECTURA.md.
import type { Bundle,Check } from '../models.js';
import { check } from './common.js';
export function referenceControls(b:Bundle):Check[]{
 const s=b.solicitud,p=b.masters.proveedores.find(p=>p.nit===s.nit),cc=b.masters.centros.find(c=>c.id===s.centroCosto);
 return [check('PROVEEDOR',!!p?.activo,p?.activo?'Proveedor activo':'Proveedor inexistente o inactivo'),check('CENTRO',!!cc,cc?'Centro existente':'Centro inexistente'),check('PAGO',b.masters.pagos.some(p=>p.codigo===s.condicionPago)&&p?.condicionPago===s.condicionPago,'Politica educativa: codigo conocido e igual al default del proveedor')];
}
