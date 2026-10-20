#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PERIFERIA RETO 3 · INSTALADOR — un proyecto de GCP, de cero a la URL pública.
#
# Un solo archivo y un solo comando, pensado para Cloud Shell. Activa las APIs,
# crea las identidades, Firestore y los secretos, despliega el backend (privado
# por IAM) y el frontend (público, con proxy autenticado), y comprueba de verdad
# que todo responde. Sigue el patrón del instalador de «profe».
#
# ES IDEMPOTENTE: detecta lo que ya existe y lo salta. Si algo falla a mitad,
# se arregla la causa y se vuelve a correr entero.
#
#   En Cloud Shell:
#     git clone https://github.com/camilovivasr-source/periferia_reto_backend.git
#     PROJECT_ID=mi-proyecto bash periferia_reto_backend/instalar.sh
#
#   La clave de Gemini se pide UNA vez, sin eco (o pásala por GEMINI_API_KEY /
#   GEMINI_KEY_FILE). Las siguientes veces basta con:
#     bash periferia_reto_backend/instalar.sh
#
# Variables (todas opcionales salvo PROJECT_ID la primera vez):
#   PROJECT_ID        proyecto GCP. Se dice UNA vez y queda en ~/.periferia/instalacion.env
#   REGION            us-central1 por defecto
#   BILLING_ACCOUNT   sólo si el proyecto no tiene facturación (una sola cuenta abierta: se usa sola)
#   GEMINI_API_KEY    clave de Gemini (AI Studio). También GEMINI_KEY_FILE=ruta
#   GEMINI_MODEL      gemini-2.5-flash por defecto
#   OPERATOR_ID       líder que revisa en el laboratorio (lider-1)
#   REVIEWER_POLICIES_JSON  políticas explícitas de supervisor/retroactiva ([] por defecto)
#   RAMA              rama a desplegar (por defecto, la del clon del backend)
#   OWNER             dueño de los repos en GitHub (por defecto, el del clon)
#   FRONTEND_DIR      dónde está o se clona el frontend (carpeta hermana por defecto)
#   BACKEND_SERVICE / FRONTEND_SERVICE   periferia-backend / periferia-frontend
#   ORIGEN_PROJECT_ID proyecto anterior del que se copian los secretos (sin pisar nada)
#   SOLO_INFRA=true   prepara todo pero NO despliega
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

# ── De dónde sale el proyecto ────────────────────────────────────────────────
# Lo que se pase a mano manda; luego lo recordado; luego el proyecto activo de gcloud.
# Cloud Shell recicla la sesión y se lleva las variables: por eso se recuerda.
MEMORIA="${PERIFERIA_MEMORIA:-$HOME/.periferia/instalacion.env}"
# shellcheck source=/dev/null
[ -f "$MEMORIA" ] && . "$MEMORIA"

PROJECT_ID="${PROJECT_ID:-${PF_PROJECT_ID:-}}"
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null)"
  case "$PROJECT_ID" in "(unset)") PROJECT_ID="" ;; esac
fi
if [ -z "$PROJECT_ID" ]; then
  echo "Falta PROJECT_ID: el proyecto de GCP donde instalar." >&2
  echo "  Dilo UNA vez y queda recordado:  PROJECT_ID=mi-proyecto bash instalar.sh" >&2
  exit 1
fi
REGION="${REGION:-${PF_REGION:-us-central1}}"
mkdir -p "$(dirname "$MEMORIA")" 2>/dev/null
{ echo "PF_PROJECT_ID=${PROJECT_ID}"; echo "PF_REGION=${REGION}"; } > "$MEMORIA" 2>/dev/null

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR_BACK="$AQUI"
RAMA="${RAMA:-$(git -C "$AQUI" branch --show-current 2>/dev/null)}"
RAMA="${RAMA:-main}"
_OWNER_GIT="$(git -C "$AQUI" remote get-url origin 2>/dev/null | sed -nE 's#.*github\.com[:/]([^/]+)/.*#\1#p')"
OWNER="${OWNER:-${_OWNER_GIT:-camilovivasr-source}}"
REPO_FRONT="${REPO_FRONT:-${OWNER}/periferia_reto_frontend}"
DIR_FRONT="${FRONTEND_DIR:-$(dirname "$AQUI")/$(basename "$REPO_FRONT")}"
BACKEND_SERVICE="${BACKEND_SERVICE:-periferia-backend}"
FRONTEND_SERVICE="${FRONTEND_SERVICE:-periferia-frontend}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}"
OPERATOR_ID="${OPERATOR_ID:-lider-1}"
REVIEWER_POLICIES_JSON="${REVIEWER_POLICIES_JSON:-[]}"
SOLO_INFRA="${SOLO_INFRA:-false}"

AVISOS=()
FASE=""
azul()  { printf '\n\033[1;36m━━ %s\033[0m\n' "$1"; FASE="$1"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$1"; }
inf()   { printf '  \033[36m·\033[0m %s\n' "$1"; }
avisa() { printf '  \033[33m!\033[0m %s\n' "$1"; AVISOS+=("[$FASE] $1"); }
muere() { printf '\n  \033[31m✗ %s\033[0m\n     → %s\n\n' "$1" "${2:-}" >&2
          printf '  La instalación se detuvo en: %s\n' "$FASE" >&2
          printf '  Arregla eso y vuelve a correr este mismo script: es idempotente.\n\n' >&2
          exit 1; }

url_de() { gcloud run services describe "$1" --region="$REGION" --project="$PROJECT_ID" \
             --format='value(status.url)' 2>/dev/null; }

# Cloud Run sirve el servicio en dos URLs (…-<hash>.a.run.app y …-<nº proyecto>.<región>.run.app).
# Se muestran las dos: el evaluador puede abrir cualquiera.
urls_de() { # urls_de <servicio> → URL principal y alterna
  local servicio="$1" url numero
  url="$(url_de "$servicio")"; [ -n "$url" ] || return 0
  printf '%s' "$url"
  numero="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null)"
  [ -n "$numero" ] && [ "https://${servicio}-${numero}.${REGION}.run.app" != "$url" ] \
    && printf '\n              https://%s-%s.%s.run.app' "$servicio" "$numero" "$REGION"
  return 0
}

# Espera a que una URL conteste con el código esperado (reintentos: la primera
# petición tras un despliegue cae en una instancia que todavía arranca).
espera_http() { # espera_http <url> <códigos aceptados separados por |> <intentos>
  local destino="$1" aceptados="$2" limite="$3" codigo=000 i=0
  while [ "$i" -lt "$limite" ]; do
    codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$destino" 2>/dev/null || echo 000)"
    case "|$aceptados|" in *"|$codigo|"*) return 0 ;; esac
    i=$((i+1)); sleep 8
  done
  return 1
}

# ═══ 0 · Herramientas, sesión y código ══════════════════════════════════════
azul "0 · Comprobaciones previas"
for cmd in gcloud git curl python3 openssl; do
  command -v "$cmd" >/dev/null 2>&1 || muere "falta «$cmd»" \
    "en Cloud Shell ya vienen todos; en tu máquina instala el SDK de Google Cloud"
done
ok "gcloud, git, curl, python3, openssl"

CUENTA="$(gcloud config get-value account 2>/dev/null)"
[ -n "$CUENTA" ] && [ "$CUENTA" != "(unset)" ] || muere "no hay sesión de gcloud" "ejecuta: gcloud auth login"
ok "GCP: ${CUENTA}"
[ -f "${DIR_BACK}/Dockerfile" ] && [ -f "${DIR_BACK}/package.json" ] || muere \
  "no encuentro el backend en ${DIR_BACK}" "corre el script desde el clon: bash periferia_reto_backend/instalar.sh"
ok "backend: ${DIR_BACK} ($(git -C "$DIR_BACK" rev-parse --short HEAD 2>/dev/null || echo 'sin git'))"
inf "rama a desplegar: ${RAMA}"

# Con un solo `git clone` del backend basta: el frontend se trae aquí, en la misma rama.
if [ -d "${DIR_FRONT}/.git" ]; then
  if [ -n "$(git -C "$DIR_FRONT" status --porcelain 2>/dev/null)" ]; then
    avisa "${DIR_FRONT} tiene cambios sin commitear: se despliega tal cual está"
  elif git -C "$DIR_FRONT" fetch -q origin "$RAMA" 2>/dev/null && git -C "$DIR_FRONT" checkout -q "$RAMA" 2>/dev/null \
       && git -C "$DIR_FRONT" pull -q --ff-only origin "$RAMA" 2>/dev/null; then
    ok "frontend al día en ${RAMA} ($(git -C "$DIR_FRONT" rev-parse --short HEAD))"
  else
    avisa "no se pudo actualizar ${DIR_FRONT} a ${RAMA}: se despliega lo que hay ($(git -C "$DIR_FRONT" rev-parse --short HEAD 2>/dev/null))"
  fi
elif [ -f "${DIR_FRONT}/Dockerfile" ]; then
  ok "frontend (sin git) en ${DIR_FRONT}"
elif git clone -q -b "$RAMA" "https://github.com/${REPO_FRONT}.git" "$DIR_FRONT" 2>/dev/null; then
  ok "frontend clonado en ${DIR_FRONT} (${RAMA})"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 \
     && gh repo clone "$REPO_FRONT" "$DIR_FRONT" -- -q -b "$RAMA" >/dev/null 2>&1; then
  ok "frontend clonado con gh en ${DIR_FRONT} (${RAMA})"
else
  muere "no se pudo clonar ${REPO_FRONT} (rama ${RAMA})" \
    "repo privado: gh auth login y vuelve a correr · o clónalo/descomprímelo en ${DIR_FRONT}"
fi
[ -f "${DIR_FRONT}/Dockerfile" ] || muere "el frontend en ${DIR_FRONT} no tiene Dockerfile" "usa FRONTEND_DIR=/ruta/al/frontend"

# ═══ 1 · Proyecto y facturación ═════════════════════════════════════════════
azul "1 · Proyecto y facturación"
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  ok "el proyecto ${PROJECT_ID} existe"
else
  inf "no existe, creándolo"
  gcloud projects create "$PROJECT_ID" --name="Periferia Reto 3" >/dev/null 2>&1 \
    || muere "no se pudo crear el proyecto ${PROJECT_ID}" \
             "el id puede estar tomado (son globales) o tu cuenta no puede crear proyectos"
  ok "creado"
fi
gcloud config set project "$PROJECT_ID" >/dev/null 2>&1

if [ "$(gcloud beta billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null)" = "True" ]; then
  ok "facturación activa"
else
  if [ -z "${BILLING_ACCOUNT:-}" ]; then
    mapfile -t _CUENTAS < <(gcloud beta billing accounts list --filter='open=true' \
                              --format='value(name.basename(),displayName)' 2>/dev/null)
    if [ "${#_CUENTAS[@]}" -eq 1 ]; then
      BILLING_ACCOUNT="${_CUENTAS[0]%%[[:space:]]*}"
      inf "facturación: la única cuenta abierta (${_CUENTAS[0]})"
    elif [ "${#_CUENTAS[@]}" -gt 1 ] && [ -t 0 ]; then
      echo "  Cuentas de facturación abiertas:"
      for i in "${!_CUENTAS[@]}"; do echo "    $((i + 1))) ${_CUENTAS[$i]}"; done
      read -r -p "  ¿Cuál uso para ${PROJECT_ID}? [1-${#_CUENTAS[@]}] " _n
      [[ "$_n" =~ ^[0-9]+$ ]] && [ "$_n" -ge 1 ] && [ "$_n" -le "${#_CUENTAS[@]}" ] \
        && BILLING_ACCOUNT="${_CUENTAS[$((_n - 1))]%%[[:space:]]*}"
    fi
  fi
  if [ -n "${BILLING_ACCOUNT:-}" ]; then
    gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT" >/dev/null 2>&1 \
      && ok "facturación vinculada" \
      || muere "no se pudo vincular la facturación" "revisa el id: gcloud beta billing accounts list"
  else
    muere "el proyecto NO tiene facturación" \
          "vuelve a correr con BILLING_ACCOUNT=xxx (gcloud beta billing accounts list)"
  fi
fi

# El frontend es público (--allow-unauthenticated); en cuentas de organización eso
# a veces está prohibido y el despliegue falla al final.
POL="$(gcloud resource-manager org-policies describe constraints/iam.allowedPolicyMemberDomains \
        --project="$PROJECT_ID" --effective --format='value(listPolicy.allValues)' 2>/dev/null)"
if [ -z "$POL" ] || [ "$POL" = "ALLOW" ]; then
  ok "la organización permite publicar el frontend (allUsers)"
else
  avisa "iam.allowedPolicyMemberDomains puede impedir un servicio público: si el frontend falla con FAILED_PRECONDITION, un admin debe dar una excepción"
fi
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)' 2>/dev/null)"
[ -n "$PROJECT_NUMBER" ] || muere "no se pudo leer el número del proyecto" "¿tienes permiso de lectura sobre ${PROJECT_ID}?"

# ═══ 2 · APIs ═══════════════════════════════════════════════════════════════
azul "2 · APIs"
APIS=(run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
      firestore.googleapis.com secretmanager.googleapis.com iam.googleapis.com
      serviceusage.googleapis.com cloudresourcemanager.googleapis.com logging.googleapis.com
      compute.googleapis.com)
ACTIVAS="$(gcloud services list --enabled --project="$PROJECT_ID" --format='value(config.name)' 2>/dev/null)"
FALTAN=()
for api in "${APIS[@]}"; do grep -qx "$api" <<<"$ACTIVAS" || FALTAN+=("$api"); done
if [ ${#FALTAN[@]} -eq 0 ]; then
  ok "las ${#APIS[@]} APIs ya estaban activas"
else
  inf "activando: ${FALTAN[*]}"
  gcloud services enable "${FALTAN[@]}" --project="$PROJECT_ID" >/dev/null 2>&1 \
    || muere "no se pudieron activar las APIs" "prueba: gcloud services enable ${FALTAN[*]} --project=${PROJECT_ID}"
  ok "activadas ${#FALTAN[@]} APIs"
fi

# ═══ 3 · Identidades y permisos ═════════════════════════════════════════════
azul "3 · Cuentas de servicio y permisos"
SA_BACK="periferia-backend@${PROJECT_ID}.iam.gserviceaccount.com"
SA_FRONT="periferia-frontend@${PROJECT_ID}.iam.gserviceaccount.com"
SA_BUILD="periferia-builder@${PROJECT_ID}.iam.gserviceaccount.com"
NUEVAS=0
crea_sa() { # crea_sa <id> <nombre>
  if gcloud iam service-accounts describe "$1@${PROJECT_ID}.iam.gserviceaccount.com" --project="$PROJECT_ID" >/dev/null 2>&1; then
    ok "$1 ya existe"
  else
    gcloud iam service-accounts create "$1" --display-name="$2" --project="$PROJECT_ID" >/dev/null 2>&1 \
      || muere "no se pudo crear la cuenta de servicio $1" "¿tienes el rol Owner o IAM Admin en el proyecto?"
    ok "$1 creada"; NUEVAS=1
  fi
}
crea_sa periferia-backend  "Periferia · backend (API y Gemini)"
crea_sa periferia-frontend "Periferia · frontend (UI y proxy)"
crea_sa periferia-builder  "Periferia · compilación"
[ "$NUEVAS" = 1 ] && sleep 15   # IAM tarda unos segundos en ver una cuenta nueva

POLITICA="$(gcloud projects get-iam-policy "$PROJECT_ID" --format=json 2>/dev/null)"
dar_rol() { # dar_rol <miembro> <rol>
  if python3 -c 'import json,sys; p=json.loads(sys.argv[1] or "{}"); sys.exit(0 if any(b["role"]==sys.argv[3] and sys.argv[2] in b.get("members",[]) for b in p.get("bindings",[])) else 1)' \
       "$POLITICA" "$1" "$2" 2>/dev/null; then
    return 0
  fi
  local i
  for i in 1 2 3 4; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="$1" --role="$2" \
      --condition=None --quiet >/dev/null 2>&1 && return 0
    sleep 10
  done
  avisa "no se pudo dar ${2} a ${1}"
  return 1
}
dar_rol "serviceAccount:${SA_BUILD}" roles/run.builder
dar_rol "serviceAccount:${SA_BUILD}" roles/logging.logWriter
dar_rol "serviceAccount:${SA_BACK}"  roles/datastore.user      # Firestore: órdenes, decisiones y auditoría
dar_rol "serviceAccount:${SA_BACK}"  roles/logging.logWriter
dar_rol "serviceAccount:${SA_FRONT}" roles/logging.logWriter
ok "permisos: compilación, Firestore (backend) y logs"

# ═══ 4 · Firestore ══════════════════════════════════════════════════════════
azul "4 · Firestore (estado de órdenes, decisiones y auditoría)"
# Sin Firestore el backend en Cloud Run no arranca (STATE_STORE=firestore) y la
# memoria se perdería en cada reinicio. Debe ser Native en la base por defecto.
if gcloud firestore databases list --project="$PROJECT_ID" --format='value(name)' 2>/dev/null | grep -Fq '/databases/(default)'; then
  ok "la base (default) ya existe"
else
  gcloud firestore databases create --database='(default)' --location="$REGION" \
    --type=firestore-native --project="$PROJECT_ID" >/dev/null 2>&1 \
    || muere "no se pudo crear Firestore en ${REGION}" "crea la base (default) Native en la consola y vuelve a correr"
  ok "base (default) Native creada en ${REGION}"
fi
DBTYPE="$(gcloud firestore databases describe --database='(default)' --project="$PROJECT_ID" --format='value(type)' 2>/dev/null)"
[ "$DBTYPE" = "FIRESTORE_NATIVE" ] || muere "la base (default) no es Firestore Native (${DBTYPE:-desconocido})" \
  "el backend necesita Native; usa otro proyecto o revisa la base existente"

# ═══ 5 · Secretos ═══════════════════════════════════════════════════════════
azul "5 · Secretos"
tiene_valor() { [ -n "$(gcloud secrets versions list "$1" --project="$PROJECT_ID" \
                         --filter='state=ENABLED' --limit=1 --format='value(name)' 2>/dev/null)" ]; }
crea_secreto() { # crea_secreto <nombre>
  gcloud secrets describe "$1" --project="$PROJECT_ID" >/dev/null 2>&1 \
    || gcloud secrets create "$1" --replication-policy=automatic --project="$PROJECT_ID" >/dev/null 2>&1 \
    || muere "no se pudo crear el secreto $1" "¿tienes secretmanager.admin?"
}
for s in gemini-api-key operator-signing-key operator-access-code; do crea_secreto "$s"; done

# Opcional: traer los secretos de un proyecto anterior (sin pisar nada).
if [ -n "${ORIGEN_PROJECT_ID:-}" ]; then
  for s in gemini-api-key operator-signing-key operator-access-code; do
    if tiene_valor "$s"; then inf "${s}: ya tiene valor, no se copia"
    elif V="$(gcloud secrets versions access latest --secret="$s" --project="$ORIGEN_PROJECT_ID" 2>/dev/null)" && [ -n "$V" ]; then
      printf '%s' "$V" | gcloud secrets versions add "$s" --project="$PROJECT_ID" --data-file=- >/dev/null 2>&1 \
        && ok "${s}: copiado de ${ORIGEN_PROJECT_ID}" || avisa "${s}: no se pudo copiar de ${ORIGEN_PROJECT_ID}"
    else avisa "${s}: no se pudo leer en ${ORIGEN_PROJECT_ID}"; fi
    unset V
  done
fi

# Claves aleatorias del laboratorio: sólo si no hay versión. Nunca se imprimen.
for s in operator-signing-key operator-access-code; do
  if tiene_valor "$s"; then ok "${s} ya tiene valor"
  else
    openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add "$s" --project="$PROJECT_ID" --data-file=- >/dev/null 2>&1 \
      && ok "${s} generado (aleatorio, 256 bits)" || muere "no se pudo crear el valor de ${s}" "revisa secretmanager.versions.add"
  fi
done

# Clave de Gemini: variable, archivo o una pregunta sin eco (sólo con terminal).
if tiene_valor gemini-api-key && [ -z "${GEMINI_API_KEY:-}${GEMINI_KEY_FILE:-}" ]; then
  ok "gemini-api-key ya tiene valor"
else
  CLAVE="${GEMINI_API_KEY:-}"
  [ -z "$CLAVE" ] && [ -n "${GEMINI_KEY_FILE:-}" ] && [ -f "$GEMINI_KEY_FILE" ] && CLAVE="$(tr -d '\n\r ' < "$GEMINI_KEY_FILE")"
  if [ -z "$CLAVE" ] && [ -t 0 ]; then
    read -rsp '  Clave de Gemini (aistudio.google.com/apikey; no se muestra): ' CLAVE; echo
  fi
  if [ -n "$CLAVE" ]; then
    printf '%s' "$CLAVE" | gcloud secrets versions add gemini-api-key --project="$PROJECT_ID" --data-file=- >/dev/null 2>&1 \
      && ok "gemini-api-key registrada" || muere "no se pudo guardar gemini-api-key" "revisa permisos de Secret Manager"
  fi
  unset CLAVE
fi
tiene_valor gemini-api-key || muere "falta la clave de Gemini" \
  "vuelve a correr con GEMINI_API_KEY=… (o GEMINI_KEY_FILE=archivo); créala en https://aistudio.google.com/apikey"

# Acceso mínimo: cada identidad lee sólo sus secretos.
dar_secreto() { gcloud secrets add-iam-policy-binding "$1" --project="$PROJECT_ID" \
                  --member="serviceAccount:$2" --role=roles/secretmanager.secretAccessor --quiet >/dev/null 2>&1 \
                  || avisa "no se pudo dar acceso a $1 a $2"; }
dar_secreto gemini-api-key       "$SA_BACK"
dar_secreto operator-signing-key "$SA_BACK"
dar_secreto operator-signing-key "$SA_FRONT"
dar_secreto operator-access-code "$SA_FRONT"
ok "acceso mínimo: backend (Gemini + firma) · frontend (firma + código de revisor)"

# La clave debe servir de verdad: una llamada mínima al modelo, sin imprimir nada.
CLAVE_PRUEBA="$(gcloud secrets versions access latest --secret=gemini-api-key --project="$PROJECT_ID" 2>/dev/null)"
if [ -n "$CLAVE_PRUEBA" ]; then
  GM="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
         -H "x-goog-api-key: ${CLAVE_PRUEBA}" \
         "https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}" 2>/dev/null || echo 000)"
  case "$GM" in
    200) ok "Gemini responde: la clave sirve para ${GEMINI_MODEL}" ;;
    400|401|403) avisa "Gemini rechazó la clave (HTTP ${GM}): el chat con LLM fallará; crea otra en aistudio.google.com/apikey" ;;
    404) avisa "el modelo ${GEMINI_MODEL} no existe para esa clave (HTTP 404): ajusta GEMINI_MODEL" ;;
    000) avisa "no se pudo contactar con Gemini desde aquí (red): no se comprobó la clave" ;;
    *) avisa "Gemini respondió HTTP ${GM}: revisa cuota y acceso al modelo" ;;
  esac
fi
unset CLAVE_PRUEBA

if [ "$SOLO_INFRA" = "true" ]; then
  azul "Fin (SOLO_INFRA=true)"
  ok "infraestructura lista; quita SOLO_INFRA para desplegar"
  exit 0
fi

# ═══ 6 · Backend (privado por IAM) ══════════════════════════════════════════
azul "6 · Backend (${BACKEND_SERVICE})"
# El validador de las políticas de revisor debe ser un arreglo JSON antes de desplegar.
python3 -c 'import json,sys; assert isinstance(json.loads(sys.argv[1]), list)' "$REVIEWER_POLICIES_JSON" 2>/dev/null \
  || muere "REVIEWER_POLICIES_JSON no es un arreglo JSON" "ejemplo: '[]' o '[{\"id\":\"supervisor\",\"centros\":[\"CC-01\"],\"topeCentavos\":500000000,\"puedeRetroactiva\":true}]'"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# JSON y no --set-env-vars: REVIEWER_POLICIES_JSON lleva comas y comillas.
GEMINI_MODEL="$GEMINI_MODEL" REVIEWER_POLICIES_JSON="$REVIEWER_POLICIES_JSON" TMP="$TMP" python3 - <<'PY'
import json, os
from pathlib import Path
Path(os.environ['TMP'], 'backend.json').write_text(json.dumps({
    'AGENT_MODE': 'llm',
    'GEMINI_MODEL': os.environ['GEMINI_MODEL'],
    'STATE_STORE': 'firestore',
    'HUMAN_AUTH_MODE': 'signed',
    'REVIEWER_POLICIES_JSON': os.environ['REVIEWER_POLICIES_JSON'],
}))
PY

# La compilación usa su propia cuenta. Si la organización lo restringe, se reintenta
# una vez con la cuenta de Compute (como en el instalador de profe).
BUILD_FLAG=(--build-service-account="projects/${PROJECT_ID}/serviceAccounts/${SA_BUILD}")
if ! gcloud run deploy --help 2>/dev/null | grep -q -- '--build-service-account'; then
  BUILD_FLAG=()
  dar_rol "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" roles/run.builder
  avisa "tu gcloud no admite --build-service-account: se compila con la cuenta de Compute (actualiza gcloud si falla)"
fi
despliega() { # despliega <servicio> <carpeta> <log> <flags…>
  local servicio="$1" carpeta="$2" log="$3"; shift 3
  gcloud run deploy "$servicio" --source="$carpeta" --region="$REGION" --project="$PROJECT_ID" \
    "${BUILD_FLAG[@]}" --port=8080 --quiet "$@" > "$log" 2>&1 && return 0
  [ ${#BUILD_FLAG[@]} -gt 0 ] || return 1
  avisa "la compilación con ${SA_BUILD} falló; se reintenta con la cuenta de Compute"
  dar_rol "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" roles/run.builder
  BUILD_FLAG=(); sleep 15
  gcloud run deploy "$servicio" --source="$carpeta" --region="$REGION" --project="$PROJECT_ID" \
    --port=8080 --quiet "$@" >> "$log" 2>&1
}

inf "compilando y desplegando desde ${DIR_BACK} (tarda 3-6 minutos)…"
despliega "$BACKEND_SERVICE" "$DIR_BACK" /tmp/periferia_backend.log \
  --service-account="$SA_BACK" --memory=512Mi --cpu=1 --min-instances=0 --max-instances=2 \
  --concurrency=4 --timeout=120 --no-allow-unauthenticated \
  --env-vars-file="$TMP/backend.json" \
  --set-secrets='GEMINI_API_KEY=gemini-api-key:latest,OPERATOR_SIGNING_KEY=operator-signing-key:latest' \
  || { tail -25 /tmp/periferia_backend.log >&2; muere "falló el despliegue del backend" \
       "el error real está arriba (log completo: /tmp/periferia_backend.log)"; }
BACKEND_URL="$(url_de "$BACKEND_SERVICE")"
[ -n "$BACKEND_URL" ] || muere "el backend se desplegó pero no tiene URL" "revisa: gcloud run services list --region=${REGION}"
ok "backend (privado por IAM) en ${BACKEND_URL}"

# Sólo la identidad del frontend puede invocarlo.
gcloud run services add-iam-policy-binding "$BACKEND_SERVICE" --project="$PROJECT_ID" --region="$REGION" \
  --member="serviceAccount:${SA_FRONT}" --role=roles/run.invoker --quiet >/dev/null 2>&1 \
  && ok "run.invoker del backend sólo para ${SA_FRONT%%@*}" \
  || avisa "no se pudo dar run.invoker al frontend: /api/backend-health devolverá 502"

# ═══ 7 · Frontend (público, proxy autenticado) ══════════════════════════════
azul "7 · Frontend (${FRONTEND_SERVICE})"
BACKEND_URL="$BACKEND_URL" OPERATOR_ID="$OPERATOR_ID" TMP="$TMP" python3 - <<'PY'
import json, os
from pathlib import Path
Path(os.environ['TMP'], 'frontend.json').write_text(json.dumps({
    'BACKEND_URL': os.environ['BACKEND_URL'],   # origen exacto: es la audiencia del token IAM
    'BACKEND_AUTH': 'iam',
    'OPERATOR_ID': os.environ['OPERATOR_ID'],
}))
PY
inf "compilando y desplegando desde ${DIR_FRONT} (tarda 2-4 minutos)…"
despliega "$FRONTEND_SERVICE" "$DIR_FRONT" /tmp/periferia_frontend.log \
  --service-account="$SA_FRONT" --memory=256Mi --cpu=1 --min-instances=0 --max-instances=2 \
  --concurrency=8 --timeout=120 --allow-unauthenticated \
  --env-vars-file="$TMP/frontend.json" \
  --set-secrets='OPERATOR_SIGNING_KEY=operator-signing-key:latest,OPERATOR_ACCESS_CODE=operator-access-code:latest' \
  || { tail -25 /tmp/periferia_frontend.log >&2; muere "falló el despliegue del frontend" \
       "el error real está arriba (log completo: /tmp/periferia_frontend.log)"; }
FRONTEND_URL="$(url_de "$FRONTEND_SERVICE")"
[ -n "$FRONTEND_URL" ] || muere "el frontend se desplegó pero no tiene URL" "revisa: gcloud run services list --region=${REGION}"
ok "frontend (público) en ${FRONTEND_URL}"

# ═══ 8 · Verificación real ══════════════════════════════════════════════════
azul "8 · Verificación"
if espera_http "${FRONTEND_URL}/health" 200 18; then ok "frontend /health responde 200"
else avisa "el frontend no responde en ${FRONTEND_URL}/health tras 2 minutos"; fi

if espera_http "${FRONTEND_URL}/api/backend-health" 200 18; then
  SALUD="$(curl -s --max-time 25 "${FRONTEND_URL}/api/backend-health")"
  leer() { python3 -c 'import json,sys
d=json.loads(sys.argv[1]); print(d.get(sys.argv[2], ""))' "$SALUD" "$1" 2>/dev/null; }
  ok "proxy autenticado frontend → backend (IAM) funciona"
  [ "$(leer mode)" = "LLM" ]          && ok "agente en modo LLM (no es el modo de práctica)" || avisa "mode=$(leer mode): se esperaba LLM"
  [ "$(leer stateStore)" = "firestore" ] && ok "estado en Firestore (duradero)" || avisa "stateStore=$(leer stateStore): se esperaba firestore"
  [ "$(leer humanAuth)" = "signed" ]  && ok "decisiones humanas con firma (humanAuth=signed)" || avisa "humanAuth=$(leer humanAuth): se esperaba signed"
else
  avisa "/api/backend-health no responde 200: revisa BACKEND_URL, run.invoker y los logs del backend"
fi

# El backend debe ser PRIVADO: sin token, 401/403.
CODIGO_BACK="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${BACKEND_URL}/health" 2>/dev/null || echo 000)"
case "$CODIGO_BACK" in
  401|403) ok "el backend es privado: sin token responde ${CODIGO_BACK}" ;;
  *) avisa "el backend respondió ${CODIGO_BACK} sin token: debería ser 401/403 (¿es público?)" ;;
esac

# La página principal y los archivos estáticos.
espera_http "${FRONTEND_URL}/" 200 6 && ok "la interfaz (/) carga" || avisa "la interfaz no carga en ${FRONTEND_URL}/"

# ═══ Resumen ════════════════════════════════════════════════════════════════
echo
echo "══════════════════════════════════════════════════════════"
printf '\033[1m PERIFERIA RETO 3 · %s\033[0m\n' "$PROJECT_ID"
echo "══════════════════════════════════════════════════════════"
printf '  URL pública : %s\n' "$(urls_de "$FRONTEND_SERVICE")"
echo   "  Backend     : privado por IAM (${BACKEND_URL})"
echo   "  Rama        : ${RAMA}"
echo   "  Estado      : Firestore (default) · Secretos: gemini-api-key, operator-signing-key, operator-access-code"
echo
echo "  Para entrar como revisor, lee el código en TU terminal (no lo pegues en chats ni commits):"
echo "    gcloud secrets versions access latest --secret=operator-access-code --project=${PROJECT_ID}"
echo "  Operador: ${OPERATOR_ID} · la sesión dura 30 min."
echo
if [ ${#AVISOS[@]} -eq 0 ]; then
  printf '\033[32m  INSTALACIÓN COMPLETA: todo respondió.\033[0m\n'
else
  printf '\033[33m  INSTALACIÓN CON %d AVISO(S):\033[0m\n' "${#AVISOS[@]}"
  for a in "${AVISOS[@]}"; do echo "    · $a"; done
  echo
  echo "  Arregla lo que te importe y vuelve a correr este script: es idempotente."
fi
echo
echo "  Pendiente según el PRD oficial: adaptar parsers/controles a los maestros y casos reales."
echo "══════════════════════════════════════════════════════════"
