// Empaqueta el agente como modulo reutilizable (PRD 9.4) a partir de las MISMAS fuentes que usa la aplicacion:
// agent/prompt.md, src/knowledge/ordenes-compra.md y src/tools/oc.ts. Ejecutar: npm run modulo
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => readFileSync(path.join(raiz, p), 'utf8');

export function generar() {
  const agente = `---
description: Agente de compras que lee el paquete de una solicitud, valida controles RC1-RC10 contra maestros y crea la orden de compra en SAP (simulado) con confirmacion humana.
mode: primary
permission:
  edit: deny
  bash: deny
---

${leer('agent/prompt.md').trim()}
`;
  const skill = `---
name: ordenes-compra
description: Conocimiento del proceso de ordenes de compra de Periferia: documentos del paquete, controles RC1-RC11, maestros, estados y tratamiento de compras retroactivas. Cargar antes de procesar o explicar una solicitud.
---

${leer('src/knowledge/ordenes-compra.md').trim()}
`;
  const tools = `// Generado por scripts/build-modulo.mjs. Son las mismas herramientas que usa la aplicacion (src/tools/oc.ts).
export * from '../../src/tools/oc.js';
`;
  return { 'modulo/agent.md': agente, 'modulo/skill/ordenes-compra/SKILL.md': skill, 'modulo/tools/oc.ts': tools };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [ruta, contenido] of Object.entries(generar())) {
    mkdirSync(path.dirname(path.join(raiz, ruta)), { recursive: true });
    writeFileSync(path.join(raiz, ruta), contenido);
    console.log('escrito', ruta);
  }
}
