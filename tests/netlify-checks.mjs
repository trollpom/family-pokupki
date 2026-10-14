import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {drizzle} from 'drizzle-orm/d1';

const folder=fs.mkdtempSync(path.resolve('node_modules/.netlify-checks-'));
const require=createRequire(import.meta.url);
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,resolveJsonModule:true}}).outputText;
class Store {
  bytes=null;version=0;conflicts=0;forceConflict=false;
  async getWithMetadata(){return this.bytes?{data:this.bytes.slice(0),etag:String(this.version)}:null;}
  async set(key,data,condition){
    if(this.forceConflict){this.forceConflict=false;this.conflicts++;return {modified:false};}
    if(condition.onlyIfNew?this.bytes!==null:condition.onlyIfMatch!==String(this.version)){this.conflicts++;return {modified:false};}
    this.bytes=data.slice(0);this.version++;return {modified:true};
  }
}
try {
  fs.writeFileSync(path.join(folder,'sqlite-d1.cjs'),compile('lib/netlify/sqlite-d1.ts'));
  fs.copyFileSync('lib/netlify/migrations.json',path.join(folder,'migrations.json'));
  fs.writeFileSync(path.join(folder,'schema.cjs'),compile('db/schema.ts'));
  const {NetlifyD1}=require(path.join(folder,'sqlite-d1.cjs')),schema=require(path.join(folder,'schema.cjs'));
  const store=new Store(),client=new NetlifyD1(()=>store),db=drizzle(client,{schema});
  const expected=fs.readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort().map(name=>({name,sql:fs.readFileSync('drizzle/'+name,'utf8')}));
  assert.deepEqual(JSON.parse(fs.readFileSync('lib/netlify/migrations.json','utf8')),expected);
  assert.equal((await client.prepare('SELECT count(*) AS n FROM _sobrano_migrations').first('n')),expected.length);
  assert.ok(store.bytes,'fresh migrations are persisted');
  await db.insert(schema.profiles).values({id:'owner',name:'Test',email:'owner@example.invalid',city:'Нижний Новгород',createdAt:new Date().toISOString()});
  const restarted=drizzle(new NetlifyD1(()=>store),{schema});
  assert.equal((await restarted.select().from(schema.profiles))[0].id,'owner','new function invocation reads durable data');
  const version=store.version;await restarted.select().from(schema.profiles);assert.equal(store.version,version,'reads do not overwrite snapshots');
  assert.deepEqual(await client.prepare('SELECT 1 AS x, 2 AS x').raw(),[[1,2]],'raw rows preserve duplicate columns');
  await assert.rejects(()=>client.batch([
    client.prepare("INSERT INTO profiles(id,name,email,city,created_at) VALUES('rollback','Test','r@example.invalid','НН','now')"),
    client.prepare("INSERT INTO profiles(id,name,email,city,created_at) VALUES('owner','Duplicate','d@example.invalid','НН','now')"),
  ]));
  assert.equal(await client.prepare("SELECT id FROM profiles WHERE id='rollback'").first(),null,'failed batch has no partial writes');
  await client.prepare('CREATE TABLE test_counter(n INTEGER)').run();await client.prepare('INSERT INTO test_counter VALUES(0)').run();
  await Promise.all(Array.from({length:6},()=>new NetlifyD1(()=>store).prepare('UPDATE test_counter SET n=n+1').run()));
  assert.equal(await client.prepare('SELECT n FROM test_counter').first('n'),6,'parallel writes do not lose updates');assert.ok(store.conflicts>0);
  store.forceConflict=true;await client.prepare('UPDATE test_counter SET n=n+1').run();assert.equal(await client.prepare('SELECT n FROM test_counter').first('n'),7,'retry applies SQL once');
  const leases=await Promise.all([client, new NetlifyD1(()=>store)].map(c=>c.prepare('UPDATE test_counter SET n=8 WHERE n=7 RETURNING n').raw()));
  assert.equal(leases.filter(rows=>rows.length).length,1,'conditional leases remain exclusive across instances');
  const batch=await db.batch([db.insert(schema.lists).values({id:'l1',owner:'owner',name:'List',icon:'🥬',createdAt:'now'}).returning()]);assert.equal(batch[0][0].id,'l1');

  const authModule={exports:{}};new Function('require','module','exports',compile('lib/netlify-auth.ts'))(require,authModule,authModule.exports);
  const originModule={exports:{}};new Function('module','exports',compile('lib/request-origin.ts'))(originModule,originModule.exports);
  const originCheck=originModule.exports;
  assert.equal(originCheck.sameRequestOrigin(new Request('http://localhost:3000/api',{headers:{host:'app.example',origin:'https://app.example','x-forwarded-proto':'https'}})),true);
  assert.equal(originCheck.sameRequestOrigin(new Request('http://localhost:3000/api',{headers:{host:'app.example',origin:'https://evil.example','x-forwarded-proto':'https'}})),false);
  const auth=authModule.exports,oldPassword=process.env.APP_PASSWORD,oldSecret=process.env.APP_SESSION_SECRET;
  try {
    delete process.env.APP_PASSWORD;delete process.env.APP_SESSION_SECRET;assert.equal(auth.netlifyAuthConfigured(),false);
    assert.equal(await auth.netlifyUser(new Headers({'oai-authenticated-user-email':'fake@example.invalid'})),null);
    process.env.APP_PASSWORD='test-only-netlify-password';process.env.APP_SESSION_SECRET='test-only-session-secret-with-more-than-32-characters';
    assert.equal(await auth.checkNetlifyPassword('wrong'),false);assert.equal(await auth.checkNetlifyPassword(process.env.APP_PASSWORD),true);
    const token=await auth.createNetlifySession(),headers=new Headers({cookie:auth.SESSION_COOKIE+'='+token});
    assert.equal((await auth.netlifyUser(headers)).userId,'netlify-owner');
    headers.set('cookie',auth.SESSION_COOKIE+'=x'+token.slice(1));assert.equal(await auth.netlifyUser(headers),null);
    const expired=await auth.createNetlifySession(Date.now()-8*86400000);assert.equal(await auth.netlifyUser(new Headers({cookie:auth.SESSION_COOKIE+'='+expired})),null);
    process.env.APP_PASSWORD+='changed';assert.equal(await auth.netlifyUser(new Headers({cookie:auth.SESSION_COOKIE+'='+token})),null,'password change revokes sessions');process.env.APP_PASSWORD='test-only-netlify-password';
    let supplied=new Headers({'oai-authenticated-user-email':'fake@example.invalid'}),identityCalls=0;
    const chat={exports:{}};new Function('require','module','exports',compile('app/chatgpt-auth.ts'))(name=>{
      if(name==='cloudflare:workers')return {env:{APP_RUNTIME:'netlify'}};
      if(name==='next/headers')return {headers:async()=>supplied};
      if(name==='next/navigation')return {redirect:value=>{throw new Error(value);}};
      if(name==='../lib/site-identity')return {resolveSiteIdentity:()=>{identityCalls++;throw new Error('untrusted identity');}};
      if(name==='../lib/netlify-auth')return auth;
      throw new Error(name);
    },chat,chat.exports);
    assert.equal(await chat.exports.getChatGPTUser(),null);assert.equal(identityCalls,0,'forged Sites headers are ignored on Netlify');
    supplied=new Headers({cookie:auth.SESSION_COOKIE+'='+token});assert.equal((await chat.exports.getChatGPTUser()).userId,'netlify-owner');
    assert.equal(chat.exports.chatGPTSignInPath('/'),'/login');
    const session={exports:{}};new Function('require','module','exports',compile('app/api/session/route.ts'))(name=>name==='cloudflare:workers'?{env:{APP_RUNTIME:'netlify'}}:name==='../../../lib/request-origin'?originCheck:auth,session,session.exports);
    assert.equal((await session.exports.POST(new Request('https://app.example/api/session',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/x-www-form-urlencoded'},body:'password=x'}))).status,403);
    const response=await session.exports.POST(new Request('https://app.example/api/session',{method:'POST',headers:{origin:'https://app.example','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:process.env.APP_PASSWORD})}));
    assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/');assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
    const catalog={exports:{}};new Function('require','module','exports',compile('app/api/catalog-refresh/route.ts'))(name=>{
      if(name==='cloudflare:workers')return {env:{APP_RUNTIME:'netlify'}};
      if(name==='../../chatgpt-auth')return {getChatGPTUser:async()=>null};
      if(name==='../../../lib/request-origin')return originCheck;
      if(name==='drizzle-orm')return require(name);
      return {};
    },catalog,catalog.exports);
    assert.equal((await catalog.exports.GET()).status,401);assert.equal((await catalog.exports.POST(new Request('https://app.example/api/catalog-refresh',{method:'POST'}))).status,401,'anonymous refresh cannot touch the database');
  } finally {
    if(oldPassword===undefined)delete process.env.APP_PASSWORD;else process.env.APP_PASSWORD=oldPassword;
    if(oldSecret===undefined)delete process.env.APP_SESSION_SECRET;else process.env.APP_SESSION_SECRET=oldSecret;
  }
  console.log('Netlify checks passed: migrations, persistence across restarts, atomic rollback, concurrent writes, exclusive leases, session expiry/revocation, forged identity rejection, CSRF and private catalog refresh.');
} finally {fs.rmSync(folder,{recursive:true,force:true});}
