# Reto 3 · Agente de órdenes de compra SAP — Backend

Agente conversacional en TypeScript (Node 20+) que lee el paquete de una solicitud, valida controles RC1–RC10 contra los maestros, construye la OC, genera la evidencia de aprobación y la crea en un SAP simulado, con confirmación humana para las excepciones. Frontend en el repo `periferia_reto_frontend`.

Documentación: [SOLUCION.md](SOLUCION.md) (arquitectura, ciclo del agente, controles, SAP real, retroactivas) · [INSTRUCTIVO_CLOUD_RUN.md](INSTRUCTIVO_CLOUD_RUN.md) (URL pública) · [docs/PRD.md](docs/PRD.md).

## Arranque local (un comando para probar sin modelo)

```bash
npm ci
npm run demo      # los 6 casos sin LLM, idempotencia y confirmación de sol-004
npm test          # pruebas
npm run dev       # API en http://localhost:8080 (sin GEMINI_API_KEY: modo práctica)
```

Con modelo por Vertex AI: `gcloud auth application-default login` y `AGENT_MODE=vertex GOOGLE_CLOUD_PROJECT=tu-proyecto npm run dev` (sin claves). Alternativa AI Studio: `AGENT_MODE=gemini GEMINI_API_KEY=… npm run dev`; la clave solo vive en el entorno del servidor.

Chat completo en local: backend en `:8080` y, en el repo del frontend, `npm ci && npm start` (abre http://localhost:3000, `BACKEND_AUTH=none`).

## Variables de entorno

| Variable | Defecto | Uso |
|---|---|---|
| `PORT` | `8080` | Puerto HTTP. |
| `AGENT_MODE` | `auto` | `vertex` (Gemini por Vertex AI con ADC, sin clave; es el de Cloud Run), `gemini` (AI Studio, exige `GEMINI_API_KEY`), `practice` (comandos sin LLM). `auto`: vertex si `GEMINI_VERTEX=1`, gemini si hay clave, si no práctica. |
| `GOOGLE_CLOUD_PROJECT`, `VERTEX_LOCATION` | — / `us-central1` | Proyecto y región de Vertex AI. |
| `GEMINI_API_KEY` | — | Solo para `AGENT_MODE=gemini`. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Modelo. |
| `MAX_ITERACIONES` | `25` | Tope de llamadas modelo↔herramientas por turno. |
| `MAX_TOKENS_SESION` | `300000` | Tope de tokens por sesión. |
| `LLM_TIMEOUT_MS` | `45000` | Timeout al proveedor. |
| `FIXTURES_DIR` / `OUT_DIR` | `fixtures/reto-03` / `out` | Insumos (solo lectura) y salidas (`sap/ordenes.jsonl`, `control.csv`, `log.jsonl`, `<caso>/…`). |

## API

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId, message }` → `{ reply, toolCalls[], needsConfirmation, pendientes[] }`. Con `Accept: text/event-stream` emite `tool_start`, `tool_end` y `complete`. |
| `GET` | `/api/sessions/:id` | Historial de la sesión. |
| `GET` | `/api/health` | `{ ok, proveedor, modelo, modo }`, sin claves. |
| `GET` | `/api/casos` | Casos disponibles. |

## Estructura (capas, de afuera hacia adentro)

```
agent/prompt.md              comportamiento del agente (system prompt)
src/knowledge/*.md           conocimiento del proceso (se agrega al prompt; skill del módulo)
src/server.ts                arranque HTTP            src/bootstrap.ts   composición (elige el LLM)
src/http/                    rutas, SSE, descargas    src/config.ts      variables de entorno
src/agent/                   ciclo del agente: loop, sesiones, confirmacion, sugerencias, modo práctica
src/llm/                     LlmAdapter + Gemini (Vertex AI / AI Studio)
src/tools/oc.ts              herramientas oc_* (contrato + zod); registry.ts las publica al modelo
src/application/             casos de uso: ordenes (leer/validar/construir/evidencia/crear), consultas
src/domain/validate.ts       compone los controles   src/domain/controls/   RC1-RC11, una regla por función
src/domain/{payload,evidence,parse,util}.ts          OC, evidencia sha256/PDF, lectura de cotización
src/schemas.ts               contratos zod (fixtures, paquete, OrdenCompra)
src/data.ts                  lectura de maestros y paquetes (errores de datos tipados)
src/sap/                     SapAdapter + mock sobre archivos
src/out.ts                   control.csv y log.jsonl
demo.ts  tests/  modulo/     verificación sin modelo, pruebas, agente empaquetado (bonus)
fixtures/reto-03/            insumos (no modificar)       docs/   PRD y guía de estudio
```

Regla de dependencias: `http → agent → tools → application → domain → schemas`; el dominio no conoce HTTP, LLM ni archivos de salida.

`npm run modulo` regenera `modulo/` a partir de las mismas fuentes (una prueba falla si quedan desactualizadas).
