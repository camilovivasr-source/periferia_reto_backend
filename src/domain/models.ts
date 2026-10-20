// COMPLETAR(PRD): Agregar subáreas, posiciones, cantidades, moneda y otros datos solo si aparecen en PRD. Definir estados faltantes como REQUIERE_DATOS si aplica.
// Ver ficha de este archivo en ARQUITECTURA.md.
/** Modelo interno de estudio. Adaptar con mapeadores al formato oficial. */
export type PurchaseRequest={id:string;nit:string;centroCosto:string;baseCentavos:number;ivaCentavos:number;totalCentavos:number;indicadorIva:string;condicionPago:string;fechaSolicitud:string};
export type Approval={solicitudId:string;aprobadorId:string;montoCentavos:number;requestHash:string;justificacion?:string;fecha?:string};
export type Masters={proveedores:{nit:string;activo:boolean;condicionPago:string}[];centros:{id:string;liderId:string;topeCentavos:number}[];impuestos:{codigo:string;tasaPuntosBase:number}[];pagos:{codigo:string;dias:number}[]};
export type InvoiceData={fecha?:string;valida:boolean};
export type Bundle={solicitud:PurchaseRequest;correo:unknown;cotizacion:string;cotizacionDatos:Record<string,string>;aprobacion?:Approval;factura?:string;facturaDatos?:InvoiceData;masters:Masters;snapshot:string};
export type Check={codigo:string;resultado:'CUMPLE'|'BLOQUEA'|'PENDIENTE';motivo:string};
export type Status='RECHAZADA'|'REQUIERE_APROBACION'|'LISTA_PARA_CREAR'|'CREADA';
export type Result={solicitudId:string;estado:Status;controles:Check[];snapshot:string;oc?:string;resumen?:PurchaseRequest;revision?:{puedeAprobar:boolean;puedeRechazar:boolean;motivo:string;actorId?:string};sap?:{simulado:true;oc:string;solicitudId:string}};
export type Order={id:string;solicitudId:string;snapshot:string};
export type Rejection={actorId:string;justificacion:string;fecha:string};
export type StoredApproval={approval?:Approval;rejection?:Rejection;snapshot:string};
export type ReviewerPolicy={id:string;centros:string[];topeCentavos:number;puedeRetroactiva:boolean};
export type AuditEvent={id:string;solicitudId:string;action:string;actorId:string;fecha:string;justificacion?:string;snapshot:string;oc?:string};
