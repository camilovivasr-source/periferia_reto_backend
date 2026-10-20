# Solución de preparación - adaptar al PRD

## Arquitectura
Dos repos independientes y dos servicios Cloud Run. Frontend público con proxy autenticado mediante identidad de servicio al backend privado por IAM. Backend TypeScript/Zod y Gemini2.5Flash nativo con function calling. Dominio no conoce HTTP/disco/LLM. Bootstrap conecta puertos y adaptadores. Documentos detallados: ARQUITECTURA.md y CLOUD_RUN_GITHUB.md.

## Agente
Gemini interpreta, pide herramienta, backend valida argumentos y ejecuta, resultado vuelve al modelo. Se conservan parts y firmas opacas requeridas por protocolo entre rondas; no se muestran pensamientos al usuario. Límite de pasos/timeout. No hay sesión entre mensajes. Demo sin modelo usa las mismas herramientas.

## Controles
Proveedor, centro/pago, IVA/total, coincidencia documental, tope/aprobación y retroactividad separados en domain/controls. Reglas educativas: completar con PRD. Confirmar es acción HTTP fuera del catálogo LLM. IAM identifica servicio frontend; actor humano sigue simulado por DEMO_APPROVER.

## Estado
Local memory; Cloud Run Firestore. Aprobaciones persistidas y ligadas a snapshot. OC simulada con transacción por ID y snapshot: repetición devuelve la misma OC; cambio relevante produce error. La protección transaccional es del simulador, no de un ERP externo.

## SAP real y retroactivas
Implementar SapPort contra contrato real SAP, con autenticación aprobada, correlación, errores tipados y reconciliación de resultado desconocido antes de reintentar. OData y BAPI son interfaces distintas. Una factura previa es señal a analizar según eventos del PRD; conservar originales, exigir autoridad de excepción y no alterar fechas. Flujo de excepción/superior pendiente.

## CI/CD y operación
GitHub Actions por repo: pruebas y build, WIF a cuenta de despliegue, Docker en Artifact Registry y Cloud Run. Backend usa secreto Gemini de Secret Manager y ADC para Firestore. Ver guía de configuración y limitaciones. Todavía no se han ejecutado recursos cloud, proveedor Gemini real ni workflows remotos.

## Evolución de UI y decisiones
Dashboard dividido y eventos SSE reales. UI consulta estado definitivo y no interpreta decisiones desde el texto del modelo. Sesión de revisor con cookie y aserción firmada al backend; código de operador de laboratorio, no SSO. Justificación obligatoria, políticas de autoridad explícitas, rechazo persistente y guardia de decisión contra creación concurrente. Firestore guarda acciones; su auditoría posterior no es outbox atómica y debe conciliarse si falla tras commit. Instructivo manual en INSTRUCTIVO_CLOUD_RUN.md.
