#!/usr/bin/env bash
# Despliega el backend en Cloud Run (privado por IAM, Gemini por Vertex AI). Lo usan instalar.sh y GitHub Actions,
# para que "instalar" y "push" desplieguen exactamente lo mismo.
#   Requiere: PROJECT_ID.  Opcionales: REGION VERTEX_LOCATION GEMINI_MODEL BACKEND_SERVICE USE_COMPUTE_BUILDER=1
set -euo pipefail
: "${PROJECT_ID:?Falta PROJECT_ID}"
REGION="${REGION:-us-central1}"
VERTEX_LOCATION="${VERTEX_LOCATION:-us-central1}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"
SERVICE="${BACKEND_SERVICE:-periferia-backend}"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

BUILD=()
if [ "${USE_COMPUTE_BUILDER:-0}" != "1" ]; then
  BUILD=(--build-service-account="projects/${PROJECT_ID}/serviceAccounts/periferia-builder@${PROJECT_ID}.iam.gserviceaccount.com")
fi

# Una sola instancia: las sesiones viven en memoria y el SAP simulado escribe en out/.
gcloud run deploy "$SERVICE" --source=. --project="$PROJECT_ID" --region="$REGION" "${BUILD[@]}" \
  --service-account="periferia-backend@${PROJECT_ID}.iam.gserviceaccount.com" \
  --port=8080 --memory=512Mi --cpu=1 --min-instances=0 --max-instances=1 --concurrency=8 --timeout=120 \
  --no-allow-unauthenticated \
  --set-env-vars="AGENT_MODE=vertex,GEMINI_MODEL=${GEMINI_MODEL},VERTEX_LOCATION=${VERTEX_LOCATION},GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --quiet
