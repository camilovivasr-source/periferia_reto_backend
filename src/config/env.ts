import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';
export function readConfig(){
 const e=z.object({AGENT_MODE:z.enum(['llm','practice']).default('llm'),PORT:z.coerce.number().int().min(1).max(65535).default(8080),FIXTURES_DIR:z.string().default('fixtures/reto-03'),DEMO_APPROVER:z.string().default('lider-1'),GEMINI_MODEL:z.string().regex(/^[a-zA-Z0-9_.-]+$/).default('gemini-2.5-flash'),GEMINI_API_KEY:z.string().optional(),STATE_STORE:z.enum(['memory','firestore']).default('memory'),FIRESTORE_DATABASE:z.string().default('(default)'),HUMAN_AUTH_MODE:z.enum(['demo','signed']).default('demo'),OPERATOR_SIGNING_KEY:z.string().optional(),REVIEWER_POLICIES_JSON:z.string().default('[]')}).parse(process.env);
 const reviewerPolicies=z.array(z.object({id:z.string(),centros:z.array(z.string()),topeCentavos:z.number().int().nonnegative(),puedeRetroactiva:z.boolean()})).parse(JSON.parse(e.REVIEWER_POLICIES_JSON));
 if(process.env.K_SERVICE&&(e.HUMAN_AUTH_MODE!=='signed'||!e.OPERATOR_SIGNING_KEY||e.OPERATOR_SIGNING_KEY.length<32))throw Error('Cloud Run requiere revision firmada y OPERATOR_SIGNING_KEY de 32+ caracteres');
 return {humanAuthMode:e.HUMAN_AUTH_MODE,operatorSigningKey:e.OPERATOR_SIGNING_KEY,reviewerPolicies,agentMode:e.AGENT_MODE,port:e.PORT,fixturesDir:path.resolve(e.FIXTURES_DIR),demoApprover:e.DEMO_APPROVER,geminiModel:e.GEMINI_MODEL,geminiApiKey:e.GEMINI_API_KEY||undefined,stateStore:e.STATE_STORE,firestoreDatabase:e.FIRESTORE_DATABASE,maxSteps:8,timeoutMs:45000};
}
export type Config=ReturnType<typeof readConfig>;
