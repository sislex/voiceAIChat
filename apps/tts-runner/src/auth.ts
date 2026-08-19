import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
export function registerTtsAuth(app:FastifyInstance,token:string):void {
 app.addHook('onRequest',async(req,reply)=>{if(!req.url.startsWith('/v1/'))return;const got=req.headers.authorization?.replace(/^Bearer\s+/i,'')??'';const a=Buffer.from(got),b=Buffer.from(token);if(a.length!==b.length||!timingSafeEqual(a,b))return reply.code(401).send({error:'unauthorized'})})
}
