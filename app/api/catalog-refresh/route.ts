import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../db';
import { sources, products } from '../../../db/schema';
import { ensureCatalogSource, syncSource, SHARED_CATALOG_OWNER } from '../../../lib/service';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { sameRequestOrigin } from '../../../lib/request-origin';
export const dynamic='force-dynamic';
// This writer relies on dispatch's owner-private access policy. It never touches
// personal shopping lists. Keep the Site private; add an independent service
// credential before migrating this endpoint to public hosting.
export async function POST(request:Request){
  if(env.APP_RUNTIME==='netlify' && !await getChatGPTUser())return Response.json({error:'Войдите в аккаунт'},{status:401});
  if(!sameRequestOrigin(request))return Response.json({error:'Запрос отклонён'},{status:403});
  try{await ensureCatalogSource();const rows=await getDb().select().from(sources).where(and(eq(sources.enabled,1),eq(sources.owner,SHARED_CATALOG_OWNER)));const results=await Promise.all(rows.map(async source=>({sourceId:source.id,...await syncSource(source.id,source.owner,true)})));return Response.json({results},{headers:{'Cache-Control':'private, no-store'}});}catch(error){console.error('catalog refresh failed',error);return Response.json({error:'Обновление не выполнено'},{status:500});}
}
export async function GET(){if(env.APP_RUNTIME==='netlify'&&!await getChatGPTUser())return Response.json({error:'Войдите в аккаунт'},{status:401});const rows=await getDb().select().from(sources).where(eq(sources.owner,SHARED_CATALOG_OWNER)),items=await getDb().select().from(products).where(eq(products.owner,SHARED_CATALOG_OWNER));return Response.json({sources:rows.map(s=>({id:s.id,store:s.store,city:s.city,url:s.url,status:s.status,message:s.message,lastSuccess:s.lastSuccess,products:items.filter(p=>p.sourceId===s.id).length,regionVerifiedProducts:items.filter(p=>p.sourceId===s.id&&p.regionVerified===1).length})),products:items.length,checkedAt:new Date().toISOString()},{headers:{'Cache-Control':'private, no-store'}});}
