import { and, eq, isNull, or } from 'drizzle-orm';
import { getDb } from '../db';
import { identityAliases } from '../db/schema';
import hosting from '../.openai/hosting.json';

// Only call with identity supplied by Sites dispatch, never form/query data.
// Email is a compatibility lookup alias; personal records use an opaque ID.
export async function resolveSiteIdentity(platformId:string|null,email:string):Promise<string> {
  const db=getDb();
  const normalized=email.trim().toLowerCase();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(hosting.project_id+'\0'+normalized));
  const alias=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('');
  const canonical=platformId?(await db.select().from(identityAliases).where(eq(identityAliases.platformId,platformId)).limit(1))[0]:null;
  if(canonical){
    await db.insert(identityAliases).values({alias,userId:canonical.userId,platformId,createdAt:new Date().toISOString()}).onConflictDoNothing();
    return canonical.userId;
  }
  await db.insert(identityAliases).values({alias,userId:platformId||crypto.randomUUID(),platformId,createdAt:new Date().toISOString()}).onConflictDoNothing();
  const existing=(await db.select().from(identityAliases).where(eq(identityAliases.alias,alias)))[0];
  if(platformId && existing.platformId && existing.platformId!==platformId)throw new Error('Identity conflict');
  if(platformId && !existing.platformId)await db.update(identityAliases).set({platformId}).where(and(eq(identityAliases.alias,alias),isNull(identityAliases.platformId)));
  return existing.userId;
}
