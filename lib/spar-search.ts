import { foodMap } from './meal-model';
import { matchCatalogFood } from './catalog-prices';
import type { CollectedProduct } from './collector';
// Public search service loaded by myspar.ru/catalog/. On 2026-10-14 the site's
// selected Нижний Новгород header exposed city 44 and shop-code 1510. No browser
// cookies, authentication credentials or CAPTCHA bypass are used by this reader.
export const SPAR_SEARCH='https://search-myspar.ext-geoprod.1221sys.ru/';
export const SPAR_LOCATION='1510';
export const sparQueries=['овсяные хлопья','рис','гречка','пшено','макароны','хлеб','мука пшеничная','молоко','йогурт натуральный','сыр российский','творог','яйцо куриное','филе куриное','филе индейки','филе минтая','говядина','картофель','морковь','лук репчатый','томаты','огурцы','перец сладкий','кабачки','капуста белокочанная','тыква','брокколи','шампиньоны','яблоки','бананы','авокадо','чечевица','тофу','масло подсолнечное','соль','сахар'] as const;
function rubles(value:unknown){if(typeof value!=='string')return null;const clean=value.replace(/[\s\u00a0]/g,'').replace(/₽$/,'');if(!/^\d+(?:[.,]\d{1,2})?$/.test(clean))return null;const n=Math.round(Number(clean.replace(',','.'))*100);return n>0&&n<=100000000?n:null;}
const rawCategories:Record<string,string[]>={
 rice:['krupy','krupy-makarony-i-sukhie-zavtraki-spar'],buckwheat:['krupy','krupy-makarony-i-sukhie-zavtraki-spar'],millet:['krupy'],lentils:['krupy'],oats:['kashi-gotovye-zavtraki','krupy-makarony-i-sukhie-zavtraki-spar'],pasta:['makarony','krupy-makarony-i-sukhie-zavtraki-spar','makarony-ris-import'],flour:['muka','muka-1'],
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
export async function collectSparSearch(download:(url:URL,missingRobots?:boolean)=>Promise<string>,robotsAllows:(robots:string,path:string)=>boolean){
 const base=new URL(SPAR_SEARCH),robots=await download(new URL('/robots.txt',base),true);if(!robotsAllows(robots,'/?query=рис&location='+SPAR_LOCATION))throw new Error('Правила сервиса SPAR запрещают чтение поиска.');
 const rows:CollectedProduct[]=[];
 // Two ordinary search requests per batch, with a pause; no wildcard inventory
 // dump, hidden API endpoints or increased server page limits.
 for(let at=0;at<sparQueries.length;at+=2){
  await new Promise(resolve=>setTimeout(resolve,2000));
  const results=await Promise.all(sparQueries.slice(at,at+2).map(async query=>{const u=new URL(base);u.search=new URLSearchParams({query,location:SPAR_LOCATION,isWeb:'true',limit:'15'}).toString();if(!robotsAllows(robots,u.pathname+u.search))throw new Error('Правила сервиса SPAR запрещают этот запрос.');return parseSparSearch(JSON.parse(await download(u)),query);}));rows.push(...results.flat());
 }
 const products=[...new Map(rows.map(p=>[p.url,p])).values()];if(!products.length)throw new Error('Штатный поиск SPAR не вернул подходящих товаров для Нижнего Новгорода.');return products.slice(0,500);
}
