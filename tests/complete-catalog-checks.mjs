import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {catalogJobHeaders,verifyCatalogJob,catalogJobOrigin} from '../lib/catalog-job-auth.mjs';
import catalogueSchedule from '../netlify/functions/catalog-schedule.mjs';
import catalogueWorker from '../netlify/functions/catalog-worker.mjs';
const folder=fs.mkdtempSync(path.resolve('node_modules/.complete-catalog-checks-')),realTimeout=globalThis.setTimeout;
try{
 for(const n of ['model','meal-model','catalog-prices','spar-search','smart-catalog','magnit-catalog'])fs.writeFileSync(path.join(folder,n+'.js'),ts.transpileModule(fs.readFileSync('lib/'+n+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
 const require=createRequire(import.meta.url),s=require(path.join(folder,'spar-search.js')),smart=require(path.join(folder,'smart-catalog.js')),m=require(path.join(folder,'magnit-catalog.js')),c=require(path.join(folder,'catalog-prices.js'));
 const fixture=name=>JSON.parse(fs.readFileSync('tests/fixtures/'+name+'.json','utf8'));
 const store=fixture('magnit-store-nn'),page=fixture('magnit-goods-nn');
 assert.equal(m.verifyMagnitStore(store).store,'522856');assert.throws(()=>m.verifyMagnitStore({...store,cityFiasId:'wrong-city'}),/не подтвердил магазин/);
 const parsed=m.parseMagnitCatalogPage(page,0,new Date('2026-10-15T12:00:00Z'));
 assert.equal(parsed.total,4771);assert.equal(parsed.rawCount,34);assert.equal(parsed.nextOffset,34);
 const onion=parsed.products.find(p=>p.foodId==='onion');assert.equal(onion.price,3959,'per-kg price, not the 700g shelf price');assert.equal(onion.packQuantity,1000);assert.equal(onion.unit,'кг');assert.equal(onion.loyaltyRequired,1);
 assert.ok(parsed.products.some(p=>p.foodId==='chicken'));assert.ok(!parsed.products.some(p=>p.url.includes('/3412100007-')),'zero stock and expired promotion excluded');
 const wrong=structuredClone(page);wrong.items[0].storeCode='992301';assert.throws(()=>m.parseMagnitCatalogPage(wrong,0),/другой витрины/);
 const filteredPage=fixture('magnit-goods-filtered-nn'),filtered=m.parseMagnitCatalogPage(filteredPage,4088);assert.equal(filtered.rawCount,17);assert.equal(filtered.nextOffset,4155);assert.deepEqual(filtered.products,[],'age-restricted rows never become shopping offers');
 const cursorPage=fixture('magnit-goods-cursor-nn');assert.equal(m.parseMagnitCatalogPage(cursorPage,1530).nextOffset,1565,'real 34-row page advances by 35 server positions');
 for(const nextOffset of [1530,1531,1564.5,50001])assert.throws(()=>m.parseMagnitCatalogPage({...cursorPage,pagination:{...cursorPage.pagination,nextOffset}},1530),/указатель продолжения/);
 globalThis.setTimeout=(fn,delay,...args)=>realTimeout(fn,delay===2000?0:delay,...args);
 const smallFirst={...page,pagination:{...page.pagination,totalCount:35}},smallLast={...page,items:[{...page.items[0],id:'100000000000001',quantity:1}],pagination:{limit:34,offset:34,totalCount:35,hasMore:false,nextOffset:null}};
 const calls=[];const request=async(u,body)=>{calls.push({url:u.href,body});if(u.pathname==='/robots.txt')return 'User-agent: *\nAllow: /\nDisallow: /*search';if(u.pathname.endsWith('/store'))return JSON.stringify(store);return JSON.stringify(body.pagination.offset===0?smallFirst:smallLast);};
 let stage=await m.advanceMagnitCatalog(request,()=>true,undefined,1);assert.equal(stage.done,false);assert.deepEqual(stage.products,[],'no partial inventory is published');
 stage=await m.advanceMagnitCatalog(request,()=>true,stage.snapshot,1);assert.equal(stage.done,true);assert.equal(stage.snapshot.scanned,35);assert.equal(calls.at(-1).body.storeCode,'522856');assert.equal(calls.at(-1).body.includeAdultGoods,false);
 const cursorCalls=[],cursorRequest=async(u,body)=>{if(u.pathname==='/robots.txt')return '';if(u.pathname.endsWith('/store'))return JSON.stringify(store);cursorCalls.push(body.pagination.offset);return JSON.stringify(body.pagination.offset===0?{...page,pagination:{...page.pagination,totalCount:36,nextOffset:35}}:{...smallLast,pagination:{limit:34,offset:35,totalCount:36,hasMore:false,nextOffset:null}});};
 let cursorStage=await m.advanceMagnitCatalog(cursorRequest,()=>true,undefined,1);assert.deepEqual(cursorStage.snapshot.pending,[{offset:35}]);cursorStage=await m.advanceMagnitCatalog(cursorRequest,()=>true,cursorStage.snapshot,1);assert.equal(cursorStage.done,true);assert.deepEqual(cursorCalls,[0,35],'saved checkpoint follows the server cursor rather than offset + limit');
 const filteredDraft={...cursorStage.snapshot,pending:[{offset:4088}],signatures:[]};const filteredStage=await m.advanceMagnitCatalog(async()=>JSON.stringify(filteredPage),()=>true,filteredDraft,1);assert.equal(filteredStage.done,false);assert.deepEqual(filteredStage.snapshot.pending,[{offset:4155}]);assert.deepEqual(filteredStage.products,[],'filtered page continues without publishing a partial catalogue');
 const emptyPage={...filteredPage,items:[]};assert.equal(m.parseMagnitCatalogPage(emptyPage,4088).nextOffset,4155,'empty filtered page is not the end');
 await assert.rejects(()=>m.advanceMagnitCatalog(request,()=>false),/Правила Магнита/);
 const groups=smart.smartLeafCategories(fixture('smart-groups-full'));assert.ok(Object.keys(groups).length>100);for(const id of ['p15','p491','p484','p83'])assert.ok(groups[id],'previously omitted food category '+id);
 // Synthetic search inventory proves offset traversal beyond the former 15-row cap.
 const sparItem=fixture('spar-search-nn')[0].products[0],seen=[];
 const search=async u=>{if(u.pathname==='/robots.txt')return '';const query=u.searchParams.get('query'),offset=Number(u.searchParams.get('offset'));seen.push({query,offset});const total=query==='рис'?16:0;const products=total?Array.from({length:offset===0?15:1},(_,i)=>({...sparItem,id:'test-'+(offset+i),url:sparItem.url.replace('/ris-dlinnozernyy-spar-900g/','/rice-'+(offset+i)+'/')})):[];return JSON.stringify({query,total,products});};
 let snapshot;do{const r=await s.advanceSparSearch(search,()=>true,snapshot,4);snapshot=r.snapshot;if(r.done)break;assert.deepEqual(r.products,[]);}while(true);
 assert.ok(seen.some(r=>r.query==='рис'&&r.offset===15));assert.equal(snapshot.received['рис'],16);assert.ok(s.sparQueries.includes('орехи'));assert.ok(s.sparQueries.includes('нут консервированный'));assert.ok(s.sparQueries.includes('молоко соевое'));
 assert.equal(c.matchCatalogFood('Напиток соевый 1л').foodId,'plantmilk');assert.equal(c.matchCatalogFood('Фундук очищенный 200г').foodId,'nuts');assert.equal(c.matchCatalogFood('Фундук соленый 200г'),null);
 assert.equal(c.matchCatalogFood('Фасоль натуральная 400г, масса основного продукта 240г').packQuantity,240);assert.equal(c.matchCatalogFood('Фасоль натуральная 400г'),null,'no invented drained weight');
 for(const name of ['Мука Makfa Пшеничная 1кг','Мука Нижегородская пшеничная хлебопекарная высший сорт 1кг'])assert.deepEqual(c.matchCatalogFood(name),{foodId:'flour',packQuantity:1000,variableWeight:false});
 assert.equal(c.matchCatalogFood('Мука Пшеничная 2кг в ассортименте').packQuantity,2000,'assortment wording is not an assorted ingredient mix');
 assert.equal(c.matchCatalogFood('Хлопья Ясно солнышко Овсяные №2 500г').foodId,'oats');assert.equal(c.matchCatalogFood('Хлопья Моя цена Геркулес овсяные 400г').packQuantity,400);
 for(const name of ['Мука рисовая Кудесница 500г','Мука пшеничная и рисовая 500г','Мука блинная пшеничная 1кг','Хлопья овсяные пшеничные 500г','Хлопья овсяные с сахаром 500г','Мука пшеничная ассорти 2кг'])assert.equal(c.matchCatalogFood(name),null);
 const oldDraft={...cursorStage.snapshot,products:[{...parsed.products[0],name:'Мука Makfa Пшеничная 1кг',unit:'шт',foodId:null,packQuantity:null}]};const reclassified=await m.advanceMagnitCatalog(()=>{throw new Error('completed draft must not refetch')},()=>true,oldDraft,1);assert.equal(reclassified.products[0].foodId,'flour');assert.equal(reclassified.products[0].packQuantity,1000);
 const secret='test-only-job-secret-with-more-than-32-characters',now=Date.now(),headers=await catalogJobHeaders(secret,now),req=new Request('https://test.netlify.app/api/catalog-refresh',{method:'POST',headers});
 assert.equal(await verifyCatalogJob(req,secret,now),true);assert.equal(await verifyCatalogJob(req,'wrong-secret-with-more-than-32-characters',now),false);assert.equal(await verifyCatalogJob(req,secret,now+6*60000),false);assert.equal(await verifyCatalogJob(new Request(req.url,{headers}),secret,now),false);assert.equal(catalogJobOrigin({URL:'https://test.netlify.app/path'}),'https://test.netlify.app');assert.throws(()=>catalogJobOrigin({URL:'http://localhost'}));
 const originalFetch=globalThis.fetch,oldSecret=process.env.APP_SESSION_SECRET,oldURL=process.env.URL;process.env.APP_SESSION_SECRET=secret;process.env.URL='https://test.netlify.app';
 try{
  let jobs=0;globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://test.netlify.app/.netlify/functions/catalog-worker');assert.equal(await verifyCatalogJob(new Request(String(url),init),secret),true);jobs++;return new Response(null,{status:202});};
  await catalogueSchedule();assert.equal(jobs,1);
  let batches=0;globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://test.netlify.app/api/catalog-refresh');assert.equal(await verifyCatalogJob(new Request(String(url),init),secret),true);batches++;return Response.json({results:[{continuing:batches===1}]});};
  await catalogueWorker(new Request('https://test.netlify.app/.netlify/functions/catalog-worker',{method:'POST',headers:await catalogJobHeaders(secret)}));assert.equal(batches,2,'background worker continues saved batches without an open browser');
  await catalogueWorker(new Request('https://test.netlify.app/.netlify/functions/catalog-worker',{method:'POST'}));assert.equal(batches,2,'unsigned request cannot start retailer traffic');
 }finally{globalThis.fetch=originalFetch;if(oldSecret===undefined)delete process.env.APP_SESSION_SECRET;else process.env.APP_SESSION_SECRET=oldSecret;if(oldURL===undefined)delete process.env.URL;else process.env.URL=oldURL;}
 console.log('Complete catalogue checks passed: real Magnit store/prices/weight/card/stock fixtures, all-page checkpoints, all Smart leaf categories, full SPAR ingredient search, conservative units and signed catalogue-only jobs.');
}finally{globalThis.setTimeout=realTimeout;fs.rmSync(folder,{recursive:true,force:true});}
