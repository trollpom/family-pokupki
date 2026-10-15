import { foodMap } from './meal-model';
import { matchCatalogFood } from './catalog-prices';
import type { CollectedProduct } from './collector';

// Public anonymous read requests made by magnit.ru/categories and /catalog.
// Store and product contracts were checked against the UI on 2026-10-15.
export const MAGNIT_BASE='https://magnit.ru/';
export const MAGNIT_STORE='522856';
export const MAGNIT_SOURCE='https://magnit.ru/categories';
const pageSize=34;
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=100000000;
export function verifyMagnitStore(data:any){
 if(data?.externalId?.storeCode!==MAGNIT_STORE||data?.externalId?.owner!=='OWNER_MAGNIT'||data.isActive!==true||data.cityFiasId!=='555e7d61-d9a7-4ba6-9770-6caa8198c483'||data.address!=='Нижегородская обл, г Нижний Новгород, пр-кт Ленина, д 50'||data.storeTypeV2!=='MM')throw new Error('Магнит не подтвердил магазин Нижний Новгород, проспект Ленина, 50. Чужие цены не использованы.');
 return {store:MAGNIT_STORE,city:'Нижний Новгород',address:data.address};
}
export function magnitSearchBody(offset:number){return {includeAdultGoods:false,pagination:{limit:pageSize,offset},sort:{order:'asc',type:'date_added'},storeCode:MAGNIT_STORE,storeType:'1',catalogType:'1'};}
export function parseMagnitCatalogPage(data:any,offset:number,now=new Date()):{products:CollectedProduct[];total:number;rawCount:number;signature:string;nextOffset:number|null}{
 const p=data?.pagination;
 if(!Array.isArray(data?.items)||data.items.length>pageSize||!p||p.offset!==offset||p.limit!==pageSize||!Number.isInteger(p.totalCount)||p.totalCount<0||p.totalCount>50000||typeof p.hasMore!=='boolean')throw new Error('Электронный каталог Магнита изменил формат страниц. Прежние цены сохранены.');
 // nextOffset is a server cursor, not offset + limit. Filtered live pages
 // can contain 17 goods and advance by 67 positions. Only hasMore ends the
 // traversal; neither a short/empty page nor totalCount is an end marker.
 if(p.hasMore&&(!Number.isSafeInteger(p.nextOffset)||p.nextOffset<offset+data.items.length||p.nextOffset<=offset||p.nextOffset>50000))throw new Error('Магнит вернул неверный указатель продолжения. Загрузка не считается завершённой.');
 const products:CollectedProduct[]=[];
 for(const item of data.items){
  if(item?.storeCode!==MAGNIT_STORE||item.catalogType!=='1'||item.service!=='core_mm')throw new Error('Магнит вернул товары другой витрины. Чужие цены не использованы.');
  if(typeof item.id!=='string'||!/^\d{1,15}$/.test(item.id)||typeof item.seoCode!=='string'||!/^[a-z0-9_-]+$/i.test(item.seoCode)||typeof item.name!=='string')throw new Error('Магнит изменил формат карточек товаров.');
  if(item.isForAdults||item.isBiometryRequired||item.needPassport||!positive(item.price)||typeof item.quantity!=='number'||item.quantity<=0)continue;
  const w=item.weighted;if(!w||typeof w.isWeighted!=='boolean')throw new Error('Магнит не указал единицу цены. Прежние цены сохранены.');
  const name=item.name.slice(0,200),unit=w.isWeighted?'кг':'шт';
  if(w.isWeighted&&(w.unitLabel!=='1кг'||!positive(w.unitPrice)))continue;
  const price=w.isWeighted?w.unitPrice:item.price;
  const badges=Array.isArray(item.badges)?item.badges:[],card=badges.some((b:any)=>typeof b?.text==='string'&&/^по карте$/i.test(b.text.trim()));
  const old=positive(item.promotion?.oldPrice)&&!w.isWeighted&&item.promotion.oldPrice>=price?item.promotion.oldPrice:null;
  const end=item.promotion?.endDate;
  if(end&&(!Number.isFinite(Date.parse(end))||Date.parse(end)<now.getTime()))continue;
  const mapped=matchCatalogFood(name,unit);
  const image=item.gallery?.find((g:any)=>g?.type==='IMAGE'&&typeof g.url==='string'&&g.url.startsWith('https://images-foodtech.magnit.ru/'))?.url??null;
  products.push({name,price,regularPrice:old,unit,barcode:null,image,url:new URL(`product/${item.id}-${item.seoCode}?shopCode=${MAGNIT_STORE}&shopType=1`,MAGNIT_BASE).href,category:mapped?foodMap.get(mapped.foodId)!.category:'Каталог Магнит',foodId:mapped?.foodId??null,packQuantity:mapped?.packQuantity??null,minPacks:1,minQuantity:w.isWeighted?1:null,quantityStep:w.isWeighted?1:null,loyaltyRequired:card?1:0,validFrom:null,validTo:end?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date(end)):null,priceKind:'official-catalog',regionVerified:1});
 }
 return {products,total:p.totalCount,rawCount:data.items.length,signature:JSON.stringify(data.items.map((i:any)=>i.id)),nextOffset:p.hasMore?p.nextOffset:null};
}
export type MagnitSnapshot={kind:'magnit-v2';startedAt:string;robots:string;context:ReturnType<typeof verifyMagnitStore>;calls:number;scanned:number;total:number|null;catalogChanges:number;pending:{offset:number}[];signatures:string[];products:CollectedProduct[];failures?:number};
export async function advanceMagnitCatalog(request:(url:URL,body?:Record<string,unknown>)=>Promise<string>,robotsAllows:(robots:string,path:string)=>boolean,snapshot?:MagnitSnapshot,pageBudget=4):Promise<{snapshot:MagnitSnapshot;done:boolean;products:CollectedProduct[]}>{
 const base=new URL(MAGNIT_BASE);let state=snapshot;
 if(state&&(state.kind!=='magnit-v2'||Date.now()-Date.parse(state.startedAt)>2*3600000))state=undefined;
 const robots=state?.robots??await request(new URL('/robots.txt',base));
 if(!robotsAllows(robots,'/categories'))throw new Error('Правила Магнита запрещают чтение электронного каталога.');
 // The site's anonymous catalogue client posts to an endpoint named search,
 // including when browsing all goods without a search term. We check the
 // public catalogue route; we do not index arbitrary search-result URLs.
 const read=async(path:string,body:Record<string,unknown>)=>{const u=new URL(path,base);if(u.origin!==base.origin||!['/webgate/v1/stores-facade/store','/webgate/v2/goods/search'].includes(u.pathname))throw new Error('Неизвестный адрес каталога Магнита.');return JSON.parse(await request(u,body));};
 if(!state){const context=verifyMagnitStore(await read('/webgate/v1/stores-facade/store',{externalId:{owner:'OWNER_MAGNIT',storeCode:MAGNIT_STORE}}));state={kind:'magnit-v2',context,robots,startedAt:new Date().toISOString(),calls:0,scanned:0,total:null,catalogChanges:0,pending:[{offset:0}],signatures:[],products:[]};}
 if(state.context.store!==MAGNIT_STORE||!Array.isArray(state.pending)||state.pending.some(t=>!Number.isSafeInteger(t.offset)||t.offset<0||t.offset>50000))throw new Error('Черновик Магнита не подтвердил магазин или страницы.');
 for(let at=0;state.pending.length&&at<pageBudget;at++){
  if(state.calls>=1500)throw new Error('Каталог Магнита превысил лимит страниц. Загрузка не считается завершённой.');
  const offset=state.pending[0].offset;await new Promise(resolve=>setTimeout(resolve,2000));
  const page=parseMagnitCatalogPage(await read('/webgate/v2/goods/search',magnitSearchBody(offset)),offset);
  if(state.signatures.includes(page.signature)&&page.rawCount>0)throw new Error('Магнит повторил страницу каталога. Прежние цены сохранены.');
  if(state.total!==null&&state.total!==page.total)state.catalogChanges++;
  state.total=page.total;state.signatures.push(page.signature);state.scanned+=page.rawCount;state.calls++;state.products.push(...page.products);state.pending.shift();
  if(page.nextOffset!==null)state.pending.push({offset:page.nextOffset});
 }
 state.products=[...new Map(state.products.map(p=>[p.url,p])).values()];
 if(JSON.stringify(state).length>20000000)throw new Error('Выгрузка Магнита превышает безопасный размер.');
 const done=state.pending.length===0;
 if(done&&!state.products.length)throw new Error('Магнит не вернул доступных товаров. Прежние цены сохранены.');
 // A resumed draft may predate a food-matching correction. Reclassify at
 // completion so old pages receive the same rules as newly downloaded ones.
 if(done)state.products=state.products.map(product=>{const mapped=matchCatalogFood(product.name,product.unit);return {...product,foodId:mapped?.foodId??null,packQuantity:mapped?.packQuantity??null,category:mapped?foodMap.get(mapped.foodId)!.category:'Каталог Магнит'};});
 return {snapshot:state,done,products:done?state.products:[]};
}
