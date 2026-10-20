import type { LlamadaUI, Pendiente } from './tipos.js';

/** Respuestas rapidas coherentes con el estado de la conversacion: las calcula el servidor, no el modelo. */
export function sugerir(llamadas: LlamadaUI[], pendientes: Pendiente[]): string[] {
  if (pendientes.length) {
    const c = pendientes[0].caso;
    return [`Confirmo: crea la OC de ${c} con las excepciones indicadas.`, `No, cancela ${c}.`, `¿Por qué ${c} requiere confirmación?`];
  }
  const ultima = (nombre: string) => [...llamadas].reverse().find((l) => l.nombre === nombre);
  const casoDe = (l?: LlamadaUI) => (l?.args as { caso?: string } | undefined)?.caso;
  const crear = ultima('oc_crear');
  const validar = ultima('oc_validar');
  const apta = (validar?.resultado as { apta?: boolean } | undefined)?.apta;

  if (crear?.ok) return ['Muéstrame el resumen del control', '¿Qué casos faltan por procesar?', 'Procesa otro caso'];
  if (validar && !validar.ok) return ['¿Qué casos hay disponibles?'];
  if (apta === false) return [`¿Qué debo pedirle al solicitante de ${casoDe(validar)}?`, '¿Qué casos faltan por procesar?', 'Procesa otro caso'];
  if (apta === true) return [`Sí, crea la OC de ${casoDe(validar)}`, '¿Qué controles pasó?'];
  return ['¿Qué casos hay disponibles?', 'Procesa la solicitud sol-001', 'Muéstrame el resumen del control'];
}
