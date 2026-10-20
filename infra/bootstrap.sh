#!/usr/bin/env bash
# Ejecutar en Cloud Shell tras revisar el proyecto y facturacion. No se ejecuta automaticamente.
set -euo pipefail
: "${PROJECT_ID:?Definir ID de proyecto GCP}"
: "${REGION:?Definir region Cloud Run, por ejemplo us-central1}"
GITHUB_OWNER=${GITHUB_OWNER:-camilovivasr-source}
BACKEND_REPO=${BACKEND_REPO:-periferia_reto_backend}
FRONTEND_REPO=${FRONTEND_REPO:-periferia_reto_frontend}
for value in "$GITHUB_OWNER" "$BACKEND_REPO" "$FRONTEND_REPO"; do [[ "$value" =~ ^[a-zA-Z0-9_.-]+$ ]] || exit 1; done
ARTIFACT_REPO=${ARTIFACT_REPO:-reto03}
POOL=github-reto03
PROVIDER=github
BACKEND_SA="reto03-backend@$PROJECT_ID.iam.gserviceaccount.com"
FRONTEND_SA="reto03-frontend@$PROJECT_ID.iam.gserviceaccount.com"
DEPLOYER_SA="reto03-deployer@$PROJECT_ID.iam.gserviceaccount.com"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com iamcredentials.googleapis.com sts.googleapis.com secretmanager.googleapis.com firestore.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com --project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
# Consultas fallan si no hay permisos; no ocultar errores de autorizacion.
ACCOUNTS=$(gcloud iam service-accounts list --project "$PROJECT_ID" --format='value(email)')
for name in reto03-backend reto03-frontend reto03-deployer; do
  if ! printf '%s\n' "$ACCOUNTS" | grep -Fxq "$name@$PROJECT_ID.iam.gserviceaccount.com"; then
    gcloud iam service-accounts create "$name" --project "$PROJECT_ID"
  fi
done
REPOS=$(gcloud artifacts repositories list --project "$PROJECT_ID" --location "$REGION" --format='value(name)')
if ! printf '%s\n' "$REPOS" | grep -q "/$ARTIFACT_REPO$"; then
 gcloud artifacts repositories create "$ARTIFACT_REPO" --repository-format=docker --location="$REGION" --project "$PROJECT_ID"
fi
DATABASES=$(gcloud firestore databases list --project "$PROJECT_ID" --format='value(name)')
if ! printf '%s\n' "$DATABASES" | grep -Fq '/databases/(default)'; then
 gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native --project "$PROJECT_ID"
fi
SECRETS=$(gcloud secrets list --project "$PROJECT_ID" --format='value(name)')
if ! printf '%s\n' "$SECRETS" | grep -Eq '(^|/)gemini-api-key$'; then
 gcloud secrets create gemini-api-key --replication-policy=automatic --project "$PROJECT_ID"
fi
gcloud secrets add-iam-policy-binding gemini-api-key --project "$PROJECT_ID" --member="serviceAccount:$BACKEND_SA" --role=roles/secretmanager.secretAccessor --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$BACKEND_SA" --role=roles/datastore.user --quiet
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOYER_SA" --role=roles/run.admin --quiet
gcloud artifacts repositories add-iam-policy-binding "$ARTIFACT_REPO" --project "$PROJECT_ID" --location "$REGION" --member="serviceAccount:$DEPLOYER_SA" --role=roles/artifactregistry.writer --quiet
for account in "$BACKEND_SA" "$FRONTEND_SA"; do
 gcloud iam service-accounts add-iam-policy-binding "$account" --project "$PROJECT_ID" --member="serviceAccount:$DEPLOYER_SA" --role=roles/iam.serviceAccountUser --quiet
done
POOLS=$(gcloud iam workload-identity-pools list --project "$PROJECT_ID" --location=global --format='value(name)')
if ! printf '%s\n' "$POOLS" | grep -q "/$POOL$"; then
 gcloud iam workload-identity-pools create "$POOL" --project "$PROJECT_ID" --location=global --display-name='GitHub Reto03'
fi
PROVIDERS=$(gcloud iam workload-identity-pools providers list --project "$PROJECT_ID" --location=global --workload-identity-pool="$POOL" --format='value(name)')
if ! printf '%s\n' "$PROVIDERS" | grep -q "/$PROVIDER$"; then
 gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --project "$PROJECT_ID" --location=global --workload-identity-pool="$POOL" --issuer-uri='https://token.actions.githubusercontent.com' --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner' --attribute-condition="assertion.repository_owner == '$GITHUB_OWNER' && assertion.ref == 'refs/heads/main' && (assertion.repository == '$GITHUB_OWNER/$BACKEND_REPO' || assertion.repository == '$GITHUB_OWNER/$FRONTEND_REPO')"
fi
for repo in "$BACKEND_REPO" "$FRONTEND_REPO"; do
 gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --project "$PROJECT_ID" --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository/$GITHUB_OWNER/$repo" --role=roles/iam.workloadIdentityUser --quiet
done
printf '\nValores para configurar GitHub:\nGCP_PROJECT_ID=%s\nGCP_REGION=%s\nARTIFACT_REPOSITORY=%s\nWIF_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\nDEPLOYER_SERVICE_ACCOUNT=%s\nBACKEND_RUNTIME=%s\nFRONTEND_RUNTIME=%s\n' "$PROJECT_ID" "$REGION" "$ARTIFACT_REPO" "$PROJECT_NUMBER" "$POOL" "$PROVIDER" "$DEPLOYER_SA" "$BACKEND_SA" "$FRONTEND_SA"
printf '\nFalta agregar una version al secreto gemini-api-key antes de desplegar.\n'

# Secretos del acceso de revisor del laboratorio; no sustituyen SSO corporativo.
for secret in operator-signing-key operator-access-code; do
  EXISTING=$(gcloud secrets list --project "$PROJECT_ID" --filter="name:$secret" --format='value(name)')
  if [ -z "$EXISTING" ]; then gcloud secrets create "$secret" --replication-policy=automatic --project "$PROJECT_ID"; fi
  VERSIONS=$(gcloud secrets versions list "$secret" --project "$PROJECT_ID" --filter='state=ENABLED' --limit=1 --format='value(name)')
  if [ -z "$VERSIONS" ]; then openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add "$secret" --project "$PROJECT_ID" --data-file=-; fi
  gcloud secrets add-iam-policy-binding "$secret" --project "$PROJECT_ID" --member="serviceAccount:$FRONTEND_SA" --role=roles/secretmanager.secretAccessor --quiet
done
gcloud secrets add-iam-policy-binding operator-signing-key --project "$PROJECT_ID" --member="serviceAccount:$BACKEND_SA" --role=roles/secretmanager.secretAccessor --quiet
