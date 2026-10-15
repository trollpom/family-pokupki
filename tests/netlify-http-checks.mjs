import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

// Test the compiled Next.js server and the real Blobs SDK against a local
// protocol fixture, without a Netlify account or live household records.
const blobs=new Map();let version=0,child,logs='';
const storage=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer test-only-token'){res.writeHead(401);res.end();return;}
  const key=req.url,entry=blobs.get(key);
  if(req.method==='GET'){
    if(!entry){res.writeHead(404);res.end();return;}
    res.writeHead(200,{etag:entry.etag});res.end(entry.bytes);return;
  }
  if(req.method==='PUT'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    if((req.headers['if-none-match']==='*'&&entry)||
      (req.headers['if-match']&&req.headers['if-match']!==entry?.etag)){res.writeHead(412);res.end();return;}
    const etag='"'+(++version)+'"';blobs.set(key,{bytes:Buffer.concat(chunks),etag});res.writeHead(200,{etag});res.end();return;
  }
  res.writeHead(405);res.end();
});
await new Promise(resolve=>storage.listen(0,'127.0.0.1',resolve));
const storageURL='http://127.0.0.1:'+storage.address().port;
const portProbe=createServer();await new Promise(resolve=>portProbe.listen(0,'127.0.0.1',resolve));
const port=portProbe.address().port;await new Promise(resolve=>portProbe.close(resolve));
const origin='http://127.0.0.1:'+port;
const env={...process.env,NODE_ENV:'production',APP_PASSWORD:'test-only-netlify-password',
  APP_SESSION_SECRET:'test-only-session-secret-with-more-than-32-characters',
  AI_SECRET_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64'),
  NETLIFY_BLOBS_CONTEXT:Buffer.from(JSON.stringify({siteID:'test-site',token:'test-only-token',edgeURL:storageURL,uncachedEdgeURL:storageURL})).toString('base64')};
async function start(){
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',v=>logs=(logs+v).slice(-15000));child.stderr.on('data',v=>logs=(logs+v).slice(-15000));
  for(let i=0;i<150;i++){
    if(child.exitCode!==null)throw new Error('Next.js server exited');
    try{const r=await fetch(origin+'/login');if(r.status===200)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Next.js server did not start');
}
async function stop(){if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}child=undefined;}
try {
  await start();
  const anonymous=await fetch(origin+'/',{redirect:'manual'});assert.equal(anonymous.status,307);assert.equal(anonymous.headers.get('location'),'/login');
  assert.equal((await fetch(origin+'/api/app',{headers:{'oai-authenticated-user-email':'fake@example.invalid'}})).status,401);
  assert.equal((await fetch(origin+'/api/catalog-refresh')).status,401);
  const login=await fetch(origin+'/api/session',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password:env.APP_PASSWORD}),redirect:'manual'});
  assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={cookie,origin,'content-type':'application/json'};
  const state=await fetch(origin+'/api/app',{headers});assert.equal(state.status,200);assert.ok((await state.json()).lists);
  const created=await fetch(origin+'/api/app',{method:'POST',headers,body:JSON.stringify({action:'createList',name:'Netlify persistence test',budget:150000})});
  assert.equal(created.status,200);const {id}=await created.json();assert.ok(id);
  const planner=await fetch(origin+'/api/planner',{headers});assert.equal(planner.status,200);assert.equal((await planner.json()).ai.configured,false);
  const masked=await fetch(origin+'/api/planner',{method:'POST',headers,body:JSON.stringify({action:'saveAI',key:'sk-****************',model:'deepseek-flash'})});
  assert.equal(masked.status,400);const keyError=await masked.json();assert.match(keyError.error,/скрытый/);assert.ok(!keyError.error.includes('sk-****************'),'key validation never echoes credentials');
  assert.equal((await fetch(origin+'/',{headers})).status,200,'server-rendered home works with real SDK and session');
  await stop();await start();
  const restored=await fetch(origin+'/api/app',{headers});assert.equal(restored.status,200);assert.ok((await restored.json()).lists.some(list=>list.id===id),'list survives Next.js process restart');
  await stop();env.DEEPSEEK_API_KEY='test-only-http-server-key';await start();
  const serverAiResponse=await fetch(origin+'/api/planner',{headers});assert.equal(serverAiResponse.status,200);const serverAi=await serverAiResponse.json();assert.equal(serverAi.ai.configured,true);assert.equal(serverAi.ai.source,'server');assert.ok(!JSON.stringify(serverAi).includes(env.DEEPSEEK_API_KEY),'server key is not returned by API');
  const serverSave=await fetch(origin+'/api/planner',{method:'POST',headers,body:JSON.stringify({action:'saveAI',key:'test-only-http-input',model:'deepseek-flash'})});assert.equal(serverSave.status,400);assert.match((await serverSave.json()).error,/сервер/);
  for(const entry of blobs.values())assert.ok(!entry.bytes.includes(Buffer.from(env.DEEPSEEK_API_KEY)),'server key is not persisted to SQLite snapshots');
  console.log('Netlify HTTP checks passed: production Next.js login, protected APIs, server rendering, real Blobs SDK, shopping list persistence across server restart.');
} catch(error){console.error(logs);throw error;}
finally{await stop();await new Promise(resolve=>storage.close(resolve));}
