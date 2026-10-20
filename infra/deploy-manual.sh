#!/usr/bin/env bash
# Cloud Shell: despliega backend (privado, IAM) y frontend (publico) en Cloud Run, en ese orden.
set -euo pipefail
: "${PROJECT_ID:?Exporta PROJECT_ID real}"
: "${REGION:?Exporta REGION elegida}"
BACKEND_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
FRONTEND_DIR=${FRONTEND_DIR:-"$BACKEND_DIR/../periferia_reto_frontend"}
BACKEND_SERVICE=${BACKEND_SERVICE:-periferia-backend}
FRONTEND_SERVICE=${FRONTEND_SERVICE:-periferia-frontend}
GEMINI_MODEL=${GEMINI_MODEL:-gemini-2.5-flash}
test -f "$FRONTEND_DIR/Dockerfile" || { echo 'Configura FRONTEND_DIR con la carpeta del frontend.' >&2; exit 1; }
BUILDER="projects/$PROJECT_ID/serviceAccounts/periferia-builder@$PROJECT_ID.iam.gserviceaccount.com"
BACKEND_SA="periferia-backend@$PROJECT_ID.iam.gserviceaccount.com"
FRONTEND_SA="periferia-frontend@$PROJECT_ID.iam.gserviceaccount.com"

# Backend: las sesiones viven en memoria y el SAP simulado escribe en out/, por eso una sola instancia.
gcloud run deploy "$BACKEND_SERVICE" --project "$PROJECT_ID" --region "$REGION" --source "$BACKEND_DIR" \
  --build-service-account "$BUILDER" --service-account "$BACKEND_SA" \
  --port 8080 --memory 512Mi --cpu 1 --min-instances 0 --max-instances 1 --concurrency 8 --timeout 120 \
  --no-allow-unauthenticated \
  --set-env-vars "AGENT_MODE=llm,GEMINI_MODEL=$GEMINI_MODEL" \
  --set-secrets 'GEMINI_API_KEY=gemini-api-key:latest' --quiet
BACKEND_URL=$(gcloud run services describe "$BACKEND_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')
gcloud run services add-iam-policy-binding "$BACKEND_SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --member="serviceAccount:$FRONTEND_SA" --role=roles/run.invoker --quiet >/dev/null

gcloud run deploy "$FRONTEND_SERVICE" --project "$PROJECT_ID" --region "$REGION" --source "$FRONTEND_DIR" \
  --build-service-account "$BUILDER" --service-account "$FRONTEND_SA" \
  --port 8080 --memory 256Mi --cpu 1 --min-instances 0 --max-instances 2 --concurrency 20 --timeout 120 \
  --allow-unauthenticated \
  --set-env-vars "BACKEND_URL=$BACKEND_URL,BACKEND_AUTH=iam" --quiet
FRONTEND_URL=$(gcloud run services describe "$FRONTEND_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')

curl --fail --silent --show-error --retry 3 --retry-delay 3 "$FRONTEND_URL/health"; echo
curl --fail --silent --show-error --retry 3 --retry-delay 3 "$FRONTEND_URL/api/backend-health"; echo
printf '\nURL para la defensa (frontend): %s\nBackend privado por IAM: %s\n' "$FRONTEND_URL" "$BACKEND_URL"
