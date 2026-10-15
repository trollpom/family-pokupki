import { env } from 'cloudflare:workers';
import { and, eq, desc, sql, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db';
import * as t from '../db/schema';
import { AppError, ensureCatalogSource, syncSource, SHARED_CATALOG_OWNER } from './service';
import { catalogOffer, offerOrigin } from './catalog-prices';
import { familySchema, currentFamily, foodMap, mealNames, type PlannerState, type SavedPlan, type MenuData, type PriceOffer } from './meal-model';
import { buildMenu, chooseRecipe, approveSlot, makeBasket, optimizeBudget, profileProblem, eligibleOffers } from './meal-engine';
import { sealSecret, openSecret } from './secret-box';
import { checkDeepseekKey, generateDeepseek, replaceDeepseek, deepseekModels } from './deepseek';
import { normalizeDeepseekKey } from './deepseek-key';
import { stores, primaryStores } from './model';
import type { ChatGPTUser } from '../app/chatgpt-auth';
const now=()=>new Date().toISOString(),uid=()=>crypto.randomUUID(),id=z.string().min(1).max(100);
const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{try{return new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;}catch{return false;}});
const revision=z.number().int().min(0);
const autoAccept=(data:MenuData):MenuData=>({...data,profile:currentFamily(data.profile),slots:data.slots.map(s=>({...s,approved:true}))});
type OwnedPlan=SavedPlan&{owner:string};
async function planFor(owner:string,planId:string){const row=(await getDb().select().from(t.mealPlans).where(and(eq(t.mealPlans.owner,owner),eq(t.mealPlans.id,planId))))[0];if(!row)throw new AppError('Меню не найдено',404);return {...row,data:autoAccept(JSON.parse(row.data))} as OwnedPlan;}
async function offersFor(owner:string){const db=getDb();const [manual,catalog]=await Promise.all([db.select().from(t.priceOffers).where(eq(t.priceOffers.owner,owner)),db.select({product:t.products}).from(t.products).innerJoin(t.sources,eq(t.products.sourceId,t.sources.id)).where(and(or(eq(t.products.owner,owner),eq(t.products.owner,SHARED_CATALOG_OWNER)),eq(t.products.regionVerified,1),eq(t.sources.enabled,1),eq(t.products.updatedAt,t.sources.lastSuccess)))]);return [...manual,...catalog.map(row=>catalogOffer(row.product)).filter((o):o is PriceOffer=>o!==null)] as PriceOffer[];}
const hasServerKey=()=>!!env.DEEPSEEK_API_KEY?.trim();
async function withAI<T extends {inputTokens:number;outputTokens:number}>(owner:string,profile:MenuData['profile'],work:(key:string,model:string)=>Promise<T>):Promise<T>{
 const db=getDb();if(!profile.aiConsent)throw new AppError('Разрешите передачу параметров питания в DeepSeek в настройках семьи.');
 const credentials=(await db.select().from(t.aiCredentials).where(eq(t.aiCredentials.owner,owner)))[0];
 let key:string,model:string;
 if(hasServerKey()){
  try{key=normalizeDeepseekKey(env.DEEPSEEK_API_KEY);}catch{throw new AppError('Серверная настройка DEEPSEEK_API_KEY содержит неверное значение. Проверьте её в Netlify.',503);}
  model='deepseek-flash';
 }else{
  if(!credentials||!env.AI_SECRET_ENCRYPTION_KEY)throw new AppError('Добавьте ключ DeepSeek через «Подключить DeepSeek» или серверную настройку DEEPSEEK_API_KEY.');
  key=await openSecret(env.AI_SECRET_ENCRYPTION_KEY,credentials.encryptedKey,owner);model=credentials.model;
 }
 const since=new Date(Date.now()-86400000).toISOString(),fresh=new Date(Date.now()-95000).toISOString();
 const calls=(await db.select({n:sql<number>`count(*)`}).from(t.aiRequests).where(and(eq(t.aiRequests.owner,owner),sql`${t.aiRequests.createdAt}>=${since}`)))[0];if(Number(calls.n)>=100)throw new AppError('Достигнут предел: 100 запросов ИИ за 24 часа.',429);
 // Reserve quota and an owner lease atomically, for either credential source.
 // Retry-safe SQL never repeats the external paid request.
 const requestId=uid(),lease=now();
 const acquired=await db.run(sql`insert into ai_requests (id,owner,status,created_at) select ${requestId},${owner},'pending',${lease} where not exists (select 1 from ai_requests where owner=${owner} and status='pending' and created_at>=${fresh}) and (select count(*) from ai_requests where owner=${owner} and created_at>=${since})<100`);
 if(!acquired.meta.changes)throw new AppError('Предыдущий запрос ИИ ещё выполняется или достигнут суточный предел. Дождитесь результата.',429);
 try{const result=await work(key,model);await db.update(t.aiRequests).set({status:'ok',inputTokens:result.inputTokens,outputTokens:result.outputTokens}).where(eq(t.aiRequests.id,requestId));return result;}
 catch(error){await db.update(t.aiRequests).set({status:'error'}).where(eq(t.aiRequests.id,requestId));throw new AppError(error instanceof Error&&error.name!=='AbortError'?error.message:'DeepSeek не ответил вовремя. Текущее меню сохранено.',502);}
}

async function updatePlan(plan:OwnedPlan,expected:number,data:MenuData){if(plan.status!=='draft')throw new AppError('Это меню уже превращено в покупки или обрабатывается. Создайте новый план.',409);const changed=await getDb().update(t.mealPlans).set({data:JSON.stringify(data),revision:sql`${t.mealPlans.revision}+1`,updatedAt:now()}).where(and(eq(t.mealPlans.id,plan.id),eq(t.mealPlans.owner,plan.owner),eq(t.mealPlans.revision,expected),eq(t.mealPlans.status,'draft'))).returning();if(!changed.length)throw new AppError('Меню изменилось на другом устройстве. Обновите страницу.',409);}
export async function getPlanner(user:ChatGPTUser):Promise<PlannerState>{
  const db=getDb();await ensureCatalogSource();await db.update(t.mealPlans).set({status:'draft',revision:sql`${t.mealPlans.revision}+1`,updatedAt:now()}).where(and(eq(t.mealPlans.owner,user.userId),eq(t.mealPlans.status,'finalizing'),sql`${t.mealPlans.updatedAt}<${new Date(Date.now()-120000).toISOString()}`));
  const [family,plans,offers,credentials,calls]=await Promise.all([db.select().from(t.familySettings).where(eq(t.familySettings.owner,user.userId)),db.select().from(t.mealPlans).where(eq(t.mealPlans.owner,user.userId)).orderBy(desc(t.mealPlans.createdAt)).limit(10),offersFor(user.userId),db.select({model:t.aiCredentials.model,checkedAt:t.aiCredentials.checkedAt}).from(t.aiCredentials).where(eq(t.aiCredentials.owner,user.userId)),db.select({n:sql<number>`count(*)`}).from(t.aiRequests).where(and(eq(t.aiRequests.owner,user.userId),sql`${t.aiRequests.createdAt}>=${new Date(Date.now()-86400000).toISOString()}`))]);
  const [sourceRows,productCounts]=await Promise.all([db.select().from(t.sources).where(or(eq(t.sources.owner,user.userId),eq(t.sources.owner,SHARED_CATALOG_OWNER))),db.select({sourceId:t.products.sourceId,n:sql<number>`count(*)`}).from(t.products).where(or(eq(t.products.owner,user.userId),eq(t.products.owner,SHARED_CATALOG_OWNER))).groupBy(t.products.sourceId)]);
  return {family:family[0]?{profile:currentFamily(JSON.parse(family[0].data)),revision:family[0].revision}:null,plans:plans.map(p=>({...p,data:autoAccept(JSON.parse(p.data))})),offers,ai:{configured:hasServerKey()||!!credentials[0],source:hasServerKey()?'server':credentials[0]?'saved':null,model:hasServerKey()?'deepseek-flash':credentials[0]?.model||'deepseek-flash',checkedAt:hasServerKey()?null:credentials[0]?.checkedAt||null,callsToday:Number(calls[0].n)},sources:sourceRows.filter(s=>s.enabled).map(s=>({id:s.id,store:s.store,city:s.city,url:s.url,status:s.status,message:s.message,lastSuccess:s.lastSuccess,products:Number(productCounts.find(c=>c.sourceId===s.id)?.n||0)})),catalogMessage:'Сравнивается одинаковый список продуктов с учётом упаковок, веса и карт. Для Магнита на Ленина, 50 и Смарта на Федосеенко, 44А читаются все страницы каталогов; SPAR ищет все ингредиенты меню со всеми страницами результатов. У каждого источника видны прогресс и дата обновления. Цены и наличие зависят от магазина; недоступные источники не считаются подключёнными. Если часть цен отсутствует, полный итог и самый дешёвый магазин пока не подтверждены.'};
}
export async function plannerAction(user:ChatGPTUser,input:Record<string,unknown>):Promise<Record<string,unknown>>{
 const db=getDb(),owner=user.userId;
 switch(input.action){
  case 'saveFamily':{
   const v=z.object({revision,profile:familySchema}).parse(input);if(v.profile.batchDays>1&&!v.profile.hasFridge)throw new AppError('Выберите готовку на один день или подтвердите холодильник.');
   const existing=(await db.select().from(t.familySettings).where(eq(t.familySettings.owner,owner)))[0];
   if(existing){const changed=await db.update(t.familySettings).set({data:JSON.stringify(v.profile),revision:sql`${t.familySettings.revision}+1`,updatedAt:now()}).where(and(eq(t.familySettings.owner,owner),eq(t.familySettings.revision,v.revision))).returning();if(!changed.length)throw new AppError('Параметры семьи изменились. Обновите страницу.',409);}
   else {const created=await db.insert(t.familySettings).values({owner,data:JSON.stringify(v.profile),revision:1,updatedAt:now()}).onConflictDoNothing().returning();if(!created.length)throw new AppError('Профиль уже создан. Обновите страницу.',409);}
   return {message:'Параметры семьи сохранены'};
  }
  case 'saveAI':{
   if(hasServerKey())throw new AppError('DeepSeek подключён через сервер. Ключ меняется в DEEPSEEK_API_KEY в настройках Netlify.');
   let key:string;try{key=normalizeDeepseekKey(input.key);}catch(error){throw new AppError(error instanceof Error?error.message:'Проверьте API-ключ DeepSeek.');}
   const v=z.object({model:z.enum(deepseekModels)}).parse(input);if(!env.AI_SECRET_ENCRYPTION_KEY)throw new AppError('Защищённое хранение ключа ещё не настроено',503);
   try{await checkDeepseekKey(key,v.model);}catch(error){throw new AppError(error instanceof Error?error.message:'Не удалось проверить ключ DeepSeek',400);}const encryptedKey=await sealSecret(env.AI_SECRET_ENCRYPTION_KEY,key,owner),checkedAt=now();
   await db.insert(t.aiCredentials).values({owner,encryptedKey,model:v.model,checkedAt,updatedAt:checkedAt}).onConflictDoUpdate({target:t.aiCredentials.owner,set:{encryptedKey,model:v.model,checkedAt,updatedAt:checkedAt}});return {message:'Ключ проверен и сохранён на сервере'};
  }
  case 'removeAI':{if(hasServerKey())throw new AppError('Серверный ключ управляется в настройках Netlify.');await db.delete(t.aiCredentials).where(eq(t.aiCredentials.owner,owner));return {message:'Ключ удалён из приложения'};}
  case 'generate':{
   const v=z.object({mode:z.enum(['deepseek','local']),startDate:isoDate}).parse(input);const family=(await db.select().from(t.familySettings).where(eq(t.familySettings.owner,owner)))[0];if(!family)throw new AppError('Сначала заполните параметры семьи');const profile=familySchema.parse(currentFamily(JSON.parse(family.data))),problem=profileProblem(profile);if(problem)throw new AppError(problem);
   let pool:Parameters<typeof buildMenu>[3],origin:'local'|'deepseek'='local';
   if(v.mode==='deepseek'){
    const recent=await db.select().from(t.mealPlans).where(eq(t.mealPlans.owner,owner)).orderBy(desc(t.mealPlans.createdAt)).limit(2),recentNames=recent.flatMap(r=>(JSON.parse(r.data) as MenuData).groups.map(g=>g.options[g.selected].name));
    const generated=await withAI(owner,profile,(key,model)=>generateDeepseek(profile,key,model,recentNames));pool=generated.recipes;origin='deepseek';
   }
   let data:MenuData;try{data=buildMenu(profile,v.startDate,family.revision,pool,origin,Math.floor(Date.now()/1000)%17);}catch(error){throw new AppError(error instanceof Error?error.message:'Не удалось подобрать меню');}
   const optimization=optimizeBudget(data,await offersFor(owner));data=optimization.data;
   const planId=uid(),createdAt=now();await db.insert(t.mealPlans).values({id:planId,owner,name:'Меню на неделю · '+v.startDate,startDate:v.startDate,data:JSON.stringify(data),createdAt,updatedAt:createdAt});return {id:planId,message:'Меню готово. Блюда приняты по умолчанию; любой вариант можно поменять.'};
  }
  case 'refreshPrices':{
   const options=z.object({automatic:z.boolean().default(false)}).parse(input);
   await ensureCatalogSource();const family=(await db.select().from(t.familySettings).where(eq(t.familySettings.owner,owner)))[0],selectedStores=family?currentFamily(JSON.parse(family.data)).stores:primaryStores;const sources=await db.select().from(t.sources).where(and(eq(t.sources.enabled,1),or(eq(t.sources.owner,owner),eq(t.sources.owner,SHARED_CATALOG_OWNER))));
   const results=await Promise.all(sources.filter(s=>selectedStores.includes(s.store)).map(async s=>({sourceId:s.id,...await syncSource(s.id,owner,options.automatic)})));return {message:results.some(r=>'continuing' in r&&r.continuing)?'Читаем электронные каталоги по всем страницам. Обновление продолжится автоматически; прежние цены сохранены.':'Проверка источников завершена. Цены и рекомендации магазинов пересчитаны; статусы доступны в «Предложениях магазинов».',results};
  }
  case 'replace':{
   const v=z.object({id,revision,groupId:id}).parse(input),plan=await planFor(owner,v.id);if(plan.status!=='draft'||plan.revision!==v.revision)throw new AppError('Меню изменилось или покупки уже созданы. Обновите страницу.',409);
   const family=(await db.select().from(t.familySettings).where(eq(t.familySettings.owner,owner)))[0];if(!family||family.revision!==plan.data.familyRevision)throw new AppError('Параметры семьи изменились. Создайте новое меню.',409);
   const group=plan.data.groups.find(g=>g.id===v.groupId);if(!group)throw new AppError('Блюдо не найдено',404);
   const rejected=[...(group.rejectedNames||[]),...group.options.map(r=>r.name),...plan.data.groups.filter(g=>g.meal===group.meal).map(g=>g.options[g.selected].name)].slice(-100),offers=await offersFor(owner),priceHints=eligibleOffers(plan.data,offers,new Date()).map(o=>({foodId:o.foodId,packQuantity:o.packQuantity,price:o.price}));
   const replacement=await withAI(owner,plan.data.profile,(key,model)=>replaceDeepseek(plan.data.profile,key,model,group.meal,group.days.length,rejected,priceHints));
   const data=autoAccept({...plan.data,groups:plan.data.groups.map(g=>g.id===group.id?{...g,options:[replacement.recipe],selected:0,rejectedNames:rejected}:g)});await updatePlan(plan,v.revision,data);
   return {message:group.days.length>1?'ИИ заменил блюдо на все дни этой заготовки. Покупки пересчитаны.':'ИИ предложил новое блюдо. Покупки пересчитаны.'};
  }
  case 'shoppingStore':{const v=z.object({id,revision,store:z.string().max(100).nullable()}).parse(input),plan=await planFor(owner,v.id);if(v.store&&!plan.data.profile.stores.includes(v.store))throw new AppError('Выберите магазин из параметров семьи.');await updatePlan(plan,v.revision,{...plan.data,shoppingStore:v.store});return {message:v.store?'Все покупки рассчитаны для выбранного магазина.':'Покупки рассчитаны по выбранному числу магазинов.'};}
  case 'choose':{const v=z.object({id,revision,groupId:id,selected:z.number().int().min(0).max(2)}).parse(input),plan=await planFor(owner,v.id);await updatePlan(plan,v.revision,chooseRecipe(plan.data,v.groupId,v.selected));return {message:'Блюдо изменено. Покупки пересчитаны.'};}
  case 'approve':{const v=z.object({id,revision,slotId:id,approved:z.boolean()}).parse(input),plan=await planFor(owner,v.id);await updatePlan(plan,v.revision,approveSlot(plan.data,v.slotId,v.approved));return {};}
  case 'optimize':{const v=z.object({id,revision}).parse(input),plan=await planFor(owner,v.id),offers=await offersFor(owner),result=optimizeBudget(plan.data,offers);if(result.changed)await updatePlan(plan,v.revision,result.data);return {message:result.reason};}
  case 'addOffer':{
   const v=z.object({foodId:z.string().refine(v=>foodMap.has(v)),store:z.string().refine(v=>stores.some(s=>s.id===v)),city:z.string().trim().min(1).max(100),name:z.string().trim().min(1).max(200),packQuantity:z.number().min(.1).max(100000),price:z.number().int().min(1).max(100000000),regularPrice:z.number().int().min(1).max(100000000).nullable(),minPacks:z.number().int().min(1).max(50),loyaltyRequired:z.number().int().min(0).max(1),compositionConfirmed:z.number().int().min(0).max(1),validFrom:isoDate.nullable(),validTo:isoDate.nullable(),url:z.string().url().max(1500).nullable()}).parse(input);if(v.validFrom&&v.validTo&&v.validFrom>v.validTo)throw new AppError('Проверьте срок акции');if(v.url&&new URL(v.url).protocol!=='https:')throw new AppError('Ссылка магазина должна начинаться с HTTPS');
   const offerId=uid();await db.insert(t.priceOffers).values({id:offerId,owner,...v,kind:'manual',verifiedAt:now()});return {id:offerId,message:'Цена сохранена как введённая вручную'};
  }
  case 'disableOffer':{const v=z.object({id}).parse(input);await db.update(t.priceOffers).set({disabled:1}).where(and(eq(t.priceOffers.id,v.id),eq(t.priceOffers.owner,owner)));return {};}
  case 'finalize':{
   const v=z.object({id,revision,allowUnpriced:z.boolean().default(true)}).parse(input),plan=await planFor(owner,v.id);if(plan.listId&&plan.status==='finalized')return {id:plan.listId,message:'Список уже создан'};
   const family=(await db.select().from(t.familySettings).where(eq(t.familySettings.owner,owner)))[0];if(!family||family.revision!==plan.data.familyRevision)throw new AppError('Параметры семьи или запасы изменились. Создайте меню заново, чтобы учесть их.',409);
   const basket=makeBasket(plan.data,await offersFor(owner));if(basket.knownCost+basket.tripCost>plan.data.profile.weeklyBudget)throw new AppError('Даже известная часть покупок превышает бюджет. Измените меню.');if(basket.missing&&!v.allowUnpriced)throw new AppError('Для части продуктов нет цены. Подтвердите создание списка без гарантии бюджета или добавьте предложения магазинов.');
   const reserved=await db.update(t.mealPlans).set({status:'finalizing',revision:sql`${t.mealPlans.revision}+1`,updatedAt:now()}).where(and(eq(t.mealPlans.owner,owner),eq(t.mealPlans.id,plan.id),eq(t.mealPlans.revision,v.revision),eq(t.mealPlans.status,'draft'),sql`(select revision from family_settings where owner=${owner})=${plan.data.familyRevision}`)).returning();if(!reserved.length)throw new AppError('Меню изменилось или уже обрабатывается. Обновите страницу.',409);
   const listId='menu-'+plan.id,createdAt=now(),ops:any[]=[db.insert(t.lists).values({id:listId,owner,name:'Покупки на неделю · '+plan.startDate,icon:'🥘',budget:plan.data.profile.weeklyBudget,date:plan.startDate,createdAt}).onConflictDoNothing()];
   for(const row of basket.rows.filter(r=>r.toBuy>0)){const f=foodMap.get(row.foodId)!;ops.push(db.insert(t.items).values({id:listId+':'+f.id,listId,name:row.offer?(row.offer.variableWeight?row.offer.name:row.offer.name+' · '+row.offer.packQuantity+' '+f.unit):f.name,quantity:row.offer?row.packs:row.toBuy,unit:row.offer?(row.offer.variableWeight?'кг':'уп'):f.unit,price:row.offer?row.offer.price:null,category:f.category,note:`Нужно ${row.toBuy} ${f.unit}. Из запасов: ${row.pantry} ${f.unit}. ${row.offer?'Цена '+offerOrigin(row.offer)+'; проверено '+row.offer.verifiedAt.slice(0,10):'Цена не подтверждена'}`,store:row.offer?.store||null,sourceUrl:row.offer?.url||null}).onConflictDoNothing());}
   if(basket.tripCost>0)ops.push(db.insert(t.items).values({id:listId+':trips',listId,name:'Дополнительные поездки по магазинам',quantity:1,unit:'шт',price:basket.tripCost,category:'Другое',note:'Оценка по указанной вами стоимости дополнительной поездки'}).onConflictDoNothing());
   const selected=[...new Map(plan.data.groups.map(g=>[g.options[g.selected].id,g.options[g.selected]])).values()];for(const r of selected)ops.push(db.insert(t.recipes).values({id:plan.id+':'+r.id,owner,data:JSON.stringify({name:r.name,subtitle:'Из недельного меню',emoji:r.emoji,color:'#e5eddd',time:r.time,portions:1,category:mealNames[r.meal],ingredients:r.ingredients.map(i=>({name:foodMap.get(i.foodId)!.name,quantity:i.quantity,unit:foodMap.get(i.foodId)!.unit,category:foodMap.get(i.foodId)!.category})),steps:r.steps}),createdAt}).onConflictDoNothing());
   ops.push(db.update(t.mealPlans).set({listId,data:JSON.stringify(autoAccept(plan.data)),status:'finalized',revision:sql`${t.mealPlans.revision}+1`,updatedAt:now()}).where(and(eq(t.mealPlans.id,plan.id),eq(t.mealPlans.owner,owner),eq(t.mealPlans.status,'finalizing'))));
   try{await db.batch(ops as any);}catch(error){await db.update(t.mealPlans).set({status:'draft',revision:sql`${t.mealPlans.revision}+1`,updatedAt:now()}).where(and(eq(t.mealPlans.id,plan.id),eq(t.mealPlans.owner,owner),eq(t.mealPlans.status,'finalizing')));throw new AppError('Не удалось сохранить покупки. Повторите действие.',500);}
   return {id:listId,message:'Список покупок и рецепты сохранены'};
  }
  default:throw new AppError('Неизвестное действие планировщика');
 }
}
