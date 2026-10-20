import 'dotenv/config';
import { existsSync } from 'node:fs';
const deploy=process.argv.includes('--deployment');
const files=["Dockerfile", "package-lock.json", ".env.example", "agent/prompt.md", "src/server.ts", "infra/bootstrap.sh"];
const missing=files.filter(p=>!existsSync(p));
if(deploy){for(const name of ['GEMINI_API_KEY','OPERATOR_SIGNING_KEY'])if(!process.env[name])missing.push('Variable '+name);if(process.env.STATE_STORE!=='firestore')missing.push('STATE_STORE=firestore');if(process.env.HUMAN_AUTH_MODE!=='signed')missing.push('HUMAN_AUTH_MODE=signed');}
if(missing.length){console.error('Faltantes:',missing.join(', '));process.exitCode=1;}else console.log('Doctor OK: archivos y configuracion requerida presentes. No prueba conectividad cloud.');
