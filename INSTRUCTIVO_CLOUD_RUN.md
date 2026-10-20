# Despliegue en Cloud Run (URL pública del reto)

Dos servicios: **backend** privado (IAM) y **frontend** público que le habla con la identidad de su servicio. Sin GitHub Actions ni WIF.

## Rápido: un solo script en Cloud Shell
```bash
git clone -b claude/blissful-mendel-88agwr https://github.com/camilovivasr-source/periferia_reto_backend.git
export PROJECT_ID='TU_PROYECTO' REGION='us-central1'
bash periferia_reto_backend/infra/migrar.sh
```
Pide la clave de Gemini (oculta) si el secreto aún no tiene versión, crea la infraestructura, despliega ambos servicios e imprime la URL del frontend. Es el flujo de los pasos siguientes, automatizado. Requiere proyecto con facturación y permisos para habilitar APIs y crear identidades.

## Manual, paso a paso
Con `periferia_reto_backend` y `periferia_reto_frontend` en la misma carpeta:
```bash
export PROJECT_ID='TU_PROYECTO' REGION='us-central1'
cd periferia_reto_backend
bash infra/setup-manual.sh      # APIs, identidades, secreto gemini-api-key
```
La primera vez termina avisando que falta la clave. Regístrala sin dejarla en el historial y repite:
```bash
read -rsp 'Clave Gemini: ' K; printf '%s' "$K" | gcloud secrets versions add gemini-api-key --project "$PROJECT_ID" --data-file=-; unset K
bash infra/setup-manual.sh
bash infra/deploy-manual.sh     # backend (privado) -> permiso invoker al frontend -> frontend (público)
```
`deploy-manual.sh` comprueba `/health` y `/api/backend-health` e imprime la URL que se entrega en la defensa.

## Qué hace cada pieza
| Servicio | Acceso | Configuración |
|---|---|---|
| `periferia-backend` | Privado (`--no-allow-unauthenticated`); solo `periferia-frontend` tiene `run.invoker` | `AGENT_MODE=llm`, `GEMINI_MODEL`, secreto `GEMINI_API_KEY`. **`--max-instances 1`**: sesiones en memoria y SAP simulado en archivos. |
| `periferia-frontend` | Público | `BACKEND_URL`, `BACKEND_AUTH=iam` (ID token de su identidad). |

## Comprobaciones antes de la defensa
1. `curl $URL/api/backend-health` → `modo: "LLM"` (si dice `PRACTICA SIN LLM`, falta la clave o el secreto).
2. Abrir la URL desde otra sesión: procesar `sol-001` (se crea), `sol-004` (pide confirmación; "confirmo" la crea), `sol-003` (bloqueada).
3. Reiniciar el contenedor borra `out/` y las sesiones (documentado en SOLUCION.md); `sol-001` vuelve a crearse con el número 4500000001.

## Problemas frecuentes
- *Permisos al construir*: dar a `periferia-builder` los roles que pida el error (el script ya asigna `run.builder`, `logging.logWriter` y `artifactregistry.writer`); la propagación de IAM tarda unos minutos.
- *502 en el frontend*: revisar `BACKEND_URL` y el `run.invoker` del backend.
- *HTTP 429/403 del modelo*: cuota o clave; `npm run check:gemini` localmente.
