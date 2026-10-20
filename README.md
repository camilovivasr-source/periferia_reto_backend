# Reto 3 · Agente de órdenes de compra SAP — Backend

Agente conversacional en TypeScript (Node 20+) que lee el paquete de una solicitud, valida los controles RC1–RC10 contra los maestros, construye la OC, genera la evidencia de aprobación y la crea en un SAP simulado. Lo dudoso lo devuelve a la persona con una recomendación y exige su confirmación explícita.
El frontend vive en el repo `periferia_reto_frontend`.

**Link de prueba:** <https://periferia-frontend-310237603993.us-central1.run.app/> (público, sin clave de acceso). Pestaña **Asistente** (chat) y pestaña **Análisis**.

Documentación: [SOLUCION.md](SOLUCION.md) (diseño, controles, SAP real, retroactivas) · [INSTRUCTIVO_CLOUD_RUN.md](INSTRUCTIVO_CLOUD_RUN.md) (despliegue) · [docs/PRD.md](docs/PRD.md).

## Contenido

1. [Arranque rápido y variables](#1-arranque-rápido-local) · 2. [Arquitectura](#2-arquitectura) · 3. [Ciclo del agente](#3-ciclo-del-agente-y-confirmación-humana) · 4. [Herramientas](#4-herramientas) · 5. [API](#5-api) · 6. [Cumplimiento del PRD](#6-cumplimiento-del-prd) · 7. [Valor agregado](#7-valor-agregado-más-allá-del-prd) · 8. [Instalador](#8-instalador-para-cloud-shell-instalarsh--la-migración-de-un-comando) · 9. [Bonus módulo](#9-bonus-módulo-reutilizable) · 10. [Pruebas](#10-pruebas-y-calidad) · 11. [Estructura](#11-estructura-del-repositorio)

---

## 1. Arranque rápido local

```bash
npm ci
npm run demo      # los 6 casos sin LLM, idempotencia y confirmación de sol-004
npm test          # pruebas
npm run dev       # API en http://localhost:8080 (sin clave de modelo: modo práctica)
npm run dev:all   # backend + frontend (si está en ../periferia_reto_frontend) -> http://localhost:3000
docker compose up --build   # igual, con Docker (espera el frontend en ../periferia_reto_frontend)
```

Con modelo real por Vertex AI (sin claves): `gcloud auth application-default login` y `AGENT_MODE=vertex GOOGLE_CLOUD_PROJECT=tu-proyecto npm run dev`.
Alternativa AI Studio: `AGENT_MODE=gemini GEMINI_API_KEY=… npm run dev`; la clave solo vive en el entorno del servidor.
Sin credenciales el servidor arranca en **modo práctica** (comandos deterministas sobre las mismas herramientas), etiquetado como tal en la UI; no reemplaza al agente LLM.

### Variables de entorno

| Variable | Defecto | Uso |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP. |
| `AGENT_MODE` | `auto` | `vertex` (Gemini por Vertex AI con credenciales por defecto, sin clave; es el de Cloud Run), `gemini` (AI Studio, exige `GEMINI_API_KEY`), `practice` (comandos sin LLM). `auto`: vertex si `GEMINI_VERTEX=1`, gemini si hay clave, si no práctica. |
| `GOOGLE_CLOUD_PROJECT` | — | Proyecto de Vertex AI. |
| `VERTEX_LOCATION` | `us-central1` | Región de Vertex AI. |
| `GEMINI_API_KEY` | — | Solo para `AGENT_MODE=gemini`. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modelo. |
| `MAX_ITERACIONES` | `25` | Tope de vueltas modelo↔herramientas por turno (CA1). |
| `MAX_TOKENS_SESION` | `300000` | Tope de tokens por sesión. |
| `LLM_TIMEOUT_MS` | `45000` | Timeout al proveedor. |
| `MINUTOS_MANUALES_POR_OC` | `12` | Supuesto para el ahorro estimado del panel de análisis. |
| `FIXTURES_DIR` | `fixtures/reto-03` | Insumos y maestros (solo lectura). |
| `OUT_DIR` | `out` | Salidas: `sap/ordenes.jsonl`, `control.csv`, `log.jsonl`, `<caso>/…`. |
| `SOLICITUDES_DIR` | `out/solicitudes` | Carpeta de solicitudes **nuevas** registradas desde la UI. Nunca se escribe en `fixtures/`. |
| `ACTOR` | `analista-administrativa` | Actor que se registra en `confirmado_por`. |

`.env.example` lista las variables sin valores sensibles.

---

## 2. Arquitectura

```
 Navegador
    │  HTTP / SSE
    ▼
 Frontend  (Cloud Run, PÚBLICO)   proxy mínimo, CSP, límites; reenvía con ID token IAM
    │  HTTPS + identidad de servicio
    ▼
 Backend   (Cloud Run, PRIVADO)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ http/  rutas, SSE, descargas                                         │
 │   │                                                                  │
 │   ▼                                                                  │
 │ agent/  loop ──▶ LLM adapter ──▶ Gemini (Vertex AI / AI Studio)      │
 │   │                                                                  │
 │   ▼   (llamadas a herramientas, validadas con zod)                   │
 │ tools/  oc_*  ──▶ application/ ──▶ domain/ (controls RC1–RC11)       │
 │                                  └──▶ sap/ (SapAdapter → mock)       │
 └───────────────────────────┬──────────────────────┬───────────────────┘
                             │                      │
                   fixtures/ (lectura)        out/ (escritura)
```

### Capas

| Capa | Carpeta | Responsabilidad |
|---|---|---|
| HTTP | `src/http/`, `src/server.ts` | Rutas, SSE, descargas, validación de cuerpo. Sin lógica de negocio. |
| Agente | `src/agent/` | Ciclo del agente (`loop.ts`), sesiones, huella de confirmación, sugerencias, modo práctica, carga del prompt. |
| LLM | `src/llm/` | `LlmAdapter.enviar(mensajes, herramientas)` + implementación Gemini (Vertex / AI Studio). |
| Herramientas | `src/tools/` | Contratos `oc_*` con zod (`oc.ts`), registro y ejecución segura (`registry.ts`), resúmenes. |
| Aplicación | `src/application/` | Casos de uso: órdenes, consultas, Excel y `analisis/` (panel, desvío, conciliación, simulador, autoridad, exportación). |
| Dominio | `src/domain/` | Controles RC1–RC11 (una regla por función en `controls/`), `validate.ts`, payload, evidencia (sha256/PDF), lectura de cotización. |
| Contratos | `src/schemas.ts` | Esquemas zod de fixtures, paquete y `OrdenCompra`. |
| Infra de datos | `src/data.ts`, `src/sap/`, `src/out.ts` | Lectura de maestros y paquetes, `SapAdapter` + mock sobre archivos, `control.csv` y `log.jsonl`. |

**Regla de dependencias:** `http → agent → tools → application → domain → schemas`. El dominio no conoce HTTP, LLM ni archivos de salida; un cambio de reglas de negocio toca `src/domain/controls/*`, nunca el servidor.

### Comportamiento, conocimiento y ejecución

| Eje | Dónde vive | Detalle |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Rol, flujo, tono y reglas de conversación. Se cambia sin tocar código. |
| **Conocimiento** | `src/knowledge/ordenes-compra.md` y `docs/PRD.md` | El primero se agrega al system prompt (y el módulo lo publica como skill). El PRD y el conocimiento del proceso se pueden consultar bajo demanda con `oc_consultar_conocimiento`. |
| **Ejecución** | `src/tools/` → `src/application/` → `src/domain/` | Sin HTTP ni LLM: el chat, `demo.ts` y las pruebas llaman lo mismo. Las herramientas son la única fuente de valores que el agente puede afirmar. |

---

## 3. Ciclo del agente y confirmación humana

`Agente.turno(sessionId, mensaje)` en `src/agent/loop.ts`:

1. Si la sesión superó `MAX_TOKENS_SESION`, responde con el límite.
2. **La persona responde, no el modelo:** antes de llamar al modelo, el servidor interpreta el mensaje; si había una confirmación pendiente y el mensaje es afirmativo (y no una pregunta), concede la confirmación para esa huella. Un "no" la descarta.
3. Bucle `modelo → herramientas → modelo` con tope `MAX_ITERACIONES`. Cada llamada valida argumentos con zod (si fallan, el error vuelve al modelo), se ejecuta, se resume y se escribe en `out/log.jsonl`; `tool_start`/`tool_end` salen por SSE.
4. Termina cuando el modelo responde sin llamadas. Si hay confirmaciones pendientes, la respuesta trae `needsConfirmation: true`.
5. Errores del proveedor (timeout, 429, 403…) se muestran en lenguaje claro; la sesión sigue viva.

**Confirmación humana (server-side).** `oc_crear` solo crea con excepciones si `confirmado = true` **y** el servidor tiene una concesión vigente para la *huella* actual (hash del payload + confirmaciones). La concesión nace de un mensaje del usuario, nunca del modelo; se consume al crear y dura un turno. Si los datos cambian entre validar y confirmar, la huella cambia y se vuelve a pedir. Detalle y alternativas en [SOLUCION.md](SOLUCION.md) §3 y §8.

---

## 4. Herramientas

El nombre que ve el modelo es `oc_<export>` (exports de `src/tools/oc.ts`). Todas devuelven `{ ok: true, data }` o `{ ok: false, error }` y nunca lanzan.

| Herramienta | Qué hace |
|---|---|
| `oc_leer_paquete` | Lee y normaliza el paquete de una solicitud (correo, solicitud, cotización, aprobación, factura); lo ausente va en `faltantes`. |
| `oc_validar` | Aplica los controles contra los maestros: `apta`, `bloqueos`, `confirmaciones`, `derivados`, `retroactiva`. |
| `oc_construir_payload` | Construye la `OrdenCompra` como quedaría en SAP y guarda la trazabilidad de cada valor. Solo para solicitudes sin bloqueos. |
| `oc_generar_evidencia` | Genera `aprobacion.txt` y `aprobacion.pdf` con encabezados, cuerpo y sha256 en `out/<caso>/`. |
| `oc_crear` | Crea la OC en el SAP simulado. Revalida siempre; exige confirmación humana si hay excepciones; es idempotente por solicitud. |
| `oc_leer_excel` | Lee un `.xlsx` dentro de `fixtures/` u `out/` (primera fila = encabezado). |
| `oc_listar_casos` | Lista las solicitudes con su estado (apta, requiere confirmación, bloqueada, creada), proveedor, valor y número de OC. |
| `oc_consultar_maestro` | Consulta proveedores, centros de costo (subáreas y aprobadores con tope), indicadores de IVA y condiciones de pago. |
| `oc_resumen_control` | Resume `out/control.csv`: intentos por resultado, OC creadas y porcentaje de retroactivas. |
| `oc_consultar_conocimiento` | Busca en el PRD y en el conocimiento del proceso para responder preguntas sobre el documento, las reglas y sus significados. |

Las herramientas de creación ignoran `paquete`, `derivados` y `payload` que reenvíe el modelo y recalculan desde los archivos.

---

## 5. API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, pendientes[] }`. Con `Accept: text/event-stream` emite `tool_start`, `tool_end` y `complete`. |
| `GET` | `/api/sessions/:id` | Historial de la sesión. |
| `GET` | `/api/health` | `{ ok, proveedor, modelo, modo }`, sin claves. |
| `GET` | `/api/casos` | Casos con su estado según los controles. |
| `GET` | `/api/opciones` | Opciones válidas de los maestros (centros, subáreas, aprobadores, proveedores, IVA, pagos) para el formulario de nueva solicitud. |
| `POST` | `/api/solicitudes` | Registra una **nueva solicitud**. Se guarda en `out/solicitudes` (`SOLICITUDES_DIR`), nunca en `fixtures/`. |
| `GET` | `/api/analisis/{panel,desvio,conciliacion,autoridad,caso/:caso}` · `POST /api/analisis/simular` | Pestaña Análisis (solo lectura; la simulación es en memoria). |
| `GET` | `/api/exportar/carga-sap.csv` · `/api/control.csv` · `/api/archivos/:caso/{aprobacion.pdf,aprobacion.txt,trazabilidad.json}` | Descargas. |

---

## 6. Cumplimiento del PRD

| Requisito del PRD | Dónde se implementa | Estado |
|---|---|---|
| 6.1 Front de chat (historial, tool calls, resaltar confirmación) | Repo `periferia_reto_frontend` (`public/`) | Hecho |
| 6.1 Backend con tope de iteraciones y sesión | `src/server.ts`, `src/agent/loop.ts`, `src/agent/sesiones.ts` | Hecho |
| 6.1 Herramientas zod, separadas del HTTP | `src/tools/oc.ts`, `src/tools/registry.ts` | Hecho |
| 6.1 Adaptador LLM (interfaz propia) | `src/llm/adapter.ts`, `src/llm/gemini.ts` | Hecho |
| 6.1 System prompt en Markdown aparte | `agent/prompt.md` | Hecho |
| 6.2 Contrato de herramientas (`description`, `args`, `execute`, JSON `ok/error`) | `src/tools/oc.ts`, `src/tools/types.ts` | Hecho |
| CA1 Tope de iteraciones | `MAX_ITERACIONES` en `src/config.ts`, `src/agent/loop.ts` | Hecho |
| CA2 El modelo no afirma valores ajenos a herramientas | `agent/prompt.md`; las herramientas recalculan desde archivos | Hecho |
| CA3 Confirmación humana | `src/agent/confirmacion.ts` (huella + concesión), `oc_crear` | Hecho |
| CA4 Llamadas visibles y en `out/log.jsonl` | `src/agent/loop.ts`, `src/out.ts`, eventos SSE | Hecho |
| CA5 Errores claros, sesión viva | `src/agent/loop.ts`, `src/llm/gemini.ts` | Hecho |
| 6.4 API mínima (`chat`, `sessions`, `health`) | `src/http/rutas.ts` | Hecho |
| 6.6 `demo.ts` sin modelo (6 casos, idempotencia, `sol-004`) | `demo.ts` (`npm run demo`) | Hecho |
| HU-1 Leer el paquete | `oc_leer_paquete`, `src/data.ts`, `src/domain/parse.ts` | Hecho |
| HU-2 Validar contra maestros | `oc_validar`, `src/domain/validate.ts` | Hecho |
| HU-3 Construir el payload | `oc_construir_payload`, `src/domain/payload.ts` | Hecho |
| HU-4 Evidencia (txt + pdf, sha256) | `oc_generar_evidencia`, `src/domain/evidence.ts` | Hecho |
| HU-5 Crear en SAP simulado (idempotente) | `oc_crear`, `src/sap/mock.ts`, `src/application/ordenes.ts` | Hecho |
| HU-6 Manejo de errores | `src/tools/registry.ts`, `src/application/resultado.ts` | Hecho |
| RC1 Proveedor existe y activo | `src/domain/controls/proveedor.ts` | Hecho |
| RC2 Aprobación de un aprobador del centro | `src/domain/controls/autorizacion.ts` | Hecho |
| RC3 Valor ≤ tope del aprobador | `src/domain/controls/autorizacion.ts` | Hecho |
| RC4 Subárea pertenece al centro | `src/domain/controls/imputacion.ts` | Hecho |
| RC5 Cotización ±2 % | `src/domain/controls/documentos.ts` | Hecho |
| RC6 / RC7 IVA y pago derivados | `src/domain/controls/impuestos.ts` | Hecho |
| RC8 Factura anterior a la solicitud (retroactiva) | `src/domain/controls/documentos.ts`, `control.csv` | Hecho |
| RC9 Aprobación anterior a la solicitud | `src/domain/controls/autorizacion.ts` | Hecho |
| RC10 cantidad × unitario = total (±1) | `src/domain/controls/aritmetica.ts` | Hecho |
| 7.4 Payload `OrdenCompra` + `SapAdapter` | `src/schemas.ts`, `src/sap/adapter.ts`, `src/sap/mock.ts` | Hecho |
| 7.5 Diseño del adaptador SAP real | [SOLUCION.md](SOLUCION.md) §6 | Hecho (solo documentación, como pide el PRD) |
| 8 No funcionales (arranque, determinismo, seguridad, costo, robustez, legibilidad, dependencias) | `npm run demo`, `docker-compose.yml`, `src/config.ts`, `tests/` | Hecho; ver sección 10 |
| 9.1 `SOLUCION.md` con la estructura obligatoria | [SOLUCION.md](SOLUCION.md) | Hecho |
| 9.2 `README.md` | Este archivo | Hecho |
| 9.3 Link de prueba | <https://periferia-frontend-310237603993.us-central1.run.app/> | Hecho |
| 9.4 Bonus módulo reutilizable | `modulo/` (sección 9) | Hecho |

Nota: RC11 (códigos de IVA y pago existen en los maestros) es un supuesto propio, no está en el PRD.

---

## 7. Valor agregado (más allá del PRD)

| Aporte | Descripción |
|---|---|
| **Pestaña Análisis** (5 herramientas, solo lectura) | Panel de control (KPIs, bitácora, exportación de carga masiva SAP), desvío de proceso (retroactivas y línea de tiempo), conciliación documental, simulador de controles («¿qué pasaría si…?», solo en memoria) y autoridad de aprobación. Código en `src/application/analisis/` y `/api/analisis/*`. |
| **Registro de nuevas solicitudes desde la UI** | `POST /api/solicitudes` guarda la solicitud en `out/solicitudes` (`SOLICITUDES_DIR`); `fixtures/` queda intacto. |
| **Instalador y despliegue continuo** | `instalar.sh` lleva de cero a la URL pública; cada push posterior corre pruebas y redespliega (GitHub Actions + Workload Identity). Ver sección 8. |

---

## 8. Instalador para Cloud Shell (`instalar.sh`) — la «migración» de un comando

Despliega backend y frontend en Cloud Run desde cero con un solo comando y deja configurado el despliegue automático. Es **idempotente**: si falla, se arregla la causa y se vuelve a correr entero.

> El bonus oficial del PRD (9.4, +10) es la carpeta `modulo/`. El instalador es **valor agregado de operación**, no el bonus.

### Cómo correrlo

```bash
gh auth login                                   # repos privados
gh repo clone camilovivasr-source/periferia_reto_backend -- -b claude/blissful-mendel-88agwr
PROJECT_ID=tu-proyecto bash periferia_reto_backend/instalar.sh
```

Si dejas las carpetas `periferia_reto_backend` y `periferia_reto_frontend` juntas, o usas `FRONTEND_DIR`, no necesita clonar el frontend. Variables opcionales: `REGION`, `VERTEX_LOCATION`, `GEMINI_MODEL`, `RAMA`, `FRONTEND_DIR`, `BILLING_ACCOUNT`, `SOLO_INFRA=true`.

### Qué hace, paso a paso

| Paso | Acción |
|---|---|
| 0 | Comprobaciones previas: herramientas (`gcloud`, `git`, `curl`, `python3`), sesión de gcloud, ubicación del backend; actualiza o clona el frontend. |
| 1 | Proyecto y facturación: valida el proyecto y que tenga facturación (la vincula con `BILLING_ACCOUNT` si se indica). |
| 2 | Activa las APIs necesarias (incluida `aiplatform`). |
| 3 | Crea las cuentas de servicio y permisos; el backend recibe `roles/aiplatform.user`. |
| 4 | Prueba que el modelo responde en Vertex AI antes de desplegar. |
| 5 | Despliega el backend en Cloud Run, **privado** por IAM (1 instancia). |
| 6 | Despliega el frontend en Cloud Run, **público**, con permiso de invocar al backend. |
| 7 | Verificación real de punta a punta con un chat contra el modelo y muestra la URL. |
| 8 | Despliegue automático: ejecuta `infra/cicd.sh` (ver abajo). |

**Vertex AI sin claves de API:** el backend usa la identidad de su cuenta de servicio (credenciales por defecto de la aplicación). No hay clave que guardar ni filtrar.

**Paso 8 · cada push redespliega.** `infra/cicd.sh` crea la cuenta `periferia-deployer`, una federación de identidad GitHub → Google Cloud (**Workload Identity**, sin claves JSON) restringida a los dos repos y a las ramas `main` y `claude/blissful-mendel-88agwr`, y guarda las variables `GCP_PROJECT_ID`, `GCP_REGION`, `WIF_PROVIDER` y `DEPLOYER_SA` en ambos repos. Desde entonces `.github/workflows/deploy.yml` corre las pruebas y redespliega ese servicio en cada push. Si no hay permisos de administrador en GitHub, imprime los valores para ponerlos en *Settings → Variables → Actions*. Otra rama: `RAMAS_DESPLIEGUE="main otra-rama" bash infra/cicd.sh`.

| Servicio | Acceso | Configuración |
|---|---|---|
| `periferia-backend` | Privado; solo la cuenta del frontend tiene `run.invoker` | `AGENT_MODE=vertex`, `GEMINI_MODEL`, `VERTEX_LOCATION`, `GOOGLE_CLOUD_PROJECT`; `--max-instances 1` (sesiones en memoria, SAP simulado en archivos). |
| `periferia-frontend` | Público | `BACKEND_URL`, `BACKEND_AUTH=iam`. |

Más detalle y problemas frecuentes: [INSTRUCTIVO_CLOUD_RUN.md](INSTRUCTIVO_CLOUD_RUN.md).

---

## 9. Bonus módulo reutilizable

`modulo/` empaqueta el agente para otras plataformas, sin depender del servidor (PRD 9.4):

| Pieza | Archivo |
|---|---|
| Agente (frontmatter `description`, `mode: primary`, `permission {edit: deny, bash: deny}` + system prompt) | `modulo/agent.md` |
| Herramientas importables | `modulo/tools/oc.ts` |
| Conocimiento del proceso como skill | `modulo/skill/ordenes-compra/SKILL.md` |

Se genera con `npm run modulo` a partir de las **mismas fuentes** que usa la aplicación (`agent/prompt.md`, `src/knowledge/`, `src/tools/`); `tests/modulo.test.ts` falla si quedan desactualizadas.

---

## 10. Pruebas y calidad

| Aspecto | Detalle |
|---|---|
| `npm test` | Unas 70 pruebas (`node --test` sobre `tests/*.test.ts`): agente, análisis, controles, HTTP, módulo y robustez. |
| `npm run typecheck` | `tsc --noEmit`, TypeScript estricto. |
| Demo determinista | `npm run demo` no usa modelo ni claves; mismo resultado en ejecuciones consecutivas (salvo marcas de tiempo). |
| Legibilidad | Sin `any`; reglas de control como funciones puras cortas. |
| Seguridad | La clave del modelo solo vive en el entorno del backend; las herramientas no ejecutan comandos de shell. |
| Costo | Topes `MAX_ITERACIONES` y `MAX_TOKENS_SESION`; timeout `LLM_TIMEOUT_MS`. |

Límites conocidos (estado en archivos y sesiones en memoria, sin autenticación de usuarios): ver riesgos en [SOLUCION.md](SOLUCION.md) §12.

---

## 11. Estructura del repositorio

```
agent/prompt.md              comportamiento del agente (system prompt)
src/knowledge/*.md           conocimiento del proceso (se agrega al prompt; skill del módulo)
src/server.ts, bootstrap.ts  arranque HTTP y composición (elige el LLM)    src/config.ts   variables de entorno
src/http/                    rutas, SSE, descargas
src/agent/                   loop, sesiones, confirmación, sugerencias, modo práctica
src/llm/                     LlmAdapter + Gemini (Vertex AI / AI Studio)
src/tools/                   oc.ts (contratos + zod), registry.ts, resumen.ts, types.ts
src/application/             casos de uso: ordenes, consultas, excel y analisis/
src/domain/                  validate.ts, controls/ (RC1–RC11), payload, evidence, parse, util
src/schemas.ts, data.ts      contratos zod; lectura de maestros y paquetes
src/sap/                     SapAdapter + mock sobre archivos
src/out.ts                   control.csv y log.jsonl
demo.ts  tests/              verificación sin modelo y pruebas
modulo/                      agente empaquetado (bonus PRD 9.4)
scripts/                     build.mjs, build-modulo.mjs, dev-all.mjs
infra/                       deploy-backend.sh, cicd.sh (Workload Identity)
.github/workflows/           deploy.yml (pruebas + despliegue)
instalar.sh                  instalador para Cloud Shell
fixtures/reto-03/            insumos (no modificar)
docs/                        PRD y guía de estudio
out/                         salidas generadas en ejecución (no se versiona)
```

Frontend de chat y pestaña Análisis: repo `periferia_reto_frontend`.
Documentos: [SOLUCION.md](SOLUCION.md) · [INSTRUCTIVO_CLOUD_RUN.md](INSTRUCTIVO_CLOUD_RUN.md).
