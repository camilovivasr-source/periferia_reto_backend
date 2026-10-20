# SOLUCION.md — Agente de órdenes de compra SAP (Reto 3)

## 1. Problema en una frase
La analista administrativa digita a mano, por cada factura, proveedor, centro de costo, subárea, valor, IVA, aprobador y condiciones de pago en SAP, con el control de autoridad "de memoria" y sin medir cuántas OC se crean después de la factura. El agente lee el paquete, valida contra los maestros, construye la OC, genera la evidencia y la crea en un SAP simulado; lo dudoso lo devuelve al humano con una recomendación.

## 2. Arquitectura
```
 Navegador ──HTTP/SSE──▶ Frontend (Cloud Run, público)  ──ID token IAM──▶  Backend (Cloud Run, privado)
 chat + tarjetas de        proxy mínimo, CSP, límites                       ┌───────────────────────────────┐
 herramientas + banner                                                      │ server.ts  API + sesiones     │
 de confirmación                                                            │ agent/loop.ts  ciclo del agente│
                                                                            │ llm/  adaptador (Gemini)       │
                                                                            │ tools/oc.ts  herramientas zod  │
                                                                            │ domain/  reglas RC1-RC11       │
                                                                            │ sap/  adaptador + mock         │
                                                                            └──────┬────────────────┬────────┘
                                                                   fixtures/ (solo lectura)   out/ (escritura)
```
| Responsabilidad | Dónde vive | Por qué ahí |
|---|---|---|
| **Comportamiento** (rol, flujo, tono, reglas de conversación) | `agent/prompt.md` | Se cambia sin tocar código. |
| **Conocimiento** (proceso, matriz de controles, glosario, retroactivas) | `src/knowledge/ordenes-compra.md` | Se concatena al system prompt; el módulo reutilizable lo publica como skill. |
| **Ejecución** (leer, validar, construir, evidenciar, crear) | `src/tools/oc.ts` (contratos) → `src/application/` (casos de uso) → `src/domain/` (reglas) | Sin HTTP ni LLM: el chat, el demo y las pruebas llaman lo mismo. |
| **Proveedor LLM** | `src/llm/adapter.ts` (`LlmAdapter.enviar(mensajes, herramientas)`) + `gemini.ts` | Cambiar de proveedor no toca el ciclo. |
| **SAP** | `src/sap/adapter.ts` (`SapAdapter`) + `mock.ts` | El dominio no sabe de ERP; el mock escribe en `out/sap/`. |

Un cambio de reglas de negocio toca `src/domain/controls/*`, nunca el servidor.

**Pestaña «Análisis»** (valor agregado, solo lectura): cinco herramientas sobre los mismos casos de uso y reglas que usa el agente, expuestas en `/api/analisis/*` y `src/application/analisis/`:
1. **Panel de control**: KPIs de cartera (creadas, por crear, bloqueadas, % sin intervención, % retroactivas, valor comprometido, ahorro estimado), reglas que más frenan y bitácora de `control.csv` con filtro; exportación de **carga masiva SAP** (Plan B del PRD 7.5) y de `control.csv`.
2. **Desvío de proceso**: línea de tiempo por solicitud (cotización → solicitud → aprobación → factura → OC), días de desvío y retroactividad por centro de costo y por proveedor. Es la medición que pide la dirección.
3. **Conciliación documental**: solicitud vs cotización vs factura con semáforo de tolerancia (2 %) y coherencia del IVA (IVA ÷ base de la cotización contra la tasa del maestro).
4. **Simulador de controles** («¿qué pasaría si…?»): revalida un caso con cambios hipotéticos (valor, aprobador, centro, fecha de factura, quitar cotización…) y muestra qué controles cambian. Ocurre solo en memoria: no escribe en `fixtures/` ni en `out/`.
5. **Autoridad de aprobación**: matriz de aprobadores y topes con el uso real por solicitud, casos aprobados por quien no tiene autoridad y la consulta «¿quién puede aprobar X en el centro Y?» (o si hay que escalar).

**Despliegue continuo**: cada push a `main` o a la rama de trabajo ejecuta pruebas y redespliega el servicio en Cloud Run (`.github/workflows/deploy.yml` en ambos repos). GitHub se autentica en Google Cloud con **Workload Identity Federation** (sin claves JSON) restringida a estos dos repos y a esas ramas; `infra/cicd.sh` lo configura una vez y `infra/deploy-*.sh` es el mismo comando que usa el instalador.

**Dependencias** (justificadas): `zod` (obligatoria; valida argumentos de herramientas y fixtures), `zod-to-json-schema` (publica a Gemini los mismos esquemas, sin duplicarlos), `google-auth-library` (credenciales por defecto para Vertex AI sin claves), `read-excel-file` (lectura real de `.xlsx` para `oc_leer_excel`), `dotenv` (variables en local). Dev: `typescript`, `tsx` (ejecutar TS sin compilar) y `write-excel-file` (solo para generar un `.xlsx` en las pruebas). Sin framework de UI ni de gráficos: el front es HTML/JS modular y los gráficos son SVG/CSS.

## 3. Ciclo del agente
`Agente.turno(sessionId, mensaje)` (`src/agent/loop.ts`):
1. Si la sesión superó `MAX_TOKENS_SESION`, responde con el límite (costo acotado).
2. **La persona responde, no el modelo**: antes de llamar al modelo, el servidor interpreta el mensaje del usuario. Si hay una confirmación pendiente y el mensaje es afirmativo ("confirmo", "sí, crea…") y no es una pregunta, concede la confirmación **para esa huella**. Si dice "no", la descarta.
3. Bucle `modelo → herramientas → modelo` con tope `MAX_ITERACIONES` (25, CA1). Cada llamada pasa por `ejecutarHerramienta`: valida argumentos con zod, devuelve el error al modelo si no cumplen, ejecuta, resume y escribe en `out/log.jsonl` (CA4). Los eventos `tool_start`/`tool_end` salen por SSE para que el front muestre cada llamada en vivo.
4. Termina cuando el modelo responde sin llamadas. Si hay confirmaciones pendientes, la respuesta trae `needsConfirmation: true` y el front resalta el banner con botones.
5. Errores del proveedor (timeout, 429, 403…) se convierten en un mensaje claro en el chat; la sesión sigue viva (CA5).

**Confirmación humana (CA3)**. `oc_crear` solo crea con confirmaciones si `confirmado = true` **y** el servidor tiene registrada una concesión humana vigente para la *huella* actual de lo que se muestra (hash del payload + confirmaciones). El modelo no puede conceder: si escribe `confirmado: true` por su cuenta (o lo induce una cotización con "ignora las reglas"), la herramienta responde que falta confirmación. La concesión se consume al crear y dura un solo turno. Si cambian los datos entre validar y confirmar, la huella cambia y se vuelve a pedir.

**Sesiones**: en memoria (hasta 200, máx. 80 mensajes de contexto). Por eso el backend corre con `--max-instances 1`.

## 4. Elección del modelo
- **Gemini 2.5 Flash por Vertex AI** (`AGENT_MODE=vertex`), vía `generateContent` con function calling nativo (esquemas derivados de zod y convertidos al subconjunto OpenAPI). Se autentica con la identidad de la cuenta de servicio del backend (`roles/aiplatform.user`, credenciales por defecto de la aplicación): **no hay clave de API que guardar ni filtrar**. Motivos: function calling fiable, latencia y costo bajos, y todo queda dentro del proyecto de Google Cloud. AI Studio con clave sigue disponible (`AGENT_MODE=gemini`).
- Se conservan las partes nativas del modelo entre rondas (firmas de razonamiento) y los `id` de las llamadas.
- **Costo estimado por caso** (supuesto, a verificar con la tarifa vigente): un caso procesa ~5 llamadas a herramientas y 4–6 rondas con ~6–10 mil tokens de contexto acumulado → del orden de 40–60 mil tokens de entrada y 2–4 mil de salida por caso. A tarifas de la familia Flash (centavos de dólar por millón de tokens) es del orden de **centésimas de dólar por caso**. `MAX_TOKENS_SESION` (300 000) y `MAX_ITERACIONES` limitan el gasto de una sesión.
- Sin clave, el servidor arranca en **modo práctica** (un "modelo" determinista que traduce comandos a las mismas herramientas). Está etiquetado como tal en la UI; **no** reemplaza al agente LLM.
- No verificado en este entorno: no hay credenciales de Google Cloud aquí; el adaptador (AI Studio y Vertex) está probado contra respuestas simuladas (`tests/modulo.test.ts`). `instalar.sh` prueba Vertex de verdad antes de desplegar y hace un chat real al final.

## 5. Matriz de controles
Cada control es una regla pura en `src/domain/controls/` (proveedor, autorizacion, imputacion, documentos, impuestos, aritmetica); `src/domain/validate.ts` (`validar`) las compone en orden. Las usan chat, demo y `oc_crear` (que revalida siempre).
| # | Regla | Implementación | Tipo |
|---|---|---|---|
| RC1 | Proveedor existe y activo | Por NIT normalizado (sin puntos ni dígito de verificación); sin NIT, por nombre normalizado (sin tildes/puntuación) | Bloqueo |
| RC2 | Aprobación con "Aprobado" de un aprobador del centro | `esAprobacion` (rechaza negaciones: "no aprobado"); remitente buscado en `aprobadores` del centro | Bloqueo |
| RC3 | Valor ≤ tope del aprobador | Tope del remitente; si no es aprobador, se compara con el mayor tope del centro para dar la acción correcta ("escalar") | Bloqueo |
| RC4 | Subárea pertenece al centro | Comparación normalizada | Bloqueo |
| RC5 | Cotización ±2 % | También confirma si falta, no se lee el total, cambia la moneda o el NIT | Confirmación |
| RC6 | IVA ausente | Se deriva del proveedor y se pide confirmar | Confirmación + derivado |
| RC7 | Pago ausente | Se deriva del proveedor y se informa | Derivado |
| RC8 | Factura anterior a la solicitud | `retroactiva = true`, confirmación, fila marcada en `control.csv` | Confirmación |
| RC9 | Aprobación anterior a la solicitud | Fecha local escrita en el correo, sin convertir zona horaria | Confirmación |
| RC10 | cantidad × unitario = total (±1) | — | Bloqueo |
| RC11 | Códigos de IVA/pago existen en maestros | **Supuesto propio**, no está en el PRD | Bloqueo |

La más difícil fue **RC2/RC3 en `sol-003`**: el correo es de un líder (Comercial) que sí aprueba… pero de otro centro. Hay que bloquear por RC2 (no es aprobador de CC-2020) y además explicar que 74 M superan incluso el mayor tope de CC-2020 (30 M), para que la acción sugerida sea "escalar", no "pedir al líder correcto". El segundo desafío fue leer la cotización de texto libre sin inventar: lo que no se puede leer queda `null` y dispara confirmación en vez de suponerse.

Resultados sobre los fixtures, **derivados de la evidencia, no del número de carpeta**: `sol-001` crea sin intervención; `sol-002` bloquea (RC1); `sol-003` bloquea (RC2, RC3); `sol-004` confirmación RC5 (26,5 M vs 25 M, 6 %); `sol-005` confirmación RC8, retroactiva; `sol-006` confirmación RC6 con IVA C1 y pago Z030 derivados.

## 6. Diseño del adaptador SAP real
**Opción elegida: OData `API_PURCHASEORDER_PROCESS_SRV` (o `OP_PURCHASEORDER_0001` V4 según versión) detrás de SAP Integration Suite / API Management**, con BAPI `BAPI_PO_CREATE1` vía un iFlow o SAP Cloud Connector como alternativa si el sistema es ECC on-premise sin OData. Es una ruta condicionada: OData y BAPI no son intercambiables y la interfaz disponible depende del sistema y versión. Como la viabilidad no está confirmada, la primera tarea es un *spike* de 1–2 días para ver qué expone el Basis.

- **Mapeo** (`OrdenCompra` → `A_PurchaseOrder` / `A_PurchaseOrderItem`): `sociedad`→`CompanyCode`; `organizacion_compras`→`PurchasingOrganization`; `proveedor.codigo_sap`→`Supplier`; `moneda`→`DocumentCurrency`; `condiciones_pago`→`PaymentTerms`; cada posición → item (`PurchaseOrderItem`=10,20…, `PurchaseOrderItemText`≤40, `OrderQuantity`+unidad, `NetPriceAmount`, `TaxCode`=indicador IVA) con imputación a `CostCenter`. **Ojo**: el payload entrega el precio *con IVA incluido* (como la cotización); SAP espera precio neto y calcula el impuesto con el código. El adaptador debe convertir con `totales.base` y el indicador, y conciliar el total del documento contra `totales.total`. La subárea no tiene campo estándar: iría a una orden interna/clase de actividad o a un campo Z.
- **Autenticación**: usuario técnico dedicado con rol mínimo de creación de OC (no la cuenta de una persona), OAuth2 client-credentials o certificado mutuo contra API Management. Credenciales en Secret Manager, inyectadas al adaptador por variable de entorno; **nunca** en el agente ni en el prompt.
- **Idempotencia y errores**: la referencia `solicitud_id` viaja en un campo de referencia del encabezado (`YY1_ReferenciaSolicitud` o `PurchaseOrderByCustomer`). Antes de crear se consulta `buscarOrdenPorReferencia`. **Un timeout no significa que no se creó**: tras un corte se consulta por referencia y solo se reintenta si no existe. Se distinguen errores de negocio (no se reintentan; se devuelven al humano) de transitorios (reintento limitado con backoff). Un error parcial (cabecera creada, posiciones fallidas) se trata como "resultado desconocido": se reconcilia por referencia, se registra y se escala; nunca se reintenta a ciegas.
- **Operación**: cola/outbox con auditoría si el volumen lo exige; correlación por `solicitud_id` + `sessionId`; alertas sobre `CREADA` sin número y sobre reconciliaciones pendientes.
- **Plan B si SAP no es accesible**: el agente igual ahorra el 90 % del tiempo generando la OC **lista para pegar** (el payload y la tabla de campos) y un **archivo de carga masiva** (CSV/LSMW/BDC) con la evidencia PDF adjunta, que la analista sube en lote. Los controles y el `control.csv` se mantienen.

## 7. Lectura del proceso (OC retroactivas)
Hoy muchas OC se crean después de que llega la factura: la cotización se salta y la "aprobación" se vuelve un trámite posterior. Esto no prueba fraude, pero sí que el control previo (poder comprar solo con presupuesto y aprobación) no se está ejerciendo, y que Contabilidad paga contra OC que no existían cuando se comprometió el gasto.

El agente **no las bloquea**: las detecta (RC8), exige confirmación humana explícita, no altera ninguna fecha y deja `retroactiva = true` en `control.csv`, con el número de factura y los días de desvío en la excepción. Con eso la dirección puede medir el porcentaje por centro de costo, proveedor y líder. Proponemos: (1) medir 1–2 meses para tener línea base; (2) fijar una política escrita: tolerar con marca por debajo de un umbral y monto, y **exigir aprobación del nivel superior** (no del mismo líder) por encima; (3) para proveedores recurrentes, contratos marco con OC abierta para eliminar la causa estructural; (4) que el solicitante vea el indicador de su área. Quién decide la política (tolerar con marca o rechazar) es una decisión de la dirección, fuera del alcance de la solución.

## 8. Decisiones y trade-offs
1. **La confirmación la concede el servidor, no el modelo.** Alternativa descartada: dejar que el modelo decida cuándo `confirmado=true` (más simple, pero un modelo equivocado o manipulado por un documento podría crear OC con excepciones). Costo: el servidor interpreta mensajes afirmativos con una heurística (regex); se mitiga con botones del front que envían un texto inequívoco y con que las preguntas nunca cuentan como confirmación.
2. **Las herramientas ignoran `paquete`, `derivados` y `payload` del modelo y recalculan desde los archivos.** Alternativa descartada: confiar en lo que el modelo reenvía (ahorra lecturas, pero el modelo "arreglaría" un monto). Cumple el contrato de firmas del PRD (los campos existen y son opcionales) sin la superficie de ataque.
3. **Sin base de datos: estado en archivos (`out/`) y sesiones en memoria.** Alternativa descartada: Firestore (la base educativa lo traía). El PRD no lo pide y añade identidades, permisos y fallos posibles. Costo: al reiniciar el contenedor se pierde `out/`; por eso `--max-instances 1` y la limitación está documentada.
4. **Un solo agente con herramientas finas, sin RAG.** Los maestros son pequeños y se consultan por clave exacta (NIT, centro); un buscador semántico añadiría error donde se necesita igualdad.
5. **`precio_unitario` con IVA incluido + `precio_incluye_iva` y `totales`.** Alternativa descartada: dividir el precio para entregarlo neto (introduce redondeos que no cuadran con la cotización). Se deja explícito y el adaptador real convierte (ver 6).

## 9. Supuestos
- Los maestros de los fixtures son completos; en producción se consultan a SAP.
- Los topes están en COP; una solicitud en USD se bloquea (RC3) por falta de tasa de cambio.
- El tope se compara contra el **valor total con IVA** de la solicitud.
- "Aprobado" debe aparecer sin negación previa en el cuerpo; la fecha de aprobación se compara por su fecha local escrita.
- Una solicitud sin NIT se identifica por nombre normalizado; si el NIT existe pero no está en el maestro, no se intenta por nombre (podría ser otra empresa).
- La OC tiene una sola posición (10), porque la solicitud trae una sola línea.
- La unidad se infiere del texto de la cotización ("hora"→`H`, "mensual"→`MES`, si no `UN`).
- Sociedad y organización de compras `1000` (PRD 7.4).
- El correo de aprobación es evidencia suficiente; Auditoría podría exigir firma digital.

## 10. Cobertura
| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer el paquete (`oc_leer_paquete`) | Hecho | Lectura real de `.xlsx`/`.pdf`/`.eml` (hoy llegan normalizados). |
| HU-2 Validar (`oc_validar`) | Hecho (RC1–RC10 + RC11) | Maestros en vivo desde SAP. |
| HU-3 Payload + trazabilidad | Hecho (`out/<caso>/trazabilidad.json`) | Mapeo real a OData/BAPI (sección 6). |
| HU-4 Evidencia | Hecho: `.txt` con sha256 **y** `.pdf` (P1) | Firma digital si Auditoría la exige. |
| HU-5 Crear en SAP simulado | Hecho: secuencia desde 4500000001, idempotencia, `control.csv` | Idempotencia durable y adaptador real. |
| HU-6 Errores | Hecho: `{ok:false,error}` legible, sin excepciones | Catálogo de errores del ERP. |
| `oc_leer_excel` (P1 opcional) | Hecho: lee la primera hoja de un `.xlsx` dentro de `fixtures/` u `out/` (rutas y tamaño acotados); probado con un `.xlsx` generado | Mapear columnas reales de la plantilla de solicitud y leer `.pdf`/`.eml`. |
| Registro de solicitudes nuevas desde la UI | Hecho: subir/arrastrar la carpeta de la solicitud (`POST /api/solicitudes/carpeta`) o formulario (`POST /api/solicitudes`), ambos con zod las guarda en `out/solicitudes` con el formato normalizado y pasan por los mismos controles | Ingesta directa desde el buzón de correo. |
| Preguntas sobre el documento y el proceso | Hecho: `oc_consultar_conocimiento` busca en `docs/PRD.md` y en el conocimiento del proceso y el agente cita la sección | Búsqueda semántica si crece la base documental. |
| Pestaña «Análisis» (5 herramientas) | Hecho | Persistir históricos más allá de `out/` y filtros por periodo. |
| Despliegue automático por push | Hecho (Actions + WIF); requiere ejecutar `infra/cicd.sh` una vez | Entornos separados (staging/producción) y aprobación manual del paso a producción. |
| Chat con herramientas y confirmación visibles | Hecho (SSE, tarjetas, banner) | Autenticación de usuarios. |
| `demo.ts` sin modelo | Hecho (6 casos, idempotencia, confirmación `sol-004`) | — |
| Bonus módulo reutilizable | Hecho (`modulo/`, generado de las mismas fuentes y verificado en pruebas) | — |
| URL pública | Desplegada en Cloud Run con `instalar.sh` (frontend público, backend privado por IAM) | Dominio propio y autenticación de usuarios. |
| Probado contra Gemini real | Parcial: el instalador llama a Vertex AI y hace un chat real al desplegar; las pruebas automáticas usan respuestas simuladas | Evaluación de calidad del agente con un conjunto de conversaciones. |

## 11. Uso de IA
Construí la solución con **Claude Code** (Anthropic): lectura del PRD y la guía de estudio, diseño de la arquitectura, escritura del código, pruebas y documentación; yo revisé y debo poder explicar cada línea. Se usó además la **guía de estudio** del repositorio base (educativa, no oficial) como referencia de arquitectura (puertos/adaptadores, barrera de creación, snapshot/huella).
Qué se descartó de lo propuesto/heredado: el modelo de datos en centavos y los topes por líder único de la base educativa (no coinciden con los maestros reales), Firestore y el control de operador con cookie firmada (no los pide el PRD y añadían superficie), y el estado de "aprobación humana por botón" desligado de lo mostrado (se reemplazó por la huella de contenido). En runtime, el agente usa Gemini 2.5 Flash.

## 12. Riesgos de llevar esto a producción
| Riesgo | Mitigación |
|---|---|
| Creación sin autoridad: "confirmo" no prueba quién es la persona | SSO corporativo; registrar el actor autenticado en `confirmado_por`; confirmación solo por roles autorizados (hoy `ACTOR` es fijo). |
| Heurística de lenguaje para interpretar "confirmo" | Confirmación por acción de UI firmada (botón con token) además del texto. |
| Prompt injection en cotizaciones/correos | Los documentos se tratan como datos; la barrera está en el código (revalidación + huella), no en el prompt. |
| Pérdida de estado (sesiones y `out/` en memoria/disco efímero) | Persistencia en base de datos transaccional y almacenamiento de objetos; cola con outbox. |
| Resultado desconocido tras timeout de SAP | Consulta por referencia antes de reintentar (sección 6). |
| Duplicados por concurrencia | Cerrojo por `solicitud_id` en el adaptador real o restricción única en SAP/BD. |
| Costo descontrolado | Topes por turno y sesión (ya), cuotas y alertas en el proyecto, límite por IP en el front. |
| Datos personales en logs | `out/log.jsonl` guarda argumentos y resultados: definir retención y enmascarar en producción. |
| Dependencia de un proveedor LLM | Interfaz `LlmAdapter`; modo degradado sin modelo (herramientas + UI de formulario). |
| Interpretación errónea de cotización de texto libre | Lo no legible es `null` y pide confirmación; en producción, extracción estructurada con validación cruzada contra la solicitud. |
