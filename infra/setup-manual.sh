#!/usr/bin/env bash
# Cloud Shell: prepara solo infraestructura del despliegue manual. Sin GitHub/WIF.
set -euo pipefail
: "${PROJECT_ID:?Exporta PROJECT_ID con tu proyecto real}"
: "${REGION:?Exporta REGION, por ejemplo us-central1}"
command -v gcloud >/dev/null
command -v openssl >/dev/null
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com secretmanager.googleapis.com iam.googleapis.com --project "$PROJECT_ID"
ACCOUNTS=$(gcloud iam service-accounts list --project "$PROJECT_ID" --format='value(email)')
for name in periferia-backend periferia-frontend periferia-builder; do
 if ! printf '%s\n' "$ACCOUNTS" | grep -Fxq "$name@$PROJECT_ID.iam.gserviceaccount.com"; then gcloud iam service-accounts create "$name" --project "$PROJECT_ID"; fi
done
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:periferia-builder@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/run.builder --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:periferia-backend@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/datastore.user --quiet
DATABASES=$(gcloud firestore databases list --project "$PROJECT_ID" --format='value(name)')
if ! printf '%s\n' "$DATABASES" | grep -Fq '/databases/(default)'; then gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native --project "$PROJECT_ID"; fi
DBTYPE=$(gcloud firestore databases describe --database='(default)' --project "$PROJECT_ID" --format='value(type)')
if [ "$DBTYPE" != 'FIRESTORE_NATIVE' ]; then echo 'La base por defecto debe ser Firestore Native. Revisa el proyecto antes de continuar.' >&2;exit 1;fi
SECRETS=$(gcloud secrets list --project "$PROJECT_ID" --format='value(name)')
for secret in gemini-api-key operator-signing-key operator-access-code; do
 if ! printf '%s\n' "$SECRETS" | grep -Eq "(^|/)$secret$"; then gcloud secrets create "$secret" --replication-policy=automatic --project "$PROJECT_ID"; fi
 if [ "$secret" != 'gemini-api-key' ]; then
  VERSIONS=$(gcloud secrets versions list "$secret" --project "$PROJECT_ID" --filter='state=ENABLED' --limit=1 --format='value(name)')
  if [ -z "$VERSIONS" ]; then openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add "$secret" --project "$PROJECT_ID" --data-file=-;fi
 fi
done
for secret in gemini-api-key operator-signing-key; do gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT_ID" --member="serviceAccount:periferia-backend@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor --quiet;done
for secret in operator-signing-key operator-access-code; do gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT_ID" --member="serviceAccount:periferia-frontend@$PROJECT_ID.iam.gserviceaccount.com" --role=roles/secretmanager.secretAccessor --quiet;done
if [ -n "${GEMINI_KEY_FILE:-}" ]; then test -f "$GEMINI_KEY_FILE";gcloud secrets versions add gemini-api-key --project "$PROJECT_ID" --data-file="$GEMINI_KEY_FILE";fi
VERSIONS=$(gcloud secrets versions list gemini-api-key --project "$PROJECT_ID" --filter='state=ENABLED' --limit=1 --format='value(name)')
if [ -z "$VERSIONS" ]; then echo 'Falta una version del secreto gemini-api-key. Agregala antes de deploy-manual.sh.' >&2;exit 1;fi
printf '\nInfraestructura preparada. Ejecuta bash infra/deploy-manual.sh desde backend.\n'
