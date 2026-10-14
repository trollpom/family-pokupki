import ts from 'typescript';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.resolve('node_modules/.smart-catalog-checks-'));
const fixture=name=>JSON.parse(fs.readFileSync('tests/fixtures/smart-'+name+'.json','utf8'));
const clone=value=>structuredClone(value);
const originalTimeout=globalThis.setTimeout;
try{
 for(const name of ['model','meal-model','catalog-prices','smart-catalog'])fs.writeFileSync(path.join(dir,name+'.js'),ts.transpileModule(fs.readFileSync('lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
 const require=createRequire(import.meta.url),s=require(path.join(dir,'smart-catalog.js'));
 const territories=fixture('territories'),stores=fixture('stores'),context=s.verifySmartContext(territories,stores);
 assert.equal(context.territory,18);assert.equal(context.city,'Нижний Новгород');assert.equal(context.address,'Федосеенко, 44А');
 const wrongCity=clone(territories);wrongCity.Data[0].Data[0].Наименование='Москва';assert.throws(()=>s.verifySmartContext(wrongCity,stores),/не подтвердил территорию/);
 const wrongStore=clone(stores);wrongStore.Data.Дискаунтеры[0].НаселенныйПункт='Дзержинск';assert.throws(()=>s.verifySmartContext(territories,wrongStore),/не подтвердил выбранный магазин/);
 const vegetables=s.parseSmartCatalogPage(fixture('items-p63'),'p63',context);assert.equal(vegetables.pageCount,2);assert.equal(vegetables.rawCount,12);
 const potato=vegetables.products.find(r=>r.foodId==='potato');assert.equal(potato.price,2990);assert.equal(potato.unit,'кг');assert.equal(potato.packQuantity,1000);assert.equal(potato.regionVerified,1);assert.equal(potato.minQuantity,null);assert.equal(potato.quantityStep,null);assert.equal(potato.priceKind,'official-catalog');
 const grain=s.parseSmartCatalogPage(fixture('items-p483'),'p483',context).products;
 const rice=grain.find(r=>r.url.endsWith('/117467'));assert.equal(rice.price,9990);assert.equal(rice.packQuantity,900);
 const oats=grain.find(r=>r.url.endsWith('/133431'));assert.equal(oats.price,4790);assert.equal(oats.packQuantity,400);assert.equal(oats.minPacks,1,'Квант6 does not prove a retail minimum');
 const baggedRice=grain.find(r=>r.url.endsWith('/133432'));assert.equal(baggedRice.packQuantity,400);
 const cardQuantityGrain=grain.find(r=>r.url.endsWith('/107299'));assert.equal(cardQuantityGrain.price,5290,'the45.90 card5-pack offer is not applied to an ordinary purchase');assert.equal(cardQuantityGrain.minPacks,1);assert.equal(cardQuantityGrain.loyaltyRequired,0);assert.equal(cardQuantityGrain.validTo,null);
 const milk=s.parseSmartCatalogPage(fixture('items-p49'),'p49',context).products;
 const promotedMilk=milk.find(r=>r.url.endsWith('/123714'));assert.equal(promotedMilk.price,8490,'unspecified79.90 discount is not applied');assert.equal(promotedMilk.regularPrice,null);assert.equal(promotedMilk.loyaltyRequired,0);assert.equal(promotedMilk.validTo,null);
 assert(!milk.some(r=>r.url.endsWith('/130267')),'milk grams are not converted into ml');
 const wrongRegion=clone(fixture('items-p63'));wrongRegion.Data[0].Data[0].Магазин='other-store';assert.throws(()=>s.parseSmartCatalogPage(wrongRegion,'p63',context),/другого магазина/);
 const malformed=clone(fixture('items-p63'));malformed.PageCount=1000;assert.throws(()=>s.parseSmartCatalogPage(malformed,'p63',context),/формат/);
 const stringPrice=clone(fixture('items-p63'));stringPrice.Data[0].Data[0].Цена='31.9';assert.throws(()=>s.parseSmartCatalogPage(stringPrice,'p63',context),/формат/);
 const changedUnit=clone(fixture('items-p63'));changedUnit.Data[0].Data[0].ЕдИзм='уп';assert(!s.parseSmartCatalogPage(changedUnit,'p63',context).products.some(r=>r.url.endsWith('/102654')));
 // Integration validates the actual anonymous API paths and region/store
 // payload, full pagination and atomic aborts. Non-vegetable category pages
 // below are synthetic empty responses; they are never real price fixtures.
 globalThis.setTimeout=(callback,delay,...args)=>originalTimeout(callback,delay===2000?0:delay,...args);
 const seen=[];
 async function request(url,body){
  assert.equal(url.origin,'https://smart.swnn.ru');seen.push({path:url.pathname,search:url.search,body});
  if(url.pathname==='/robots.txt')return 'User-agent: *\nDisallow:\n';
  if(url.pathname.endsWith('/getTerritoriesIndividuals/'))return JSON.stringify(territories);
  if(url.pathname.endsWith('/getStores/1/1/1'))return JSON.stringify(stores);
  if(url.pathname.endsWith('/getCatalogGroups/1/1/1'))return JSON.stringify(fixture('groups'));
  assert(url.pathname.endsWith('/getItems/1/1/1'));assert.equal(url.search,'?noauth');assert.equal(body.КодТерритории,18);assert.equal(body.ТорговыйОбъект,s.SMART_STORE);assert.equal(body.Дискаунтер,true);assert.equal(body.ТипДоставки,'БезДоставки');assert.equal(body.РазмерСтраницы,12);
  if(body.КодГруппы==='p63')return JSON.stringify(fixture(body.НомерСтраницы===1?'items-p63':'items-p63-page2'));
  return JSON.stringify({Success:true,PageCount:0,Data:[{TableName:'Товары',Data:[]}]});
 }
 const all=await s.collectSmartCatalog(request,()=>true);assert(all.length>vegetables.products.length);assert(seen.some(r=>r.body?.НомерСтраницы===2));assert.equal(seen.filter(r=>r.path.endsWith('/getItems/1/1/1')).length,s.smartCategories.length+1);
 let protectedCalls=0;await assert.rejects(s.collectSmartCatalog(async(...args)=>{if(++protectedCalls>4)throw new Error('HTTP403');return request(...args)},()=>true),/HTTP403/);
 await assert.rejects(s.collectSmartCatalog(request,()=>false),/Правила Smart/);
 await assert.rejects(s.collectSmartCatalog(async(url,body)=>{if(body?.КодГруппы==='p63'&&body.НомерСтраницы===2)return JSON.stringify({...fixture('items-p63-page2'),PageCount:3});return request(url,body)},()=>true),/состав каталога Smart изменился/);
 console.log('Smart checks passed: factual NN territory/store, ordinary prices/units, no inferred quantity or discount conditions, all-page pagination and atomic access/format failures.');
}finally{globalThis.setTimeout=originalTimeout;fs.rmSync(dir,{recursive:true,force:true});}
