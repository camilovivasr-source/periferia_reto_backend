// COMPLETAR(PRD): No es una prioridad del reto: mantener etiquetado o deshabilitar en entrega cuando el LLM sea obligatorio.
// Ver ficha de este archivo en ARQUITECTURA.md.
/** Comandos educativos: no reemplazan al agente LLM de la entrega final. */
export function practiceAction(message:string){
 const id=message.match(/\bsol-\d{3}\b/)?.[0];
 if(!id)return {name:'listarSolicitudes',args:{}};
 return {name:/\b(crea|crear|procesa|procesar)\b/i.test(message)?'crearOrdenCompraSAP':'validarSolicitud',args:{solicitudId:id}};
}
