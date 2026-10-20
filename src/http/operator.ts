import { createHmac,timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Config } from '../config/env.js';
export function operator(req:IncomingMessage,config:Config,body:unknown):string|undefined{
 if(config.humanAuthMode==='demo')return config.demoApprover;
 const token=req.headers['x-operator-assertion'];if(typeof token!=='string'||!config.operatorSigningKey)return undefined;
 const [encoded,signature]=token.split('.');if(!encoded||!signature)return undefined;
 const expected=createHmac('sha256',config.operatorSigningKey).update('action:'+encoded).digest('hex');
 if(signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return undefined;
 try{const p=JSON.parse(Buffer.from(encoded,'base64url').toString());const payloadHash=createHmac('sha256',config.operatorSigningKey).update(JSON.stringify(body??null)).digest('hex');if(p.exp<Date.now()||p.exp>Date.now()+65000||p.path!==req.url||p.method!==req.method||p.payloadHash!==payloadHash||typeof p.actorId!=='string')return undefined;return p.actorId;}catch{return undefined;}
}
