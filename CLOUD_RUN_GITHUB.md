# Cloud Run y GitHub: rutas de publicación

## Recomendado ahora: manual

Leer [INSTRUCTIVO_CLOUD_RUN.md](INSTRUCTIVO_CLOUD_RUN.md). Incluye scripts de preparación y despliegue desde Cloud Shell. No requiere configurar GitHub Actions ni WIF. Repositorios destino: camilovivasr-source/periferia_reto_backend y camilovivasr-source/periferia_reto_frontend.

## CI/CD opcional posterior

Los workflows ejecutan pruebas en PR/push. CD se ejecuta solo con DEPLOY_ENABLED=true en main. No actives dos sistemas de despliegue automático a la vez. Para usar Actions, ejecutar infra/bootstrap.sh del backend (identidades reto03-*), distinto de setup-manual.sh (identidades periferia-*). No mezclar sin ajustar cuentas/variables. Ambas rutas usan los mismos contenedores y secretos, pero la creación de permisos se documenta por separado.

Variables comunes de Actions: GCP_PROJECT_ID, GCP_REGION, ARTIFACT_REPOSITORY, WIF_PROVIDER, DEPLOYER_SERVICE_ACCOUNT, RUNTIME_SERVICE_ACCOUNT, CLOUD_RUN_SERVICE, OPERATOR_SIGNING_KEY_SECRET=operator-signing-key y DEPLOY_ENABLED=true cuando todo esté listo.

Backend añade GEMINI_API_KEY_SECRET=gemini-api-key, FRONTEND_RUNTIME_SERVICE_ACCOUNT (identidad frontend completa) y opcional REVIEWER_POLICIES_JSON=[]. Frontend añade BACKEND_URL, OPERATOR_ACCESS_CODE_SECRET=operator-access-code y opcional OPERATOR_ID=lider-1.

La clave Gemini y los valores de revisor nunca se guardan en GitHub: Actions configura referencias a Secret Manager. WIF se restringe al owner/repos reales y main. El backend es privado por IAM y el frontend público, con token de identidad entre servicios. Las decisiones humanas llevan además una aserción firmada y justificación.

Conexión de repos privados a herramientas: autorizar estos dos repos en la instalación GitHub correspondiente. Un404 del conector no significa necesariamente que el repo no exista; puede indicar que no está autorizado.
