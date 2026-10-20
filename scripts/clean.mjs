// Eliminar solo la salida generada evita modulos antiguos despues de refactorizar.
import { rmSync } from 'node:fs';
rmSync(new URL('../dist/',import.meta.url),{recursive:true,force:true});
