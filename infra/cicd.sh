#!/usr/bin/env bash
# Despliegue automatico: cada push a las ramas indicadas redespliega el servicio en Cloud Run.
# Crea (una sola vez, idempotente) la federacion de identidad de GitHub -> Google Cloud, sin claves JSON,
# y guarda los valores como variables de los dos repositorios (no son secretos).
#   Requiere: PROJECT_ID.  Opcionales: REGION OWNER RAMAS_DESPLIEGUE ("main claude/blissful-mendel-88agwr")
set -uo pipefail
: "${PROJECT_ID:?Falta PROJECT_ID}"
REGION="${REGION:-us-central1}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="${OWNER:-$(git -C "$AQUI" remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com[:/]([^/]+)/.*#\1#p')}"
OWNER="${OWNER:-camilovivasr-source}"
REPO_BACK="${REPO_BACK:-periferia_reto_backend}"; REPO_FRONT="${REPO_FRONT:-periferia_reto_frontend}"
RAMAS="${RAMAS_DESPLIEGUE:-main claude/blissful-mendel-88agwr}"
POOL=github; PROVIDER=github
DEPLOYER="periferia-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT
falla() { echo "  ✗ $1" >&2; [ -s "$LOG" ] && tail -n 8 "$LOG" | sed 's/^/     | /' >&2; exit 1; }
corre() { : > "$LOG"; "$@" >"$LOG" 2>&1; }

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null)"
[ -n "$PROJECT_NUMBER" ] || falla "no se pudo leer el proyecto $PROJECT_ID"
corre gcloud services enable iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com iam.googleapis.com --project="$PROJECT_ID" || falla "no se pudieron activar las APIs de federacion"

gcloud iam service-accounts describe "$DEPLOYER" --project="$PROJECT_ID" >/dev/null 2>&1 \
  || { corre gcloud iam service-accounts create periferia-deployer --display-name="Periferia · despliegue desde GitHub" --project="$PROJECT_ID" || falla "no se pudo crear periferia-deployer"; sleep 10; }
for rol in roles/run.admin roles/cloudbuild.builds.editor roles/storage.admin roles/artifactregistry.writer roles/serviceusage.serviceUsageConsumer roles/iam.serviceAccountUser roles/logging.viewer; do
  corre gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:${DEPLOYER}" --role="$rol" --condition=None --quiet || falla "no se pudo dar $rol al desplegador"
done
echo "  ✓ cuenta de despliegue ${DEPLOYER}"

gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT_ID" >/dev/null 2>&1 \
  || corre gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions" --project="$PROJECT_ID" || falla "no se pudo crear el pool de identidades"

# Solo estos repos y estas ramas pueden asumir la identidad de despliegue.
RAMAS_CEL="$(for r in $RAMAS; do printf "'refs/heads/%s'," "$r"; done)"; RAMAS_CEL="[${RAMAS_CEL%,}]"
CONDICION="assertion.repository_owner=='${OWNER}' && assertion.repository in ['${OWNER}/${REPO_BACK}','${OWNER}/${REPO_FRONT}'] && assertion.ref in ${RAMAS_CEL}"
MAPEO='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref'
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  corre gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT_ID" \
    --issuer-uri='https://token.actions.githubusercontent.com' --attribute-mapping="$MAPEO" --attribute-condition="$CONDICION" || falla "no se pudo actualizar el proveedor OIDC"
else
  corre gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool="$POOL" --location=global --project="$PROJECT_ID" \
    --issuer-uri='https://token.actions.githubusercontent.com' --attribute-mapping="$MAPEO" --attribute-condition="$CONDICION" || falla "no se pudo crear el proveedor OIDC"
fi
for repo in "$REPO_BACK" "$REPO_FRONT"; do
  corre gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" --project="$PROJECT_ID" \
    --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${OWNER}/${repo}" \
    --role=roles/iam.workloadIdentityUser --quiet || falla "no se pudo autorizar al repo ${repo}"
done
WIF="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
echo "  ✓ federación lista (ramas: ${RAMAS})"

# Variables de los repos (no son secretos). Sin gh autenticado se imprimen para ponerlas a mano.
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  ok=1
  for repo in "$REPO_BACK" "$REPO_FRONT"; do
    for par in "GCP_PROJECT_ID=${PROJECT_ID}" "GCP_REGION=${REGION}" "WIF_PROVIDER=${WIF}" "DEPLOYER_SA=${DEPLOYER}"; do
      gh variable set "${par%%=*}" --body "${par#*=}" --repo "${OWNER}/${repo}" >/dev/null 2>&1 || ok=0
    done
  done
  [ "$ok" = 1 ] && echo "  ✓ variables guardadas en ${REPO_BACK} y ${REPO_FRONT}: a partir de ahora, cada push despliega" \
    || { echo "  ! no se pudieron guardar las variables (¿permiso de admin en los repos?). Créalas a mano en Settings → Variables → Actions:"; echo "    GCP_PROJECT_ID=${PROJECT_ID}  GCP_REGION=${REGION}  WIF_PROVIDER=${WIF}  DEPLOYER_SA=${DEPLOYER}"; }
else
  echo "  ! gh no está autenticado: crea estas variables en ambos repos (Settings → Secrets and variables → Actions → Variables):"
  echo "    GCP_PROJECT_ID=${PROJECT_ID}  GCP_REGION=${REGION}"
  echo "    WIF_PROVIDER=${WIF}"
  echo "    DEPLOYER_SA=${DEPLOYER}"
fi
