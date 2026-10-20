#!/usr/bin/env bash
# Migracion rapida a Cloud Shell: clona backend+frontend, prepara GCP y despliega en Cloud Run.
# Uso (Cloud Shell):
#   git clone https://github.com/camilovivasr-source/periferia_reto_backend.git
#   bash periferia_reto_backend/infra/migrar.sh
# Variables opcionales: PROJECT_ID REGION GEMINI_API_KEY BRANCH GITHUB_OWNER
set -euo pipefail
GITHUB_OWNER=${GITHUB_OWNER:-camilovivasr-source}
BRANCH=${BRANCH:-main}
SELF=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
if [ -d "$SELF/periferia_reto_backend" ] && [ -d "$SELF/periferia_reto_frontend" ]; then LOCAL=1; WORK="$SELF"; else LOCAL=0; WORK=${WORK:-"$HOME/reto03"}; fi
command -v gcloud >/dev/null || { echo 'Ejecuta esto en Cloud Shell (falta gcloud).' >&2; exit 1; }

# Autenticacion: Cloud Shell ya trae sesion; si no hay cuenta activa, se hace login por codigo.
if [ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ]; then
  gcloud auth login --no-launch-browser
fi
gcloud auth application-default print-access-token >/dev/null 2>&1 || gcloud auth application-default login --no-launch-browser
echo ">> Cuenta: $(gcloud auth list --filter=status:ACTIVE --format='value(account)')"

PROJECT_ID=${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}
if [ -z "$PROJECT_ID" ]; then read -rp 'PROJECT_ID de GCP: ' PROJECT_ID; fi
REGION=${REGION:-us-central1}
export PROJECT_ID REGION
gcloud config set project "$PROJECT_ID" >/dev/null
echo ">> Proyecto: $PROJECT_ID  Region: $REGION"

clonar() { # repo
  local dir="$WORK/$1"
  if [ -d "$dir/.git" ]; then git -C "$dir" fetch -q origin && git -C "$dir" checkout -q "$BRANCH" 2>/dev/null || true; git -C "$dir" pull -q --ff-only origin "$BRANCH" || true
  else mkdir -p "$WORK"; git clone -q -b "$BRANCH" "https://github.com/$GITHUB_OWNER/$1.git" "$dir" || git clone -q "https://github.com/$GITHUB_OWNER/$1.git" "$dir"; fi
}
if [ "$LOCAL" = 0 ]; then echo '>> Clonando repositorios'; clonar periferia_reto_backend; clonar periferia_reto_frontend; fi
cd "$WORK/periferia_reto_backend"

# Clave Gemini: solo se pide si el secreto aun no tiene version. Nunca se imprime ni queda en el historial.
KEYFILE=''
trap '[ -n "$KEYFILE" ] && rm -f "$KEYFILE"' EXIT
HAS_KEY=$(gcloud secrets versions list gemini-api-key --project "$PROJECT_ID" --filter='state=ENABLED' --limit=1 --format='value(name)' 2>/dev/null || true)
if [ -z "$HAS_KEY" ]; then
  if [ -z "${GEMINI_API_KEY:-}" ]; then read -rsp 'Clave Gemini (oculta): ' GEMINI_API_KEY; echo; fi
  KEYFILE=$(mktemp); chmod 600 "$KEYFILE"; printf '%s' "$GEMINI_API_KEY" > "$KEYFILE"
  unset GEMINI_API_KEY
  export GEMINI_KEY_FILE="$KEYFILE"
fi

echo '>> Infraestructura (APIs, identidades, Firestore, secretos)'
bash infra/setup-manual.sh
echo '>> Desplegando backend y frontend'
FRONTEND_DIR="$WORK/periferia_reto_frontend" bash infra/deploy-manual.sh
echo '>> Listo. Abre la URL del Frontend impresa arriba.'
