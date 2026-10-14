import { officialCatalogs, matchCatalogFood } from './catalog-prices';
import { foodMap } from './meal-model';
import type { CollectedProduct } from './collector';

// Decode Nuxt's indexed JSON, never evaluate retailer scripts. The limits also
// reject unexpected cycles and prevent malformed input from exhausting CPU.
export function readNuxtData(html:string):any {
 const raw=html.match(/<script\b[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/)?.[1];
 if(!raw)return null;const values=JSON.parse(raw);if(!Array.isArray(values)||values.length>20000)throw new Error('Формат официального каталога изменился');
 const cache=new Map<number,any>(),active=new Set<number>();let nodes=0;
 const decode=(index:number,depth=0):any=>{
  if(index===-1)return undefined;if(!Number.isInteger(index)||index<0||index>=values.length||depth>45||++nodes>60000)throw new Error('Некорректные данные каталога');
  if(active.has(index))throw new Error('Циклические данные каталога');if(cache.has(index))return cache.get(index);
  active.add(index);const value=values[index];let out:any;
  if(Array.isArray(value)){
   if(typeof value[0]==='string')out=['ShallowReactive','Reactive','ShallowRef','Ref'].includes(value[0])?decode(value[1],depth+1):null;
   else out=value.map(i=>decode(i,depth+1));
  }else if(value&&typeof value==='object'){
   out=Object.create(null);for(const [key,i] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))continue;out[key]=decode(i as number,depth+1);}
  }else out=value;
  active.delete(index);cache.set(index,out);return out;
 };return decode(0);
}
const validDate=(v:unknown):v is string=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const price=(v:unknown)=>typeof v==='string'&&/^\d+(?:[,.]\d{1,2})?$/.test(v)?Math.round(Number(v.replace(',','.'))*100):null;
export function parseMagnitOfficial(html:string,pageUrl:string,now=new Date()):CollectedProduct[]{
 const data=readNuxtData(html),store=data?.pinia?.stores?.selectedStoreRef;
 const address=String(store?.address||''),code=String(store?.externalId?.storeCode||'');
 // The site may silently ignore shopCode and return its default Krasnodar store.
 if(!/(?:^|,\s*)(?:г\.?\s*)?Нижний Новгород(?:,|$)/u.test(address)||code!=='520011')throw new Error('Официальный Магнит не подтвердил выбранный магазин Нижнего Новгорода. Чужие цены не использованы.');
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(now),out:CollectedProduct[]=[];
 for(const [key,section] of Object.entries(data?.data||{}) as [string,any][]){
  if(!key.startsWith('promotions:')||!Array.isArray(section?.goods))continue;
  for(const item of section.goods){
   if(item?.adult||typeof item?.title!=='string'||!validDate(item.startDate)||!validDate(item.endDate)||item.startDate>item.endDate||item.endDate<today)continue;
   // Conditional progressive prices and bundles need a dedicated unit model.
   if(item.progressiveDiscountVariants?.length||/при покупке|каждый понедельник|каждый вторник|от \d+ шт|от \d+ штук/i.test(item.description||''))continue;
   const current=price(item.price),regular=price(item.oldPrice);if(!current||current>100000000)continue;
   let url:URL;try{url=new URL(item.link,pageUrl);}catch{continue;}
   if(url.protocol!=='https:'||url.hostname!=='magnit.ru'||url.searchParams.get('shopCode')!==code)continue;
   const description=String(item.description||''),unit=/(?:\/\s*(?:1\s*)?кг|за\s+1\s*кг)(?=$|[\s,).])/i.test(item.title)?'кг':'шт';
   const mapped=matchCatalogFood(item.title,unit);if(!mapped)continue;
   out.push({name:item.title.slice(0,200),price:current,regularPrice:regular&&regular>current?regular:null,unit,barcode:null,image:null,url:url.href,category:foodMap.get(mapped.foodId)!.category,foodId:mapped.foodId,packQuantity:mapped.packQuantity,minPacks:1,loyaltyRequired:/предъявлении карты|по карте|с картой/i.test(description)?1:0,validFrom:item.startDate,validTo:item.endDate,priceKind:'official-promotion',regionVerified:1});
  }
 }
 if(!out.length)throw new Error('В официальном каталоге нет однозначных цен на продукты меню. Прежние данные сохранены.');
 return [...new Map(out.map(p=>[p.url,p])).values()].slice(0,200);
}
export function parseOfficialCatalog(store:string,html:string,pageUrl:string,now=new Date()):CollectedProduct[]{
 if(!officialCatalogs.some(s=>s.store===store&&s.url===pageUrl))throw new Error('Неизвестный официальный источник');
 if(store==='magnit')return parseMagnitOfficial(html,pageUrl,now);
 const text=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
 if(/captcha|Access Blocked|Проблемы со связью|проверка браузера|проверка безопасности|подтвердите.*человек|служебная страница|site unavailable/i.test(text))throw new Error('Официальный сайт показывает защитную страницу. Автоматическое чтение каталога недоступно.');
 if(store==='perekrestok'&&/Каталоги не найдены/i.test(text))throw new Error('На официальной странице Перекрёстка для Нижнего Новгорода сейчас нет каталогов. Цены витрины доставки не использованы.');
 // A page's city selector (or a city in its legal office address) cannot prove
 // that the prices belong to that city. An address in the legal footer does not prove a price region.
 if(store==='spar')throw new Error('Товарный каталог SPAR требует подтверждённого выбора города/магазина и доступа к карточкам. Регион текущих цен не подтверждён.');
 throw new Error('Официальный электронный каталог требует подтверждённого выбора магазина Нижнего Новгорода и доступной выгрузки. Чужие цены не использованы.');
}
