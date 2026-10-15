import { foodMap } from './meal-model';
import { matchCatalogFood } from './catalog-prices';
import type { CollectedProduct } from './collector';

// These anonymous read endpoints and the literal /1/1/1?noauth branch are used
// by smart.swnn.ru/static/js/main.36dd3795.js, checked on 2026-10-14.
export const SMART_BASE = 'https://smart.swnn.ru/';
export const SMART_TERRITORY = 18;
export const SMART_STORE = '1750167a-5386-11f1-aa9d-d4f5ef83b49f';
const NN = 'Нижний Новгород';
const api = 'WS/hs/exchange/';
const pageSize = 12; // The site's ordinary default, not an increased API limit.
const maxPages = 500, maxRequests = 3000;
const categories: Record<string, string> = {
 p483:'КРУПЫ',p482:'МАКАРОНЫ',p22:'МУКА, ТОВАРЫ ДЛЯ ВЫПЕЧКИ',p133:'ХЛЕБ',
 p49:'МОЛОКО',p50:'ЙОГУРТЫ',p51:'ТВОРОГ, ТВОРОЖНЫЕ ПРОДУКТЫ',p57:'СЫРЫ',p58:'ЯЙЦО',
 p28:'МЯСО',p29:'ПТИЦА',p40:'РЫБА',p480:'ЗАМОРОЖЕННАЯ РЫБА',
 p63:'ОВОЩИ',p64:'ФРУКТЫ',p66:'ГРИБЫ',p324:'ЗАМОРОЖЕННЫЕ ПРОДУКТЫ',
 p464:'ОВОЩНАЯ',p23:'МАСЛА, УКСУС',p486:'СОЛЬ, САХАР, СПЕЦИИ, ПРИПРАВЫ',p8:'ЗДОРОВОЕ ПИТАНИЕ',
};
export const smartCategories = Object.keys(categories);
export function smartLeafCategories(value:unknown):Record<string,string>{
 const groups=table(value,'ГруппыКатегорий').filter(r=>r.ТипГруппы==='catalog');
 const parents=new Set(groups.map(r=>r.РодительКод));
 const leaves=groups.filter(r=>typeof r.Код==='string'&&/^p\d{1,6}$/.test(r.Код)&&!parents.has(r.Код));
 if(!leaves.length||leaves.length>500||leaves.some(r=>typeof r.Наименование!=='string'||!r.Наименование.trim()))return failure();
 return Object.fromEntries(leaves.map(r=>[r.Код,r.Наименование.trim()]));
}
type ObjectData = Record<string, any>;
export type SmartContext = { territory:18; store:string; city:typeof NN; address:string };
function object(value:unknown): value is ObjectData {return !!value && typeof value==='object' && !Array.isArray(value);}
function failure():never {throw new Error('Официальный каталог Smart изменил формат ответа. Прежние цены сохранены.');}
function successful(value:unknown):ObjectData {if(!object(value)||value.Success!==true||!('Data' in value))return failure();return value;}
function table(value:unknown,name:string):ObjectData[]{
 const d=successful(value);if(!Array.isArray(d.Data))return failure();
 const tables=d.Data.filter((t:unknown)=>object(t)&&t.TableName===name);
 if(tables.length!==1||!Array.isArray(tables[0].Data))return failure();
 if(!tables[0].Data.every(object))return failure();return tables[0].Data;
}
export function verifySmartContext(territories:unknown,stores:unknown):SmartContext {
 const cities=table(territories,'ТерриторииФизическихЛиц');
 const city=cities.find(r=>r.Код===SMART_TERRITORY);
 if(city?.Наименование!==NN||city.ЕстьТорговыйОбъект!==true)throw new Error('Smart не подтвердил территорию Нижний Новгород. Прежние цены сохранены.');
 const data=successful(stores);if(!object(data.Data)||!Array.isArray(data.Data.Дискаунтеры))return failure();
 const matches=data.Data.Дискаунтеры.filter((r:unknown)=>object(r)&&r.Дискаунтер===SMART_STORE);
 const store=matches[0];
 if(matches.length!==1||store.НаселенныйПункт!==NN||store.Адрес!=='Федосеенко, 44А'||typeof store.Наименование!=='string'||!store.Наименование.includes('Новгород'))throw new Error('Smart не подтвердил выбранный магазин: Нижний Новгород, Федосеенко, 44А. Прежние цены сохранены.');
 return {territory:SMART_TERRITORY,store:SMART_STORE,city:NN,address:store.Адрес};
}
function checkContext(context:SmartContext){if(context.territory!==SMART_TERRITORY||context.store!==SMART_STORE||context.city!==NN||context.address!=='Федосеенко, 44А')throw new Error('Регион Smart не подтверждён.');}
export function parseSmartCatalogPage(value:unknown,category:string,context:SmartContext,categoryNames:Record<string,string>=categories,includeUnmapped=false):{products:CollectedProduct[];pageCount:number;rawCount:number}{
 checkContext(context);if(!Object.hasOwn(categoryNames,category))throw new Error('Неизвестная категория Smart.');
 const d=successful(value);if(!Number.isInteger(d.PageCount)||d.PageCount<0||d.PageCount>maxPages)return failure();
 const rows=table(value,'Товары');if(rows.length>pageSize||d.PageCount===0&&rows.length)return failure();
 const products:CollectedProduct[]=[];
 for(const row of rows){
  if(typeof row.Наименование!=='string'||typeof row.Артикул!=='string'||!/^\d{1,12}$/.test(row.Артикул)||typeof row.ЕдИзм!=='string'||typeof row.Цена!=='number'||!Number.isFinite(row.Цена))return failure();
  if(row.Магазин!==null&&row.Магазин!==undefined&&row.Магазин!=='00000000-0000-0000-0000-000000000000'&&row.Магазин!==SMART_STORE)throw new Error('Smart вернул товар другого магазина. Прежние цены сохранены.');
  // ЕдИзм is the unit displayed next to the price by the website. The Вес
  // field is deliberately not a millilitre conversion or an inferred pack.
  const unit=row.ЕдИзм;if(!['кг','шт'].includes(unit)||row.Цена<=0||row.Цена>1000000||row.МаксКолво===0)continue;
  const name=row.Наименование.slice(0,200),mapped=matchCatalogFood(name,unit);if(!mapped&&!includeUnmapped)continue;
  if(mapped?.foodId==='potato'&&/батат/i.test(name))continue;
  const price=Math.round(row.Цена*100);if(price<=0||Math.abs(row.Цена*100-price)>0.000001)return failure();
  // ЦенаСоСкидкой and Тег include card, quantity and otherwise unspecified
  // conditions. Until all conditions are proved, use the visible ordinary
  // Цена. ДатаОкончания refers to a promotion, not to that ordinary quote.
  // Квант is present in JSON but not used by this retail site's amount UI;
  // it is not evidence of a minimum weight, pack count or purchase step.
  products.push({name,price,regularPrice:null,unit,barcode:null,image:null,url:new URL('product/'+row.Артикул,SMART_BASE).href,category:mapped?foodMap.get(mapped.foodId)!.category:categoryNames[category],foodId:mapped?.foodId??null,packQuantity:mapped?.packQuantity??null,minPacks:1,minQuantity:null,quantityStep:null,loyaltyRequired:0,validFrom:null,validTo:null,priceKind:'official-catalog',regionVerified:1});
 }
 return {products,pageCount:d.PageCount,rawCount:rows.length};
}
export type SmartSnapshot={kind:'smart-v2';context:SmartContext;robots:string;startedAt:string;calls:number;scanned:number;categories:Record<string,string>;pending:{category:string;page:number}[];pageCounts:Record<string,number>;received:Record<string,number>;products:CollectedProduct[];failures?:number};
export async function advanceSmartCatalog(request:(url:URL,body?:Record<string,unknown>)=>Promise<string>,robotsAllows:(robots:string,path:string)=>boolean,snapshot?:SmartSnapshot,pageBudget=4):Promise<{snapshot:SmartSnapshot;done:boolean;products:CollectedProduct[]}>{
 const base=new URL(SMART_BASE),pause=()=>new Promise(resolve=>setTimeout(resolve,2000));
 let state=snapshot;
 if(state&&(state.kind!=='smart-v2'||Date.now()-Date.parse(state.startedAt)>2*3600000))state=undefined;
 if(state){checkContext(state.context);if(!state.categories||!Array.isArray(state.pending)||!Array.isArray(state.products)||state.pending.some(t=>!Object.hasOwn(state!.categories,t.category)||!Number.isInteger(t.page)||t.page<1||t.page>maxPages))throw new Error('Черновик чтения Smart повреждён. Прежние цены сохранены.');}
 const robots=state?.robots??await request(new URL('/robots.txt',base));
 const allowed=(path:string)=>{const u=new URL(path,base);if(u.origin!==base.origin||!robotsAllows(robots,u.pathname+u.search))throw new Error('Правила Smart запрещают чтение этого электронного каталога.');return u;};
 let calls=state?.calls||0;
 const read=async(path:string,body?:Record<string,unknown>)=>{if(++calls>maxRequests)throw new Error('Каталог Smart превышает безопасный объём обновления. Прежние цены сохранены.');return JSON.parse(await request(allowed(path),body));};
 if(!state){
  await pause();
  const [territories,stores]=await Promise.all([read(api+'getTerritoriesIndividuals/?fromSite'),read(api+'getStores/1/1/1?noauth')]);
  const context=verifySmartContext(territories,stores);
  await pause();
  const groupResponse=await read(api+'getCatalogGroups/1/1/1?noauth',{'ТипДоставки':'БезДоставки'}),groups=table(groupResponse,'ГруппыКатегорий');
  for(const id of smartCategories){const matches=groups.filter(r=>r.Код===id&&r.ТипГруппы==='catalog');if(matches.length!==1||matches[0].Наименование.trim()!==categories[id])throw new Error('Структура категорий Smart изменилась. Прежние цены сохранены.');}
  const allCategories=smartLeafCategories(groupResponse);
  state={kind:'smart-v2',context,robots,startedAt:new Date().toISOString(),calls,scanned:0,categories:allCategories,pending:Object.keys(allCategories).map(category=>({category,page:1})),pageCounts:{},received:{},products:[]};
 }
 // Store the draft between short requests. Only the complete snapshot is
 // promoted to products/lastSuccess by service.ts; private lists are untouched.
 let processed=0;
 while(state.pending.length&&processed<pageBudget){
  await pause();const tasks=state.pending.slice(0,Math.min(2,pageBudget-processed));
  const batch=await Promise.all(tasks.map(async task=>{
   const body={'Дискаунтер':true,'КодТерритории':state!.context.territory,'ТорговыйОбъект':state!.context.store,'ТипДоставки':'БезДоставки','ТипГруппы':'catalog','КодГруппы':task.category,'НомерСтраницы':task.page,'РазмерСтраницы':pageSize,'КодСортировки':1,'ЗначенияФильтров':[]};
   return {...task,...parseSmartCatalogPage(await read(api+'getItems/1/1/1?noauth',body),task.category,state!.context,state!.categories,true)};
  }));
  state.pending.splice(0,tasks.length);processed+=tasks.length;
  for(const page of batch){
   if(page.page===1){state.pageCounts[page.category]=page.pageCount;for(let n=2;n<=page.pageCount;n++)state.pending.push({category:page.category,page:n});if(calls+state.pending.length>maxRequests)throw new Error('Каталог Smart превышает безопасный объём обновления. Прежние цены сохранены.');}
   else if(state.pageCounts[page.category]!==page.pageCount)throw new Error('Во время чтения состав каталога Smart изменился. Прежние цены сохранены.');
   if(page.pageCount>page.page&&page.rawCount!==pageSize||page.pageCount>0&&page.rawCount===0)throw new Error('Smart вернул неполную страницу каталога. Прежние цены сохранены.');
   state.received[page.category]=(state.received[page.category]||0)+1;state.scanned+=page.rawCount;state.products.push(...page.products);
  }
 }
 state.calls=calls;state.products=[...new Map(state.products.map(row=>[row.url,row])).values()];
 if(JSON.stringify(state).length>20000000)throw new Error('Черновая выгрузка Smart превышает безопасный размер. Прежние цены сохранены.');
 const done=state.pending.length===0;
 if(done){for(const id of Object.keys(state.categories))if(state.received[id]!==Math.max(1,state.pageCounts[id]||0))throw new Error('Не все страницы Smart были прочитаны. Прежние цены сохранены.');if(!state.products.length)throw new Error('Каталог Smart не вернул товаров для Нижнего Новгорода. Прежние цены сохранены.');}
 return {snapshot:state,done,products:done?state.products:[]};
}
export async function collectSmartCatalog(request:(url:URL,body?:Record<string,unknown>)=>Promise<string>,robotsAllows:(robots:string,path:string)=>boolean):Promise<CollectedProduct[]>{let snapshot:SmartSnapshot|undefined;for(;;){const result=await advanceSmartCatalog(request,robotsAllows,snapshot,4);if(result.done)return result.products;snapshot=result.snapshot;}}
