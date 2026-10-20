#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PERIFERIA RETO 3 · INSTALADOR para Cloud Shell: de cero a la URL pública.
# El LLM va por Vertex AI con la identidad de la cuenta de servicio del backend
# (como ST_GEMINI_VERTEX=1 en «tutor»): no hay clave de API que guardar.
#
#   git clone -b claude/blissful-mendel-88agwr https://github.com/camilovivasr-source/periferia_reto_backend.git
#   PROJECT_ID=mi-proyecto bash periferia_reto_backend/instalar.sh
#
# Idempotente: si algo falla, se arregla la causa y se vuelve a correr entero.
# Variables opcionales: PROJECT_ID REGION(us-central1) VERTEX_LOCATION(us-central1)
#   GEMINI_MODEL(gemini-2.5-flash) RAMA FRONTEND_DIR BILLING_ACCOUNT SOLO_INFRA=true
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
case "$PROJECT_ID" in "(unset)") PROJECT_ID="" ;; esac
[ -n "$PROJECT_ID" ] || { echo "Falta PROJECT_ID:  PROJECT_ID=mi-proyecto bash instalar.sh" >&2; exit 1; }
REGION="${REGION:-us-central1}"
VERTEX_LOCATION="${VERTEX_LOCATION:-us-central1}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"
RAMA="${RAMA:-$(git -C "$AQUI" branch --show-current 2>/dev/null)}"; RAMA="${RAMA:-main}"
OWNER="$(git -C "$AQUI" remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com[:/]([^/]+)/.*#\1#p')"; OWNER="${OWNER:-camilovivasr-source}"
DIR_FRONT="${FRONTEND_DIR:-$(dirname "$AQUI")/periferia_reto_frontend}"
SVC_BACK="periferia-backend"; SVC_FRONT="periferia-frontend"
SA_BACK="periferia-backend@${PROJECT_ID}.iam.gserviceaccount.com"
SA_FRONT="periferia-frontend@${PROJECT_ID}.iam.gserviceaccount.com"
SA_BUILD="periferia-builder@${PROJECT_ID}.iam.gserviceaccount.com"
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT
FASE=""; AVISOS=()

azul()  { printf '\n\033[1;36m━━ %s\033[0m\n' "$1"; FASE="$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
inf()   { printf '  \033[36m·\033[0m %s\n' "$1"; }
avisa() { printf '  \033[33m!\033[0m %s\n' "$1"; AVISOS+=("[$FASE] $1"); }
muere() { printf '\n  \033[31m✗ %s\033[0m\n' "$1" >&2
          [ -n "${2:-}" ] && printf '     → %s\n' "$2" >&2
          if [ -s "$LOG" ]; then printf '\n  Detalle de gcloud (últimas líneas):\n' >&2; tail -n 12 "$LOG" | sed 's/^/     | /' >&2; fi
          printf '\n  Se detuvo en: %s. Arregla eso y vuelve a correr este mismo script.\n\n' "$FASE" >&2; exit 1; }
# Ejecuta un comando guardando su salida para mostrarla si falla.
corre() { : > "$LOG"; "$@" >"$LOG" 2>&1; }

azul "0 · Comprobaciones previas"
for c in gcloud git curl python3; do command -v "$c" >/dev/null 2>&1 || muere "falta «$c»" "en Cloud Shell ya viene"; done
CUENTA="$(gcloud config get-value account 2>/dev/null)"
[ -n "$CUENTA" ] && [ "$CUENTA" != "(unset)" ] || muere "no hay sesión de gcloud" "ejecuta: gcloud auth login"
ok "cuenta: $CUENTA"
[ -f "$AQUI/Dockerfile" ] || muere "no encuentro el backend en $AQUI" "corre: bash periferia_reto_backend/instalar.sh"
ok "backend: $AQUI (${RAMA}, $(git -C "$AQUI" rev-parse --short HEAD 2>/dev/null))"
if [ -d "$DIR_FRONT/.git" ]; then
  git -C "$DIR_FRONT" fetch -q origin "$RAMA" 2>/dev/null && git -C "$DIR_FRONT" checkout -q "$RAMA" 2>/dev/null && git -C "$DIR_FRONT" pull -q --ff-only origin "$RAMA" 2>/dev/null \
    && ok "frontend al día (${RAMA})" || avisa "no se pudo actualizar el frontend; se usa lo que hay en $DIR_FRONT"
elif [ -f "$DIR_FRONT/Dockerfile" ]; then ok "frontend en $DIR_FRONT"
elif git clone -q -b "$RAMA" "https://github.com/${OWNER}/periferia_reto_frontend.git" "$DIR_FRONT" 2>"$LOG" \
  || { command -v gh >/dev/null 2>&1 && gh repo clone "${OWNER}/periferia_reto_frontend" "$DIR_FRONT" -- -q -b "$RAMA" 2>"$LOG"; }; then ok "frontend clonado (${RAMA})"
else muere "no se pudo clonar el frontend (${RAMA})" "repo privado: usa gh auth login, o pon la carpeta en $DIR_FRONT (FRONTEND_DIR=…)"; fi
[ -f "$DIR_FRONT/Dockerfile" ] || muere "el frontend en $DIR_FRONT no tiene Dockerfile"

azul "1 · Proyecto y facturación"
corre gcloud projects describe "$PROJECT_ID" || muere "no puedo leer el proyecto ${PROJECT_ID}" "revisa el id y que ${CUENTA} tenga acceso"
ok "proyecto ${PROJECT_ID}"
gcloud config set project "$PROJECT_ID" >/dev/null 2>&1
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null)"
if [ "$(gcloud beta billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null)" = "True" ]; then ok "facturación activa"
elif [ -n "${BILLING_ACCOUNT:-}" ]; then
  corre gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT" || muere "no se pudo vincular la facturación"
  ok "facturación vinculada"
else muere "el proyecto no tiene facturación" "BILLING_ACCOUNT=xxx bash instalar.sh  (gcloud beta billing accounts list)"; fi

azul "2 · APIs"
APIS=(run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iam.googleapis.com
      cloudresourcemanager.googleapis.com serviceusage.googleapis.com logging.googleapis.com aiplatform.googleapis.com)
ACTIVAS="$(gcloud services list --enabled --project="$PROJECT_ID" --format='value(config.name)' 2>/dev/null)"
for api in "${APIS[@]}"; do
  if grep -qx "$api" <<<"$ACTIVAS"; then continue; fi
  inf "activando $api"
  corre gcloud services enable "$api" --project="$PROJECT_ID" \
    || muere "no se pudo activar $api" "necesitas rol Owner o Service Usage Admin; o actívala en la consola: APIs y servicios"
done
ok "${#APIS[@]} APIs activas (incluye Vertex AI)"

azul "3 · Cuentas de servicio y permisos"
for id in periferia-backend periferia-frontend periferia-builder; do
  if gcloud iam service-accounts describe "${id}@${PROJECT_ID}.iam.gserviceaccount.com" --project="$PROJECT_ID" >/dev/null 2>&1; then ok "$id ya existe"
  else corre gcloud iam service-accounts create "$id" --project="$PROJECT_ID" || muere "no se pudo crear $id" "¿eres Owner / IAM Admin?"; ok "$id creada"; sleep 8; fi
done
dar_rol() { local i; for i in 1 2 3 4; do corre gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$1" --role="$2" --condition=None --quiet && return 0; sleep 8; done
            avisa "no se pudo dar $2 a $1"; return 1; }
dar_rol "serviceAccount:${SA_BUILD}" roles/run.builder
dar_rol "serviceAccount:${SA_BUILD}" roles/logging.logWriter
dar_rol "serviceAccount:${SA_BUILD}" roles/artifactregistry.writer
dar_rol "serviceAccount:${SA_BUILD}" roles/storage.objectViewer
dar_rol "serviceAccount:${SA_BACK}"  roles/aiplatform.user     # llamar a Gemini en Vertex AI
dar_rol "serviceAccount:${SA_BACK}"  roles/logging.logWriter
dar_rol "serviceAccount:${SA_FRONT}" roles/logging.logWriter
ok "permisos: backend → Vertex AI · compilación → run.builder"

azul "4 · Vertex AI (¿responde ${GEMINI_MODEL} en ${VERTEX_LOCATION}?)"
TOKEN="$(gcloud auth print-access-token 2>/dev/null)"
if [ -n "$TOKEN" ]; then
  HOST="${VERTEX_LOCATION}-aiplatform.googleapis.com"; [ "$VERTEX_LOCATION" = "global" ] && HOST="aiplatform.googleapis.com"
  CODIGO="$(curl -s -o "$LOG" -w '%{http_code}' --max-time 40 -X POST \
    -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
    "https://${HOST}/v1/projects/${PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/${GEMINI_MODEL}:generateContent" \
    -d '{"contents":[{"role":"user","parts":[{"text":"Responde solo OK"}]}]}' 2>/dev/null || echo 000)"
  case "$CODIGO" in
    200) ok "Vertex AI responde con ${GEMINI_MODEL}" ;;
    403|401) avisa "Vertex AI rechazó a ${CUENTA} (HTTP ${CODIGO}); la API puede tardar 1-2 min en propagarse: se sigue" ;;
    404) muere "el modelo ${GEMINI_MODEL} no existe en ${VERTEX_LOCATION}" "prueba GEMINI_MODEL=gemini-2.0-flash o VERTEX_LOCATION=global" ;;
    429) avisa "Vertex AI respondió 429 (cuota): se sigue" ;;
    000) avisa "no se pudo contactar a Vertex AI desde aquí: no se comprobó" ;;
    *) avisa "Vertex AI respondió HTTP ${CODIGO}: $(head -c 200 "$LOG")" ;;
  esac
fi
unset TOKEN
[ "${SOLO_INFRA:-false}" = "true" ] && { azul "Fin (SOLO_INFRA=true)"; ok "infraestructura lista"; exit 0; }

BUILD_FLAG=(--build-service-account="projects/${PROJECT_ID}/serviceAccounts/${SA_BUILD}")
despliega() { # despliega <servicio> <carpeta> <flags…>
  local s="$1" d="$2"; shift 2
  : > "$LOG"
  gcloud run deploy "$s" --source="$d" --region="$REGION" --project="$PROJECT_ID" "${BUILD_FLAG[@]}" --port=8080 --quiet "$@" >"$LOG" 2>&1 && return 0
  if [ ${#BUILD_FLAG[@]} -gt 0 ]; then
    avisa "la compilación con ${SA_BUILD} falló; se reintenta con la cuenta de Compute"
    dar_rol "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" roles/run.builder
    BUILD_FLAG=(); sleep 15
    : > "$LOG"; gcloud run deploy "$s" --source="$d" --region="$REGION" --project="$PROJECT_ID" --port=8080 --quiet "$@" >"$LOG" 2>&1 && return 0
  fi
  return 1
}

azul "5 · Backend (${SVC_BACK}, privado por IAM)"
inf "compilando y desplegando (3 a 6 min)…"
despliega "$SVC_BACK" "$AQUI" --service-account="$SA_BACK" --memory=512Mi --cpu=1 --min-instances=0 --max-instances=1 \
  --concurrency=8 --timeout=120 --no-allow-unauthenticated \
  --set-env-vars="AGENT_MODE=vertex,GEMINI_MODEL=${GEMINI_MODEL},VERTEX_LOCATION=${VERTEX_LOCATION},GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  || muere "falló el despliegue del backend" "mira el detalle; suele ser permisos de compilación o un error de build"
URL_BACK="$(gcloud run services describe "$SVC_BACK" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)' 2>/dev/null)"
[ -n "$URL_BACK" ] || muere "no se pudo leer la URL del backend"
ok "backend desplegado: ${URL_BACK}"
corre gcloud run services add-iam-policy-binding "$SVC_BACK" --region="$REGION" --project="$PROJECT_ID" \
  --member="serviceAccount:${SA_FRONT}" --role=roles/run.invoker --quiet || muere "no se pudo dar run.invoker al frontend"
ok "solo el frontend puede invocar al backend"

azul "6 · Frontend (${SVC_FRONT}, público)"
inf "compilando y desplegando (2 a 4 min)…"
despliega "$SVC_FRONT" "$DIR_FRONT" --service-account="$SA_FRONT" --memory=256Mi --cpu=1 --min-instances=0 --max-instances=2 \
  --concurrency=20 --timeout=120 --allow-unauthenticated --set-env-vars="BACKEND_URL=${URL_BACK},BACKEND_AUTH=iam" \
  || muere "falló el despliegue del frontend" "si dice FAILED_PRECONDITION / allUsers, la organización bloquea servicios públicos: pide una excepción a un admin"
URL_FRONT="$(gcloud run services describe "$SVC_FRONT" --region="$REGION" --project="$PROJECT_ID" --format='value(status.url)' 2>/dev/null)"
ok "frontend desplegado: ${URL_FRONT}"

azul "7 · Verificación real de punta a punta"
espera() { local i=0 c; while [ "$i" -lt "$2" ]; do c="$(curl -s -o "$LOG" -w '%{http_code}' --max-time 30 "$1" 2>/dev/null || echo 000)"; [ "$c" = 200 ] && return 0; i=$((i+1)); sleep 6; done; return 1; }
espera "${URL_FRONT}/health" 8 && ok "frontend responde" || muere "el frontend no responde en ${URL_FRONT}/health"
espera "${URL_FRONT}/api/backend-health" 8 || muere "el frontend no logra hablar con el backend" "revisa run.invoker y BACKEND_URL; ver 'gcloud run services logs read ${SVC_FRONT} --region ${REGION}'"
SALUD="$(cat "$LOG")"
case "$SALUD" in *'"modo":"LLM"'*) ok "backend en modo LLM (${GEMINI_MODEL} vía Vertex AI)" ;; *) avisa "el backend no está en modo LLM: ${SALUD}" ;; esac
SID="instalador$(date +%s)"
CODIGO="$(curl -s -o "$LOG" -w '%{http_code}' --max-time 110 -X POST "${URL_FRONT}/api/chat" -H 'Content-Type: application/json' \
          -d "{\"sessionId\":\"${SID}\",\"message\":\"Procesa la solicitud sol-002 y dime si se puede crear.\"}" 2>/dev/null || echo 000)"
if [ "$CODIGO" = 200 ] && grep -q '"oc_validar"' "$LOG" && grep -q 'RC1' "$LOG"; then ok "el agente respondió con Vertex AI: llamó a las herramientas y bloqueó sol-002 por RC1"
elif [ "$CODIGO" = 200 ]; then avisa "el chat respondió pero no usó las herramientas como se esperaba: $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("reply","")[:240])' "$LOG" 2>/dev/null)"
else avisa "el chat devolvió HTTP ${CODIGO}: $(head -c 300 "$LOG")"; fi

printf '\n\033[1;32m━━ LISTO\033[0m\n  URL para la defensa:  \033[1m%s\033[0m\n  Backend (privado):    %s\n' "$URL_FRONT" "$URL_BACK"
[ ${#AVISOS[@]} -gt 0 ] && { printf '\n  Avisos:\n'; printf '   - %s\n' "${AVISOS[@]}"; }
printf '\n'
