import { foodMap } from './meal-model';
import { matchCatalogFood } from './catalog-prices';
import type { CollectedProduct } from './collector';
// Public search service loaded by myspar.ru/catalog/. On 2026-10-14 the site's
// selected Нижний Новгород header exposed city 44 and shop-code 1510. No browser
// cookies, authentication credentials or CAPTCHA bypass are used by this reader.
export const SPAR_SEARCH='https://search-myspar.ext-geoprod.1221sys.ru/';
export const SPAR_LOCATION='1510';
// Every planner ingredient has a query. Each result is read to its last page;
// this is an ingredient search inventory, not a claim to index non-food goods.
export const sparQueries=['овсяные хлопья','рис','гречка','пшено','макароны','хлеб','мука пшеничная','молоко','йогурт натуральный','сыр российский','творог','яйцо куриное','филе куриное','филе индейки','филе минтая','говядина','картофель','морковь','лук репчатый','томаты','огурцы','перец сладкий','кабачки','капуста белокочанная','тыква','брокколи','шампиньоны','яблоки','бананы','авокадо','чечевица','фасоль консервированная','нут консервированный','тофу','молоко соевое','орехи','масло подсолнечное','соль','сахар'] as const;
function rubles(value:unknown){if(typeof value!=='string')return null;const clean=value.replace(/[\s\u00a0]/g,'').replace(/₽$/,'');if(!/^\d+(?:[.,]\d{1,2})?$/.test(clean))return null;const n=Math.round(Number(clean.replace(',','.'))*100);return n>0&&n<=100000000?n:null;}
const rawCategories:Record<string,string[]>={
 rice:['krupy','krupy-makarony-i-sukhie-zavtraki-spar'],buckwheat:['krupy','krupy-makarony-i-sukhie-zavtraki-spar'],millet:['krupy'],lentils:['krupy'],oats:['krupy','kashi-gotovye-zavtraki','krupy-makarony-i-sukhie-zavtraki-spar'],pasta:['makarony','krupy-makarony-i-sukhie-zavtraki-spar','makarony-ris-import'],flour:['muka','muka-1'],
 milk:['moloko','molochnaya-produktsiya-i-yaytso-spar'],eggs:['yaytso','yaytsa','molochnaya-produktsiya-i-yaytso-spar'],cottage:['tvorog','tvorog-syrki','tvorozhnye-produkty'],yogurt:['yogurty','yogurty-tvorozhki-deserty'],chicken:['ptitsa'],turkey:['indeyka'],beef:['govyadina-telyatina'],fish:['zamorozhennaya-ryba-2025','zamorozhennaya-ryba','okhlazhdennaya-ryba-2025'],
};
export function parseSparSearch(data:any,query:string):CollectedProduct[]{
 if(!data||data.query!==query||!Array.isArray(data.products)||data.products.length>100||!Number.isInteger(data.total)||data.total<0)throw new Error('Штатный поиск SPAR изменил формат ответа. Прежние цены сохранены.');
 const out:CollectedProduct[]=[];
 for(const p of data.products){
  if(typeof p.name!=='string'||!Array.isArray(p.location?.id)||!p.location.id.map(String).includes(SPAR_LOCATION))continue;
  const price=rubles(p.price),old=rubles(p.price_old);if(!price)continue;let url:URL;try{url=new URL(p.url);}catch{continue;}
  if(url.protocol!=='https:'||url.hostname!=='myspar.ru'||url.username||url.password||url.port||!url.pathname.startsWith('/catalog/'))continue;
  const name=p.name.slice(0,200),unit=p.unit?.name;if(!['шт','кг'].includes(unit))continue;const mapped=matchCatalogFood(name,unit);if(!mapped)continue;
  const category=url.pathname.split('/')[2];
  if(/vtorye-blyuda|aziatskaya|domashnyaya|obedy|uzhiny|^zavtraki$|barbekyu|myasnye-delikatesy|myaso-dlya-barbekyu|salaty|myasnaya/.test(category))continue;
  if(rawCategories[mapped.foodId]&&!rawCategories[mapped.foodId].includes(category)&&!['supertsena','super-price','aktsii'].includes(category))continue;
  if(mapped.foodId==='potato'&&/батат/.test(name.toLowerCase()))continue;
  const minimum=Number(p.unit.min??1),step=Number(p.unit.ratio??1);
  if(!Number.isFinite(minimum)||!Number.isFinite(step)||minimum<=0||step<=0||minimum>100||step>100)continue;
  if(unit==='шт'&&(!Number.isInteger(minimum)||!Number.isInteger(step)||step!==1))continue;
  const tags=JSON.stringify(p.tags||[]),discount=!!old&&old>price;
  out.push({name,price,regularPrice:discount?old:null,unit,barcode:null,image:null,url:url.href,category:foodMap.get(mapped.foodId)!.category,foodId:mapped.foodId,packQuantity:mapped.packQuantity,minPacks:unit==='шт'?minimum:1,minQuantity:unit==='кг'?minimum*1000:null,quantityStep:unit==='кг'?step*1000:null,loyaltyRequired:discount||/по карте|с картой|при покупке/i.test(tags)?1:0,validFrom:null,validTo:null,priceKind:'official-search',regionVerified:1});
 }
 return out;
}
export type SparSnapshot={kind:'spar-v2';startedAt:string;robots:string;calls:number;scanned:number;catalogChanges?:number;pending:{query:string;offset:number}[];totals:Record<string,number>;received:Record<string,number>;signatures:Record<string,string[]>;products:CollectedProduct[];failures?:number};
export async function advanceSparSearch(download:(url:URL,missingRobots?:boolean)=>Promise<string>,robotsAllows:(robots:string,path:string)=>boolean,snapshot?:SparSnapshot,pageBudget=4):Promise<{snapshot:SparSnapshot;done:boolean;products:CollectedProduct[]}>{
 const base=new URL(SPAR_SEARCH),pageSize=15,maxRequests=2000;
 let state=snapshot;
 if(state&&(state.kind!=='spar-v2'||Date.now()-Date.parse(state.startedAt)>2*3600000))state=undefined;
 if(!state){const robots=await download(new URL('/robots.txt',base),true);state={kind:'spar-v2',robots,startedAt:new Date().toISOString(),calls:0,scanned:0,pending:sparQueries.map(query=>({query,offset:0})),totals:{},received:{},signatures:{},products:[]};}
 if(!Array.isArray(state.pending)||state.pending.some(t=>!(sparQueries as readonly string[]).includes(t.query)||!Number.isInteger(t.offset)||t.offset<0||t.offset%pageSize)||!Array.isArray(state.products))throw new Error('Черновик чтения SPAR повреждён. Прежние цены сохранены.');
 let processed=0;
 while(state.pending.length&&processed<pageBudget){
  const tasks=state.pending.slice(0,Math.min(2,pageBudget-processed));
  if(state.calls+tasks.length>maxRequests)throw new Error('Поиск SPAR превысил лимит страниц. Загрузка не считается завершённой.');
  await new Promise(resolve=>setTimeout(resolve,2000));
  const batch=await Promise.all(tasks.map(async task=>{
   const u=new URL(base);u.search=new URLSearchParams({query:task.query,location:SPAR_LOCATION,isWeb:'true',limit:String(pageSize),offset:String(task.offset)}).toString();
   if(!robotsAllows(state!.robots,u.pathname+u.search))throw new Error('Правила сервиса SPAR запрещают этот запрос.');
   const data=JSON.parse(await download(u)),products=parseSparSearch(data,task.query);
   if(data.total>10000||data.products.length>pageSize)throw new Error('Поиск SPAR изменил размер каталога. Прежние цены сохранены.');
   return {...task,total:data.total,rawCount:data.products.length,signature:JSON.stringify(data.products.map((p:any)=>p.id??p.url)),products};
  }));
  for(const page of batch){
   if(page.offset>0&&state.totals[page.query]!==page.total)state.catalogChanges=(state.catalogChanges||0)+1;
   state.totals[page.query]=page.total;
   const expected=Math.min(pageSize,Math.max(0,page.total-page.offset));
   if(page.rawCount!==expected||page.rawCount>0&&state.signatures[page.query]?.includes(page.signature))throw new Error('SPAR вернул неполную или повторную страницу. Загрузка не считается завершённой.');
   (state.signatures[page.query]??=[]).push(page.signature);state.received[page.query]=(state.received[page.query]||0)+page.rawCount;
   state.scanned+=page.rawCount;state.products.push(...page.products);
   if(page.offset+pageSize<page.total)state.pending.push({query:page.query,offset:page.offset+pageSize});
  }
  state.pending.splice(0,tasks.length);state.calls+=tasks.length;processed+=tasks.length;
 }
 state.products=[...new Map(state.products.map(p=>[p.url,p])).values()];
 if(JSON.stringify(state).length>8000000)throw new Error('Выгрузка SPAR слишком велика. Прежние цены сохранены.');
 const done=state.pending.length===0;
 if(done){for(const query of sparQueries)if(!Object.hasOwn(state.totals,query))throw new Error('Не все запросы SPAR прочитаны.');if(!state.products.length)throw new Error('SPAR не вернул подходящих товаров для Нижнего Новгорода.');}
 return {snapshot:state,done,products:done?state.products:[]};
}
export async function collectSparSearch(download:(url:URL,missingRobots?:boolean)=>Promise<string>,robotsAllows:(robots:string,path:string)=>boolean){let snapshot:SparSnapshot|undefined;for(;;){const result=await advanceSparSearch(download,robotsAllows,snapshot);if(result.done)return result.products;snapshot=result.snapshot;}}
