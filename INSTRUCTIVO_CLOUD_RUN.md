# Despliegue manual en Cloud Run - Periferia Reto 3

Repositorios previstos: https://github.com/camilovivasr-source/periferia_reto_backend y https://github.com/camilovivasr-source/periferia_reto_frontend.

Este instructivo no necesita GitHub Actions ni WIF para el primer despliegue. Usa Cloud Shell, Dockerfiles y `gcloud run deploy --source`. Los workflows son una opción posterior; CI corre al subir, CD solo si DEPLOY_ENABLED=true y tiene sus variables configuradas.

## 1. Qué está listo

- Gemini 2.5 Flash nativo con function calling; el backend aplica reglas antes de crear.
- Frontend público con dashboard, tarjetas, ruta de controles, herramientas SSE, resumen SAP simulado e historial.
- Backend privado por IAM, frontend obtiene ID token de su identidad de servicio.
- Decisiones humanas con sesión de operador HttpOnly/Secure/SameSite, firma ligada al cuerpo/ruta y justificación obligatoria.
- Tope y autoridad configurables; un botón no concede facultades. No hay excepción habilitada por defecto.
- Rechazo persistente bloquea creación. Reapertura después de rechazo requiere un procedimiento nuevo: no se ofrece un botón que lo omita.
- Firestore para órdenes, decisiones y auditoría. Creación y rechazo comprueban estado en transacciones; la creación compara versión de decisión para evitar una carrera.
- Doctor, typecheck, pruebas, demo sin LLM y prueba HTTP de los dos servicios.

Los insumos siguen siendo ficticios: al recibir PRD y casos oficiales hay que adaptar parsers/controles, sin asumir escenarios por número de carpeta. El modelo Gemini y GCP reales requieren tu cuenta, facturación, cuota, secretos y permisos. Ninguna plantilla puede garantizar esas condiciones externas.

## 2. Preparar el proyecto

En Google Cloud Console selecciona un proyecto con facturación activa. Abre Cloud Shell con un usuario que pueda habilitar APIs, crear identidades y asignar permisos. Si no eres administrador, pide esos permisos al responsable del proyecto.

Clona ambos repositorios en la misma carpeta. Para repos privados, autentica GitHub primero mediante tu método habitual; no incrustes un token en la URL. Si aún no puedes clonarlos, sube el ZIP a Cloud Shell y descomprímelo; conserva las dos carpetas hermanas.

```bash
git clone https://github.com/camilovivasr-source/periferia_reto_backend.git
git clone https://github.com/camilovivasr-source/periferia_reto_frontend.git
cd periferia_reto_backend
export PROJECT_ID='TU_ID_REAL_DE_PROYECTO'
export REGION='us-central1'
```

La región es una elección, no un requisito de Periferia. Si ya existe Firestore, revisa su ubicación y modo. Se requiere Firestore Native en la base por defecto. El script no cambia una base existente de ubicación o modo.

## 3. Crear infraestructura y registrar Gemini

En Cloud Shell, desde backend:

```bash
bash infra/setup-manual.sh
```

La primera ejecución puede terminar indicando que falta una versión de gemini-api-key; es deliberado. Ya habrá creado el contenedor del secreto, identidades, permisos y secretos del operador. Registra la clave sin escribirla en el historial:

```bash
read -rsp 'Clave Gemini: ' GEMINI_INPUT
printf '%s' "$GEMINI_INPUT" | gcloud secrets versions add gemini-api-key --project "$PROJECT_ID" --data-file=-
unset GEMINI_INPUT
bash infra/setup-manual.sh
```

El script genera claves aleatorias para operator-signing-key y operator-access-code solo si no tienen versión habilitada. No imprime sus valores. No modifica datos de Tejido. Crea:

| Identidad | Uso | Permisos asignados |
| --- | --- | --- |
| periferia-builder | Construir desde código fuente | roles/run.builder |
| periferia-backend | API y Gemini | datastore.user, acceso a gemini-api-key y operator-signing-key |
| periferia-frontend | UI y proxy | acceso a operator-signing-key/operator-access-code; run.invoker sobre backend al desplegar |

Cloud Run, Cloud Build, Artifact Registry, Firestore, Secret Manager e IAM se habilitan. La cuenta humana que despliega necesita además permisos de despliegue desde fuente y uso de las identidades; un Owner de proyecto suele disponer de ellos. En proyectos administrados solicita roles/run.sourceDeveloper, roles/serviceusage.serviceUsageConsumer e iam.serviceAccountUser sobre las identidades; la administración inicial necesita permisos adicionales.

Los permisos IAM pueden tardar unos minutos en propagarse. Si aparecen errores inmediatos de permisos tras crearlos, comprueba bindings y vuelve a ejecutar, sin hacer público el backend para ocultar el problema.

## 4. Desplegar en orden

Desde backend y con las variables anteriores:

```bash
bash infra/deploy-manual.sh
```

El script:

1. Verifica la carpeta frontend y crea archivos de entorno temporales sin claves.
2. Construye y despliega backend con su Dockerfile, puerto8080, Gemini real, Firestore, revisión firmada y secretos.
3. Obtiene el origen backend y concede invocación a la cuenta frontend.
4. Construye y despliega frontend público con BACKEND_URL exacta, IAM y los dos secretos de revisión.
5. Comprueba /health del frontend y /api/backend-health mediante proxy.
6. Imprime las URLs; los temporales se eliminan.

Si las carpetas se llaman reto-03-backend/reto-03-frontend por provenir del ZIP, antes del script:

```bash
export FRONTEND_DIR="$(cd ../reto-03-frontend && pwd)"
```

Por defecto los servicios se llaman periferia-backend y periferia-frontend. Puedes establecer BACKEND_SERVICE y FRONTEND_SERVICE para otro nombre antes del script. No cambies el puerto a mano: ambos Dockerfiles usan PORT y Cloud Run suministra8080.

## 5. Probar desde el navegador

Abre la URL frontend impresa. La app debe indicar Gemini y el modelo. Selecciona una solicitud, valida y observa eventos reales en el inspector. Prueba proveedor inactivo, IVA inconsistente y aprobación pendiente. Una orden creada muestra su OC y etiqueta de simulador, nunca una BAPI ficticia.

Para acceder como revisor recupera el código en tu Cloud Shell:

```bash
gcloud secrets versions access latest --secret=operator-access-code --project "$PROJECT_ID"
```

Ese comando muestra un secreto en TU terminal para que lo uses en el formulario. No lo pegues en commits, capturas públicas o esta conversación. La sesión dura30min. El operador inicial es lider-1; sus facultades derivan del centro de costo de los ejemplos. El código es una autenticación de operador para el laboratorio, no SSO corporativo ni verificación de identidad personal.

Aprobar/rechazar exige motivo de10 a2000 caracteres y snapshot vigente. Rechazar impide la creación; no es solo un mensaje de chat. Una OC ya creada no admite cambio de decisión por esta UI.

## 6. Autoridad superior y retroactividad

No existe un botón universal de aprobar excepciones. Por defecto, lider-1 no puede aprobar los ejemplos que exceden su tope ni retroactivas.

Para ensayar un supervisor, configura explícitamente antes de desplegar (valores educativos, adaptar al PRD):

```bash
export OPERATOR_ID='supervisor'
export REVIEWER_POLICIES_JSON='[{"id":"supervisor","centros":["CC-01"],"topeCentavos":500000000,"puedeRetroactiva":true}]'
bash infra/deploy-manual.sh
```

500000000 centavos representan5.000.000COP. Este JSON es configuración administrativa, no puede enviarse desde un mensaje ni desde la UI. La autoridad debe corresponder al PRD/evidencia real. Al modificar operador, la sesión anterior deja de ser válida en el frontend.

## 7. Verificación final

- Frontend /health:200.
- Frontend /api/backend-health:200, mode=LLM, stateStore=firestore, humanAuth=signed.
- Backend directo sin token:401/403 es correcto, porque es privado por IAM.
- Validación y tool calling reales con Gemini. Salud no prueba que tu clave tenga cuota o acceso a2.5Flash.
- Misma solicitud no duplica OC; decisiones y registros siguen después de reiniciar una instancia.
- Aprobar con actor insuficiente, justificación vacía, contenido cambiado o firma inválida se bloquea.
- Código de revisión y clave Gemini solo están en Secret Manager y servidor.

Para comprobar la credencial Gemini aparte, en un entorno local con .env configurado: `npm run check:gemini`. Hace una llamada mínima real y puede consumir cuota. No imprime la clave.

## 8. Si prefieres usar la consola gráfica

En Cloud Run, crea servicio desde código fuente/contendor y selecciona el repositorio correspondiente. Usa el Dockerfile en la raíz, puerto8080 y cuenta runtime de la tabla. Para backend, exige autenticación y configura variables/secretos iguales al script. Para frontend, permite acceso público, configura origen backend e IAM, y sus secretos. La cuenta de construcción requiere run.builder; la runtime NO debe ser la de construcción. Configurar un trigger de Cloud Build y GitHub Actions al mismo tiempo puede duplicar despliegues: elige una ruta.

La ruta Cloud Shell de este documento es la reproducible, porque deja explícitos todos los valores. Si una política de organización prohíbe servicios públicos o modelos externos, debes resolverlo con tu administrador: la aplicación no puede omitir esas políticas.


### Variables exactas si configuras en consola

Backend (variables normales): AGENT_MODE=llm, GEMINI_MODEL=gemini-2.5-flash, STATE_STORE=firestore, HUMAN_AUTH_MODE=signed, REVIEWER_POLICIES_JSON=[] y opcional FIRESTORE_DATABASE=(default). Backend (referencias a secretos): GEMINI_API_KEY -> gemini-api-key:latest; OPERATOR_SIGNING_KEY -> operator-signing-key:latest.

Frontend (variables normales): BACKEND_AUTH=iam, BACKEND_URL=origen HTTPS real del backend, OPERATOR_ID=lider-1. Frontend (referencias a secretos): OPERATOR_SIGNING_KEY -> operator-signing-key:latest; OPERATOR_ACCESS_CODE -> operator-access-code:latest.

En ambos: puerto8080, Dockerfile en la raíz y comando de inicio por defecto del contenedor (no reemplazar por npm run dev). Builder: periferia-builder. Runtime backend: periferia-backend. Runtime frontend: periferia-frontend. La cuenta humana también necesita poder usar la identidad builder si ejecuta source deploy con cuenta personalizada.

## 9. Solución de errores frecuentes

| Síntoma | Qué comprobar |
| --- | --- |
| GitHub404 al conectar | Instalación GitHub de ChatGPT/Cloud Build autorizada para estos repos privados. |
| Fallo de build npm ci | Lockfile subido, Dockerfile raíz y contexto correcto. No copiar node_modules local. |
| Contenedor no escucha PORT | Ver logs; variables/secretos requeridos pueden causar fallo temprano deliberado. Arranque npm start y puerto8080. |
| Secret version not found | Agregar versión habilitada; no basta con crear el contenedor de secreto. |
| Secret permission denied | Runtime correcta y secretAccessor sobre el secreto correcto; esperar propagación IAM. |
| Frontend502 | BACKEND_URL exacta sin ruta, run.invoker para la identidad frontend y backend saludable. |
| Revisiones humanas403 | Iniciar sesión; mismas versiones de signing-key en ambos; cookies HTTPS; actor configurado. |
| Actor sin autoridad | Revisar centro/tope/políticas; no aumentar permisos solo para pasar un caso. |
| Gemini403/404/429 | Ver clave, acceso al modelo y cuota; el nombre del modelo es configurable. |
| Firestore permission denied | datastore.user del runtime backend y base Native. |
| Datos no válidos/faltantes | Archivos oficiales y schemas/parser; no atribuirlo a fallo del LLM. |
| Streaming no se ve | Usar frontend de esta versión; proxy reenvía chunks SSE sin buffer. |
| CI verde pero no despliega | DEPLOY_ENABLED no es true o faltan variables WIF; para manual no las necesitas. |

## Alcance de las comprobaciones

Código, tests, contrato de streaming y comunicación entre procesos se prueban localmente. No se ha ejecutado un despliegue en tu proyecto, porque no se han proporcionado acceso GCP, ID de proyecto ni clave Gemini. Las pruebas del proveedor y de Firestore usan dobles; no equivalen a una llamada real. No se promete ausencia absoluta de fallos ante permisos, cuotas o políticas externas.

## Fuentes oficiales

- https://cloud.google.com/run/docs/deploying-source-code
- https://cloud.google.com/sdk/gcloud/reference/run/deploy
- https://cloud.google.com/run/docs/authenticating/service-to-service
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash
