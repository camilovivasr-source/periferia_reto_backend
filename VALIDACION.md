# Validación de esta entrega

- Backend: typecheck/build; 20 pruebas de dominio, arquitectura, proveedor simulado, Firestore simulado, revisión, rechazo y firma.
- Frontend: 5 pruebas de autenticación de operador y del dashboard en DOM; ver resultados de npm test.
- Smoke: backend HTTP y dos procesos frontend->backend con sesión, aserciones firmadas y SSE.
- Doctor, sintaxis JS, YAML y bash -n para scripts.
- No se ejecutó un navegador real: la descarga de Chromium no estuvo disponible. DOM y HTTP no sustituyen inspección visual.
- No se ejecutaron Docker, Gemini real, Firestore real, IAM cloud ni despliegue público. GCP y secretos aún no suministrados.
- El acceso GitHub debe verificarse por separado antes de afirmar que hubo push.
