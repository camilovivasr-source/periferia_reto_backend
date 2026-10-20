# Despliegue en Cloud Run (URL pública del reto)

Un solo script, en Cloud Shell. El LLM es **Gemini por Vertex AI** con la identidad del backend (sin clave de API).

```bash
git clone -b claude/blissful-mendel-88agwr https://github.com/camilovivasr-source/periferia_reto_backend.git
PROJECT_ID=tu-proyecto bash periferia_reto_backend/instalar.sh
```
Repos privados: primero `gh auth login` (o deja las carpetas `periferia_reto_backend` y `periferia_reto_frontend` juntas y usa `FRONTEND_DIR`).

Qué hace (idempotente; si falla, arreglas la causa y lo repites): comprueba cuenta/proyecto/facturación → activa APIs (incluye `aiplatform`) → crea cuentas de servicio (`backend` con `roles/aiplatform.user`) → prueba que el modelo responde en Vertex → despliega backend (privado por IAM, 1 instancia) y frontend (público) → verifica de punta a punta con un chat real y muestra la URL.

**Despliegue automático (paso 8 del instalador)**: crea la cuenta `periferia-deployer`, una federación de identidad de GitHub → Google Cloud (sin claves JSON, restringida a estos dos repos y a las ramas `main` y `claude/blissful-mendel-88agwr`) y guarda las variables `GCP_PROJECT_ID`, `GCP_REGION`, `WIF_PROVIDER` y `DEPLOYER_SA` en ambos repos (necesita `gh auth login` con permiso de administrador; si no, imprime los valores para ponerlos en Settings → Variables → Actions). Desde entonces **cada push** corre las pruebas y redespliega ese servicio; el resultado se ve en la pestaña *Actions* de GitHub. Si cambias el nombre de la rama de trabajo: `RAMAS_DESPLIEGUE="main otra-rama" bash infra/cicd.sh`.

Variables: `PROJECT_ID`, `REGION`, `VERTEX_LOCATION` (us-central1), `GEMINI_MODEL` (gemini-2.5-flash), `RAMA`, `FRONTEND_DIR`, `BILLING_ACCOUNT`, `SOLO_INFRA=true`.

| Servicio | Acceso | Configuración |
|---|---|---|
| `periferia-backend` | Privado; solo la cuenta del frontend tiene `run.invoker` | `AGENT_MODE=vertex`, `GEMINI_MODEL`, `VERTEX_LOCATION`, `GOOGLE_CLOUD_PROJECT`. `--max-instances 1`: sesiones en memoria y SAP simulado en archivos. |
| `periferia-frontend` | Público | `BACKEND_URL`, `BACKEND_AUTH=iam`. |

Problemas frecuentes: *403 de Vertex* → la API tarda 1-2 min o falta `roles/aiplatform.user`; *502 en el frontend* → `BACKEND_URL`/`run.invoker`; *allUsers bloqueado* → política de la organización.
Local con Vertex: `gcloud auth application-default login` y `AGENT_MODE=vertex GOOGLE_CLOUD_PROJECT=… npm run dev`.
