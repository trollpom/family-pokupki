import { stores } from './model';
import { regionalSource, officialSource, matchCatalogFood } from './catalog-prices';
import { parseOfficialCatalog } from './official-catalogs';
import { collectSparSearch } from './spar-search';
import { collectSmartCatalog } from './smart-catalog';
import { advanceMagnitCatalog, type MagnitSnapshot } from './magnit-catalog';
import { foodMap } from './meal-model';
export type CollectedProduct = { name: string; price: number; unit: string; barcode: string|null; image: string|null; url: string; category: string; foodId?:string|null; packQuantity?:number|null; regularPrice?:number|null; minPacks?:number; minQuantity?:number|null; quantityStep?:number|null; loyaltyRequired?:number; validFrom?:string|null; validTo?:string|null; priceKind?:string; regionVerified?:number };
type Json = Record<string, any>;
function plain(value:string){return value.replace(/<[^>]*>/g,' ').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&(?:nbsp|thinsp);/g,' ').replace(/&#(\d+);/g,(_,v)=>String.fromCharCode(Number(v))).replace(/\s+/g,' ').replace(/ +,/g,',').trim();}
export function parseVkusvill(html:string,pageUrl:string):CollectedProduct[]{
  const cards=html.split(/<div\b[^>]*class="ProductCard\s+[^\"]*js-datalayer-catalog-list-item[^\"]*"/).slice(1),out:CollectedProduct[]=[];
  for(const card of cards){
    const title=card.match(/<a\b([^>]*class="[^"]*js-datalayer-catalog-list-name[^"]*"[^>]*)>([\s\S]*?)<\/a>/);
    const price=card.match(/<span[^>]*class="js-datalayer-catalog-list-price hidden"[^>]*>([\s\S]*?)<\/span>/);
    const href=title?.[1].match(/href="([^"]+)"/)?.[1];
    const value=price?Number(plain(price[1]).replace(',','.')):NaN;
    if(!title||!href||!Number.isFinite(value)||value<=0)continue;
    const unitBlock=card.match(/class="Price\s[^>]*>([\s\S]*?)<\/span>\s*<span class="js-datalayer/);
    const img=card.match(/<img[^>]*class="ProductCard__imageImg"[^>]*src="([^"]+)"/);
    let image=img?.[1]?new URL(plain(img[1]),pageUrl).href:null;if(image && !image.startsWith('https://img.vkusvill.ru/'))image=null;
    const url=new URL(plain(href),pageUrl);if(url.hostname!=='vkusvill.ru'||url.protocol!=='https:')continue;
    out.push({name:plain(title[2]).slice(0,200),price:Math.round(value*100),unit:unitBlock&&plain(unitBlock[1]).includes('/кг')?'кг':'шт',barcode:null,image,url:url.href,category:'Бакалея'});
  }
  return [...new Map(out.map(p=>[p.url,p])).values()].slice(0,100);
}
export function validateSourceUrl(raw: string, storeId: string): URL {
  const store=stores.find(s=>s.id===storeId); if(!store) throw new Error('Неизвестный магазин');
  if(regionalSource(raw,storeId))return new URL(raw);
  const url=new URL(raw); if(url.protocol!=='https:' || url.username || url.password || url.port || !(url.hostname===store.domain || url.hostname.endsWith('.'+store.domain))) throw new Error('Укажите HTTPS-страницу выбранного магазина');
  if(raw.length>1500) throw new Error('Слишком длинный адрес');
  return url;
}
export function parseProducts(html: string, pageUrl: string): CollectedProduct[] {
  const out: CollectedProduct[]=[];
  function walk(value: any, depth=0) {
    if(depth>18 || !value || typeof value!=='object') return;
    if(Array.isArray(value)) { value.slice(0,2000).forEach(v=>walk(v,depth+1)); return; }
    const types=Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if(types.includes('Product')) {
      const offers=Array.isArray(value.offers)?value.offers:[value.offers];
      const offer=offers.find((o:Json)=>o && (o.price!==undefined || o.lowPrice!==undefined));
      const rub=offer?.priceCurrency==='RUB' || offer?.priceCurrency==='643';
      const price=Number(String(offer?.price??offer?.lowPrice??'').replace(',','.').replace(/\s/g,''));
      if(value.name && rub && Number.isFinite(price) && price>0 && price<1000000 && offer?.availability!=='https://schema.org/OutOfStock') {
        const url=new URL(value.url || offer.url || pageUrl,pageUrl);
        if(url.protocol==='https:' && url.hostname===new URL(pageUrl).hostname) out.push({name:String(value.name).slice(0,200),price:Math.round(price*100),unit:'шт',barcode:value.gtin13||value.gtin14||value.gtin||null,image:null,url:url.href,category:typeof value.category==='string'?value.category.slice(0,100):'Продукты'});
      }
    }
    Object.values(value).forEach(v=>walk(v,depth+1));
  }
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(match[1])); } catch { /* Invalid blocks do not invalidate the page. */ }
  }
  const unique=new Map(out.map(p=>[p.url+'|'+p.name,p]));
  return [...unique.values()].slice(0,200);
}
export async function download(url: URL,missingRobots=false,body?:Record<string,unknown>): Promise<string> {
  const response=await fetch(url.href,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'PokupkiPersonal/1.0 (+catalog indexing; no login)','Accept':'application/json,text/html,application/ld+json',...(body?{'Content-Type':'application/json'}:{}),...(url.hostname==='magnit.ru'&&url.pathname.startsWith('/webgate/')?{'X-Device-Platform':'Web','X-Client-Name':'magnit','X-New-Magnit':'true'}:{})}});
  if(response.status>=300 && response.status<400) throw new Error('Источник перенаправляет запрос. Укажите конечный адрес страницы.');
  if([401,403,429].includes(response.status)) throw new Error(`Официальный источник ${url.hostname} ограничил доступ (HTTP ${response.status}). Прежние цены сохранены.`);
  if(missingRobots&&url.pathname==='/robots.txt'&&response.status===404)return '';
  if(!response.ok) throw new Error(`Источник недоступен (HTTP ${response.status})`);
  const reader=response.body?.getReader(); if(!reader) return '';
  const chunks:Uint8Array[]=[];let size=0;
  while(true) {const chunk=await reader.read();if(chunk.done) break;size+=chunk.value.length;if(size>2500000){await reader.cancel();throw new Error('Страница слишком большая');}chunks.push(chunk.value);}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  return new TextDecoder().decode(bytes);
}
export function robotsAllows(robots:string,path:string) {
  const groups:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];let current={agents:[] as string[],rules:[] as {allow:boolean;path:string}[]};
  for(const line of robots.split(/\r?\n/)){const clean=line.split('#')[0].trim();const sep=clean.indexOf(':');if(sep<0)continue;const key=clean.slice(0,sep).toLowerCase(),v=clean.slice(sep+1).trim();if(key==='user-agent'){if(current.rules.length){groups.push(current);current={agents:[],rules:[]};}current.agents.push(v.toLowerCase());}else if((key==='allow'||key==='disallow')&&v)current.rules.push({allow:key==='allow',path:v});}
  groups.push(current);let applicable=groups.filter(g=>g.agents.some(a=>a!=='*' && 'pokupkipersonal'.startsWith(a)));if(!applicable.length)applicable=groups.filter(g=>g.agents.includes('*'));
  const matches=applicable.flatMap(g=>g.rules).filter(r=>{const pattern=r.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*');try{return new RegExp('^'+pattern).test(path);}catch{return false;}}).sort((a,b)=>b.path.length-a.path.length || Number(b.allow)-Number(a.allow));
  return matches.length===0 || matches[0].allow;
}
export async function collect(storeId:string,rawUrl:string):Promise<CollectedProduct[]> {
  const url=validateSourceUrl(rawUrl,storeId);
  if(storeId==='spar'&&officialSource(rawUrl,storeId))return collectSparSearch(download,robotsAllows);
  if(storeId==='smart'&&officialSource(rawUrl,storeId))return collectSmartCatalog((u,body)=>download(u,false,body),robotsAllows);
  if(storeId==='magnit'&&officialSource(rawUrl,storeId)){let snapshot:MagnitSnapshot|undefined;for(;;){const result=await advanceMagnitCatalog((u,body)=>download(u,false,body),robotsAllows,snapshot);if(result.done)return result.products;snapshot=result.snapshot;}}
  const robotsUrl=new URL('/robots.txt',url);let robots:string;
  try { robots=await download(robotsUrl); } catch(error) { throw new Error('Не удалось проверить robots.txt. '+(error instanceof Error?error.message:'Обновление отложено.')); }
  if(!robotsAllows(robots,url.pathname+url.search)) throw new Error('Правила магазина запрещают сбор этой страницы.');
  const delay=Math.min(10,Math.max(2,Number(robots.match(/Crawl-delay:\s*(\d+)/i)?.[1]||2)));
  await new Promise(resolve=>setTimeout(resolve,delay*1000));
  const html=await download(url);
  const products=officialSource(rawUrl,storeId)?parseOfficialCatalog(storeId,html,rawUrl):regionalSource(rawUrl,storeId)?parseRegionalPromotions(html,rawUrl):storeId==='vkusvill' ? parseVkusvill(html,url.href) : parseProducts(html,url.href);
  if(!products.length) throw new Error('На странице нет доступных цен в стандартном формате. Для этого магазина нужен отдельный адаптер.');
  return products.map(p=>{const match=matchCatalogFood(p.name,p.unit);return {...p,foodId:p.foodId??match?.foodId??null,packQuantity:p.packQuantity??match?.packQuantity??null};});
}
const months:Record<string,number>={января:1,февраля:2,марта:3,апреля:4,мая:5,июня:6,июля:7,августа:8,сентября:9,октября:10,ноября:11,декабря:12};
export function promotionPeriod(text:string){const m=plain(text).match(/с\s+(\d{1,2})(?:\s+([а-я]+))?\s+по\s+(\d{1,2})\s+([а-я]+)\s+(20\d{2})/i);if(!m)return null;const endMonth=months[m[4].toLowerCase()],startMonth=months[(m[2]||m[4]).toLowerCase()];if(!endMonth||!startMonth)return null;const y=Number(m[5]),date=(year:number,month:number,day:number)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,start=date(y-(startMonth>endMonth?1:0),startMonth,Number(m[1])),end=date(y,endMonth,Number(m[3]));try{if(new Date(start+'T12:00:00Z').toISOString().slice(0,10)!==start||new Date(end+'T12:00:00Z').toISOString().slice(0,10)!==end||start>end)return null;}catch{return null;}return {validFrom:start,validTo:end};}
export function parseRegionalPromotions(html:string,pageUrl:string,now=new Date()):CollectedProduct[]{
 const source=regionalSource(pageUrl,new Map([['pyaterochka','5ka'],['magnit-magazin','magnit'],['eurospar','spar'],['perekrestok','perekrestok']]).get(pageUrl.split('/')[4])||'');
 if(!source)throw new Error('Неизвестный региональный каталог');
 const description=html.match(/<meta\b[^>]*name=["']Description["'][^>]*content=["']([^"']*)["']/i)?.[1]||'';
 if(!/Для город(?:а|ов):?\s*Нижний Новгород/i.test(plain(description)))throw new Error('Регион каталога не подтверждён: цены не использованы');
 const header=html.match(/<h2\b[^>]*class=["'][^"']*catalog_dates[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1];
 const period=header?promotionPeriod(header):null;if(!period)throw new Error('Не удалось прочитать срок акций: цены не использованы');
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(now);if(period.validTo<today)throw new Error('Каталог акций закончился '+period.validTo+'. Ожидаем новый выпуск; старые цены не участвуют в покупках.');
 const out:CollectedProduct[]=[];
 for(const match of html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)){
  const key=match[1].match(/id=["'](id_product_\d+)["']/)?.[1];if(!key)continue;const card=match[2],nameBlock=card.match(/<div\b[^>]*class=["']product__name["'][^>]*>([\s\S]*?)<\/div>/);
  const priceFor=(kind:string)=>{const p=card.match(new RegExp('class="product__price-'+kind+'[^\"]*"[^>]*>\\s*(\\d+)\\s*<span[^>]*class="text-50% align-super"[^>]*>(\\d{2})<'));return p?Number(p[1])*100+Number(p[2]):null;};
  const price=priceFor('new'),regularPrice=priceFor('old');if(!nameBlock||!price||price>100000000)continue;const name=plain(nameBlock[1]).slice(0,200),mapped=matchCatalogFood(name),image=card.match(/<img\b[^>]*class="product__image"[^>]*src="(https:\/\/media\.proshoper\.ru\/[^\"]+)"/)?.[1]||null;
  // Promotions are indicative catalogue quotes; conditions and stock require checking.
  out.push({name,price,regularPrice:regularPrice&&regularPrice>price?regularPrice:null,unit:'шт',barcode:null,image,url:pageUrl+'#'+key,category:mapped?foodMap.get(mapped.foodId)!.category:'Продукты',foodId:mapped?.foodId||null,packQuantity:mapped?.packQuantity||null,minPacks:1,loyaltyRequired:/по карте|с картой/i.test(plain(card))?1:0,validFrom:period.validFrom,validTo:period.validTo,priceKind:'promotion',regionVerified:1});
 }
 if(!out.length)throw new Error('Каталог доступен только как листовка с изображениями. Цены не распознаны; нужен источник с текстовыми товарами.');
 return out.filter(p=>p.foodId&&p.packQuantity).slice(0,200);
}
