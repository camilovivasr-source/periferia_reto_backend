import 'dotenv/config';
if(!process.env.GEMINI_API_KEY)throw Error('Configurar GEMINI_API_KEY localmente');
const model=process.env.GEMINI_MODEL??'gemini-2.5-flash';
if(!/^[a-zA-Z0-9_.-]+$/.test(model))throw Error('Nombre de modelo invalido');
const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'x-goog-api-key':process.env.GEMINI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:'Responde solamente OK.'}]}]}),signal:AbortSignal.timeout(30000)});
if(!r.ok){console.error(`Gemini: HTTP ${r.status}. Revisar cuota, acceso al modelo y clave en consola.`);process.exitCode=1;}else{const data=await r.json();if(!data.candidates?.length)throw Error('Sin candidato util');console.log('Gemini conectado:',model);}
