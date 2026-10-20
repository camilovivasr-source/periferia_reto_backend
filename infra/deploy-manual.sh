#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT_ID:?Exporta PROJECT_ID real}"
: "${REGION:?Exporta REGION elegida}"
BACKEND_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
FRONTEND_DIR=${FRONTEND_DIR:-"$BACKEND_DIR/../periferia_reto_frontend"}
BACKEND_SERVICE=${BACKEND_SERVICE:-periferia-backend}
FRONTEND_SERVICE=${FRONTEND_SERVICE:-periferia-frontend}
OPERATOR_ID=${OPERATOR_ID:-lider-1}
export OPERATOR_ID
export REVIEWER_POLICIES_JSON=${REVIEWER_POLICIES_JSON:-'[]'}
test -f "$FRONTEND_DIR/Dockerfile" || { echo 'Configura FRONTEND_DIR con la carpeta frontend.' >&2;exit 1; }
BUILDER="projects/$PROJECT_ID/serviceAccounts/periferia-builder@$PROJECT_ID.iam.gserviceaccount.com"
RUNTIME_ENV_DIR=$(mktemp -d)
trap 'rm -rf "$RUNTIME_ENV_DIR"' EXIT
export RUNTIME_ENV_DIR
python3 - <<'PY'
import json,os
from pathlib import Path
policies=json.loads(os.environ['REVIEWER_POLICIES_JSON'])
if not isinstance(policies,list):raise ValueError('REVIEWER_POLICIES_JSON debe ser arreglo')
r=Path(os.environ['RUNTIME_ENV_DIR'])
(r/'backend.json').write_text(json.dumps({'AGENT_MODE':'llm','GEMINI_MODEL':os.environ.get('GEMINI_MODEL','gemini-2.5-flash'),'STATE_STORE':'firestore','HUMAN_AUTH_MODE':'signed','REVIEWER_POLICIES_JSON':json.dumps(policies,separators=(',',':'))}))
PY
gcloud run deploy "$BACKEND_SERVICE" --project "$PROJECT_ID" --region "$REGION" --source "$BACKEND_DIR" --build-service-account "$BUILDER" --service-account "periferia-backend@$PROJECT_ID.iam.gserviceaccount.com" --port 8080 --memory 512Mi --cpu 1 --min-instances 0 --max-instances 2 --concurrency 4 --timeout 120 --no-allow-unauthenticated --env-vars-file "$RUNTIME_ENV_DIR/backend.json" --set-secrets 'GEMINI_API_KEY=gemini-api-key:latest,OPERATOR_SIGNING_KEY=operator-signing-key:latest' --quiet
BACKEND_URL=$(gcloud run services describe "$BACKEND_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')
export BACKEND_URL
gcloud run services add-iam-policy-binding "$BACKEND_SERVICE" --project "$PROJECT_ID" --region "$REGION" --member="serviceAccount:periferia-frontend@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/run.invoker --quiet
python3 - <<'PY'
import json,os
from pathlib import Path
(Path(os.environ['RUNTIME_ENV_DIR'])/'frontend.json').write_text(json.dumps({'BACKEND_URL':os.environ['BACKEND_URL'],'BACKEND_AUTH':'iam','OPERATOR_ID':os.environ['OPERATOR_ID']}))
PY
gcloud run deploy "$FRONTEND_SERVICE" --project "$PROJECT_ID" --region "$REGION" --source "$FRONTEND_DIR" --build-service-account "$BUILDER" --service-account "periferia-frontend@$PROJECT_ID.iam.gserviceaccount.com" --port 8080 --memory 256Mi --cpu 1 --min-instances 0 --max-instances 2 --concurrency 8 --timeout 120 --allow-unauthenticated --env-vars-file "$RUNTIME_ENV_DIR/frontend.json" --set-secrets 'OPERATOR_SIGNING_KEY=operator-signing-key:latest,OPERATOR_ACCESS_CODE=operator-access-code:latest' --quiet
FRONTEND_URL=$(gcloud run services describe "$FRONTEND_SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')
curl --fail --retry 3 --retry-delay 2 "$FRONTEND_URL/health"
curl --fail --retry 3 --retry-delay 2 "$FRONTEND_URL/api/backend-health"
printf '\nFrontend: %s\nBackend privado por IAM: %s\n' "$FRONTEND_URL" "$BACKEND_URL"
