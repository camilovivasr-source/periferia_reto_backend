# Periferia Reto 3 - Backend

**Empieza por [INSTRUCTIVO_CLOUD_RUN.md](INSTRUCTIVO_CLOUD_RUN.md)** para despliegue manual. [ARQUITECTURA.md](ARQUITECTURA.md) explica módulos y trabajo del PRD.

## Local

```bash
npm ci
npm run doctor
npm run typecheck
npm test
npm run demo
npm run dev
```

Copiar .env.example a .env. Backend usa Gemini y requiere clave; para estudiar sin modelo ejecutar npm run dev:practice. Frontend local apunta al backend8080 y usa BACKEND_AUTH=none. Abrir frontend en3000.

Acceso de revisor local: local-review-only. Es un código educativo, no usarlo en Cloud Run. Cloud exige secretos distintos y aleatorios; setup-manual.sh los crea.

## Funciones

Dashboard de chat/auditoría, eventos SSE, controles verificables, resumen SAP simulado, justificación obligatoria, aprobación según autoridad y rechazo persistente. Supervisor y retroactividad solo si se configuran políticas explícitas; no existe botón universal de excepción.

## Cloud Run

Backend privado IAM, frontend público con proxy. Puerto8080, Dockerfiles, Secret Manager, Firestore y scripts manuales. GitHub Actions CI no requiere nube; CD está desactivado mientras DEPLOY_ENABLED no sea true.

Los fixtures y reglas son educativos. Falta PRD oficial; la presencia de archivos no certifica aprobación ni retroactividad. No se han probado credenciales Gemini ni despliegue real en tu proyecto. El PDF de primera edición dentro de backend/docs es material conceptual histórico; este instructivo y arquitectura son las referencias actuales.
