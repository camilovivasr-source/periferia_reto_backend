// Modo educativo explicito. No se presenta como agente LLM.
process.env.AGENT_MODE='practice';
await import('../dist/src/server.js');
