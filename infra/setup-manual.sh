#!/usr/bin/env bash
# Cloud Shell: prepara la infraestructura del despliegue manual (APIs, identidades, secreto de Gemini).
set -euo pipefail
: "${PROJECT_ID:?Exporta PROJECT_ID con tu proyecto real}"
: "${REGION:?Exporta REGION, por ejemplo us-central1}"
command -v gcloud >/dev/null
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com --project "$PROJECT_ID"

ACCOUNTS=$(gcloud iam service-accounts list --project "$PROJECT_ID" --format='value(email)')
for name in periferia-backend periferia-frontend periferia-builder; do
  if ! printf '%s\n' "$ACCOUNTS" | grep -Fxq "$name@$PROJECT_ID.iam.gserviceaccount.com"; then
    gcloud iam service-accounts create "$name" --project "$PROJECT_ID"
  fi
done
BUILDER="serviceAccount:periferia-builder@$PROJECT_ID.iam.gserviceaccount.com"
for role in roles/run.builder roles/logging.logWriter roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$BUILDER" --role="$role" --quiet >/dev/null
done

SECRETS=$(gcloud secrets list --project "$PROJECT_ID" --format='value(name)')
if ! printf '%s\n' "$SECRETS" | grep -Eq '(^|/)gemini-api-key$'; then
  gcloud secrets create gemini-api-key --replication-policy=automatic --project "$PROJECT_ID"
fi
gcloud secrets add-iam-policy-binding gemini-api-key --project "$PROJECT_ID" \
  --member="serviceAccount:periferia-backend@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor --quiet >/dev/null

# GEMINI_KEY_FILE: archivo con la clave (lo crea migrar.sh sin dejar la clave en el historial).
if [ -n "${GEMINI_KEY_FILE:-}" ]; then
  test -f "$GEMINI_KEY_FILE"
  gcloud secrets versions add gemini-api-key --project "$PROJECT_ID" --data-file="$GEMINI_KEY_FILE"
fi
VERSIONS=$(gcloud secrets versions list gemini-api-key --project "$PROJECT_ID" --filter='state=ENABLED' --limit=1 --format='value(name)')
if [ -z "$VERSIONS" ]; then
  echo 'Falta una version del secreto gemini-api-key. Agregala (ver INSTRUCTIVO_CLOUD_RUN.md) y vuelve a ejecutar.' >&2
  exit 1
fi
printf '\nInfraestructura lista. Siguiente: bash infra/deploy-manual.sh\n'
