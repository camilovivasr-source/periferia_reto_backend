---
name: ordenes-compra
description: Conocimiento del proceso de ordenes de compra de Periferia: documentos del paquete, controles RC1-RC11, maestros, estados y tratamiento de compras retroactivas. Cargar antes de procesar o explicar una solicitud.
---

# Conocimiento del proceso: ordenes de compra (OC)

## Como llega una compra
Cada compra llega a administracion por correo con tres piezas: la solicitud (Excel), la cotizacion del proveedor y
el correo de aprobacion del lider. A veces llega tambien la factura. La analista digita en SAP proveedor,
descripcion, centro de costo y subarea, valor, indicador de IVA, aprobador y condiciones de pago, y adjunta el
correo de aprobacion como PDF.

## Controles (los aplica `oc_validar`)
| Codigo | Control | Resultado si falla |
|---|---|---|
| RC1 | El proveedor existe en el maestro (por NIT; sin NIT, por nombre) y esta activo | Bloqueo |
| RC2 | Hay correo de aprobacion que dice "Aprobado" y viene de un aprobador del centro de costo | Bloqueo |
| RC3 | El valor total no supera el tope del aprobador en ese centro | Bloqueo |
| RC4 | La subarea pertenece al centro de costo | Bloqueo |
| RC5 | La cotizacion coincide con la solicitud (tolerancia 2 %); sin cotizacion tambien se confirma | Confirmacion |
| RC6 | Falta el indicador de IVA: se deriva del proveedor | Confirmacion + derivado |
| RC7 | Faltan condiciones de pago: se derivan del proveedor | Derivado (se informa) |
| RC8 | Factura con fecha anterior a la solicitud: compra retroactiva | Confirmacion |
| RC9 | Aprobacion con fecha anterior a la solicitud | Confirmacion |
| RC10 | cantidad x valor unitario = valor total (+-1) | Bloqueo |
| RC11 | Los codigos de IVA y pago existen en los maestros (supuesto de esta solucion) | Bloqueo |

## Tipos de resultado
- **Bloqueo**: impide crear. Se explica la razon y la accion sugerida.
- **Confirmacion**: se puede crear solo si la persona confirma explicitamente en el chat.
- **Derivado**: un dato que el agente completo desde los maestros; se informa.

## Maestros
- Proveedores: codigo SAP, NIT, condiciones de pago e indicador de IVA por defecto, activo/inactivo.
- Centros de costo: subareas y aprobadores con su tope en COP.
- Indicadores de IVA: C0 excluido (0 %), C1 IVA 19 %, C2 IVA 5 %.
- Condiciones de pago: Z000 inmediato, Z015 15 dias, Z030 30 dias, Z060 60 dias.

## Compras retroactivas
Con frecuencia la OC se crea despues de recibir la factura, saltandose la cotizacion previa. Una factura anterior
a la solicitud marca la compra como retroactiva. No es prueba de fraude: es una senal que la direccion quiere
medir. Se crea solo con confirmacion y queda registrada en `out/control.csv`. Nunca se alteran fechas.

## Evidencia y SAP
La evidencia de aprobacion es el correo del lider (encabezados + cuerpo) con su SHA-256. La OC se crea en un SAP
simulado, con numeracion desde 4500000001; crear dos veces la misma solicitud devuelve la misma OC.

## Glosario
- **OC (orden de compra)**: documento de compra en SAP que compromete el gasto con un proveedor. Numeracion simulada desde 4500000001.
- **Solicitud**: pedido interno de compra (Excel) con proveedor, descripcion, centro de costo, subarea, cantidad y valores.
- **Cotizacion**: oferta del proveedor; su total se compara con la solicitud (tolerancia 2 %, RC5).
- **Aprobacion**: correo del lider que dice "Aprobado"; solo vale si el lider es aprobador del centro y el monto cabe en su tope.
- **Centro de costo / subarea**: donde se imputa el gasto (CC-1010 Tecnologia, CC-2020 Administracion, CC-3030 Comercial).
- **Tope**: monto maximo que un aprobador puede autorizar en su centro.
- **Indicador de IVA**: C0 excluido (0 %), C1 IVA 19 %, C2 IVA 5 %. Los precios de las cotizaciones vienen con IVA incluido.
- **Condiciones de pago**: Z000 inmediato, Z015/Z030/Z060 a 15/30/60 dias de la fecha de factura.
- **Retroactiva**: OC creada cuando la factura ya existia (factura anterior a la solicitud). Se mide, no se oculta.
- **Derivado**: valor completado por el agente desde los maestros (por ejemplo, condiciones de pago del proveedor).
- **Idempotencia**: crear dos veces la misma solicitud devuelve la misma OC, nunca una segunda.
- **Evidencia**: el correo de aprobacion con su SHA-256 (txt y PDF) que se adjunta a la OC.
- **control.csv**: registro de cada intento de creacion (creada, bloqueada, pendiente) que consume Auditoria.

## Solicitudes nuevas
Ademas de los seis casos entregados, la analista puede registrar solicitudes nuevas desde la interfaz. Se guardan
aparte (nunca en los fixtures entregados), reciben el siguiente nombre libre (sol-007, sol-008…) y pasan por los mismos
controles y el mismo flujo de confirmacion.
