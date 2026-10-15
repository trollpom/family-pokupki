import { foods, foodMap, mealTypes, addDays, type FamilyProfile, type MenuRecipe, type MenuData, type MealType, type PriceOffer, type Basket, type BuyRow, type MealGroup } from './meal-model';
import { localMenuRecipes } from './meal-recipes';

const round=(n:number)=>Math.round(n*1000)/1000;
const norm=(s:string)=>s.toLowerCase().replace(/ё/g,'е');
const allergyWords:Record<string,string[]>={gluten:['пшен','мука','манка','ячмен','рожь','булгур','кус-кус'],milk:['молок','сливк','сыр','творог','йогурт','сметан'],egg:['яйц','яич'],fish:['рыб','лосос','треск'],nuts:['орех','миндал','фундук','кешью'],peanut:['арахис'],soy:['соя','соев','тофу'],shellfish:['кревет','мидии','кальмар'],sesame:['кунжут','тахин']};
export function profileProblem(profile:FamilyProfile):string|null{
  if(profile.members.some(m=>m.age<1))return 'Автоматическое меню для ребёнка младше года не формируется. Нужен индивидуальный план питания от педиатра.';
  if(profile.medicalDiet)return 'Лечебную диету нельзя назначать автоматически. Согласуйте блюда и ограничения со специалистом; этот планировщик предназначен для обычного семейного меню.';
  if(profile.batchDays>1&&!profile.hasFridge)return 'Для готовки на несколько дней подтвердите наличие холодильника или выберите готовку на один день.';
  return null;
}
export function recipeMatches(recipe:MenuRecipe,profile:FamilyProfile,meal:MealType=recipe.meal):boolean{
  const members=profile.members.filter(m=>m.meals.includes(meal));if(!members.length)return false;
  if(recipe.time>profile.maxCookMinutes||recipe.equipment.some(e=>!profile.equipment.includes(e as any)))return false;
  const ingredientFoods=recipe.ingredients.map(i=>foodMap.get(i.foodId));if(ingredientFoods.some(f=>!f))return false;
  for(const member of members)for(const f of ingredientFoods){if(!f)return false;if(member.excludedFoods.includes(f.id)||member.allergies.some(a=>f.allergens.includes(a)))return false;if(member.diet==='vegan'&&f.animal)return false;if(member.diet==='vegetarian'&&f.meat)return false;if(member.diet==='glutenfree'&&f.allergens.includes('gluten'))return false;if(member.diet==='dairyfree'&&f.allergens.includes('milk'))return false;
    if(member.age<5&&f.id==='nuts'&&!/измельч|перемол|молот|паст/.test(norm(recipe.steps.join(' '))))return false;}
  // Also reject obvious forbidden ingredients introduced only in AI instructions.
  let text=norm(recipe.name+' '+recipe.steps.join(' '));for(const f of ingredientFoods)text=text.replaceAll(norm(f!.name),'');
  for(const member of members){const bans=[...member.allergies,...(member.diet==='glutenfree'?['gluten']:[]),...(member.diet==='dairyfree'?['milk']:[])];if(bans.some(a=>allergyWords[a]?.some(w=>text.includes(w))))return false;
    if(['vegan','vegetarian','porkfree'].includes(member.diet)&&/свин|бекон|ветчин|(?:^|\s)сало(?:\s|[,.])/.test(text))return false;
    if(['vegan','vegetarian'].includes(member.diet)&&/куриц|курин|индей|говядин|мяс|рыб|лосос|треск|кревет/.test(text))return false;
    if(member.diet==='vegan'&&/молок|сливк|сыр|творог|йогурт|сметан|яйц|яич/.test(text))return false;}
  return true;
}
export function buildMenu(profile:FamilyProfile,startDate:string,familyRevision:number,recipes:MenuRecipe[]=localMenuRecipes,origin:'local'|'deepseek'='local',seed=0):MenuData{
  const problem=profileProblem(profile);if(problem)throw new Error(problem);
  if(addDays(startDate,0)!==startDate)throw new Error('Проверьте дату начала недели');
  const groups:MealGroup[]=[],slots:MenuData['slots']=[],uses=new Map<string,number>();
  for(const meal of mealTypes){const members=profile.members.filter(m=>m.meals.includes(meal));if(!members.length)continue;const eligible=recipes.filter(r=>r.meal===meal&&recipeMatches(r,profile,meal));if(!eligible.length)throw new Error(`Для ${meal==='breakfast'?'завтрака':meal==='lunch'?'обеда':'ужина'} нет блюд под указанные ограничения. Измените время/оборудование или добавьте подходящие рецепты.`);
    for(let day=0;day<7;){let days=meal==='breakfast'?1:Math.min(profile.batchDays,7-day);let options=eligible.filter(r=>r.storageDays>=days);while(!options.length&&days>1){days--;options=eligible.filter(r=>r.storageDays>=days);}
      const preference=(r:MenuRecipe)=>r.ingredients.reduce((s,i)=>s+members.filter(m=>m.likedFoods.includes(i.foodId)).length,0);
      options=options.map((r,index)=>({r,index})).sort((a,b)=>(uses.get(a.r.id)||0)-(uses.get(b.r.id)||0)||preference(b.r)-preference(a.r)||((a.index+seed+day)%eligible.length)-((b.index+seed+day)%eligible.length)).map(x=>x.r).slice(0,3);
      const groupId=`${meal}-${day}`;const dayNumbers=Array.from({length:days},(_,i)=>day+i);
      groups.push({id:groupId,meal,days:dayNumbers,portionPerDay:round(members.reduce((sum,m)=>sum+m.portion,0)),options,selected:0});
      dayNumbers.forEach(d=>slots.push({id:`${meal}-${d}`,day:d,meal,groupId,approved:true}));uses.set(options[0].id,(uses.get(options[0].id)||0)+1);day+=days;
    }
  }
  return {profile,familyRevision,groups,slots,origin,createdAt:new Date().toISOString(),startDate};
}
export function chooseRecipe(data:MenuData,groupId:string,selected:number):MenuData{
  const group=data.groups.find(g=>g.id===groupId);if(!group||!Number.isInteger(selected)||!group.options[selected])throw new Error('Вариант блюда не найден');
  return {...data,groups:data.groups.map(g=>g.id===groupId?{...g,selected}:g),slots:data.slots.map(s=>s.groupId===groupId?{...s,approved:true}:s)};
}
export function approveSlot(data:MenuData,slotId:string,approved:boolean):MenuData{
  if(!data.slots.some(s=>s.id===slotId))throw new Error('Приём пищи не найден');return {...data,slots:data.slots.map(s=>s.id===slotId?{...s,approved}:s)};
}
export function mealNeeds(data:MenuData){
  const stock=data.profile.pantry.map(p=>({...p,remaining:p.quantity})).sort((a,b)=>(a.expiresAt||'9999').localeCompare(b.expiresAt||'9999'));
  const rows=new Map<string,{required:number;pantry:number;toBuy:number}>();
  for(const group of [...data.groups].sort((a,b)=>a.days[0]-b.days[0])){const recipe=group.options[group.selected],servings=group.portionPerDay*group.days.length,cookDate=addDays(data.startDate,group.days[0]);
    for(const i of recipe.ingredients){const quantity=round(i.quantity*servings);let remaining=quantity,pantry=0;
      for(const p of stock){if(p.foodId!==i.foodId||!p.remaining||(p.expiresAt&&p.expiresAt<cookDate))continue;const used=Math.min(p.remaining,remaining);p.remaining=round(p.remaining-used);remaining=round(remaining-used);pantry+=used;if(remaining<=0)break;}
      const previous=rows.get(i.foodId)||{required:0,pantry:0,toBuy:0};rows.set(i.foodId,{required:round(previous.required+quantity),pantry:round(previous.pantry+pantry),toBuy:round(previous.toBuy+remaining)});
    }
  }
  return [...rows].map(([foodId,q])=>({foodId,...q}));
}
export function eligibleOffers(data:MenuData,offers:PriceOffer[],now:Date){const purchaseDate=[data.startDate,new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(now)].sort().at(-1)!;const restricted=data.profile.members.some(m=>m.diet!=='regular'||m.allergies.length>0);return offers.map(o=>o.loyaltyRequired&&!data.profile.loyaltyStores.includes(o.store)&&o.regularPrice&&o.regularPrice>=o.price?{...o,price:o.regularPrice,regularPrice:null,loyaltyRequired:0,minPacks:1}:o).filter(o=>!o.disabled&&o.city===data.profile.city&&data.profile.stores.includes(o.store)&&Number.isFinite(o.packQuantity)&&o.packQuantity>0&&o.price>0&&Date.parse(o.verifiedAt)<=now.getTime()+60000&&now.getTime()-Date.parse(o.verifiedAt)<=48*3600000&&(!o.validFrom||o.validFrom<=purchaseDate)&&(!o.validTo||o.validTo>=purchaseDate)&&(!o.loyaltyRequired||data.profile.loyaltyStores.includes(o.store))&&(!restricted||!!o.compositionConfirmed));}
function alternatives(quantity:number,offers:PriceOffer[]){return offers.map(offer=>{const minimum=offer.minQuantity||1,step=offer.quantityStep||1,weight=minimum+Math.max(0,Math.ceil((quantity-minimum-1e-8)/step))*step,need=offer.variableWeight?round(weight/offer.packQuantity):Math.ceil((quantity-1e-8)/offer.packQuantity),promoPacks=offer.variableWeight?need:Math.max(offer.minPacks,need),promoCost=Math.round(promoPacks*offer.price);
  if(offer.minPacks>1&&offer.regularPrice&&need*offer.regularPrice<promoCost)return {offer:{...offer,price:offer.regularPrice,regularPrice:null,minPacks:1},packs:need,cost:need*offer.regularPrice};
  return {offer,packs:promoPacks,cost:promoCost};}).sort((a,b)=>a.cost-b.cost||a.packs-b.packs);}
function subsets(values:string[],max:number){const result:string[][]=[[]];for(const value of values)for(const old of [...result])if(old.length<max)result.push([...old,value]);return result;}
export function makeBasket(data:MenuData,offers:PriceOffer[],now=new Date()):Basket{
  if(data.shoppingStore&&!data.profile.stores.includes(data.shoppingStore))throw new Error('Выбранный магазин отсутствует в параметрах семьи.');
  const needs=mealNeeds(data),eligible=eligibleOffers(data,offers,now),storeIds=[...new Set(eligible.map(o=>o.store))],sets=data.shoppingStore?[[data.shoppingStore]]:subsets(storeIds,data.profile.maxStores);let best:Basket|null=null;
  // Price each SKU once, then choose the cheapest suitable pack per store.
  // This keeps a large official catalogue practical on a phone.
  const choices=new Map(needs.map(n=>{const sorted=n.toBuy>0?alternatives(n.toBuy,eligible.filter(o=>o.foodId===n.foodId)):[];const byStore=new Map<string,typeof sorted[number]>();for(const choice of sorted)if(!byStore.has(choice.offer.store))byStore.set(choice.offer.store,choice);return [n.foodId,{sorted,byStore}] as const;}));
  for(const storeSet of sets){const rows:BuyRow[]=needs.map(n=>{const f=foodMap.get(n.foodId)!,priced=choices.get(n.foodId)!;const choice=storeSet.map(s=>priced.byStore.get(s)).filter((c):c is NonNullable<typeof c>=>!!c).sort((a,b)=>a.cost-b.cost||a.packs-b.packs)[0];return {...n,name:f.name,unit:f.unit,offer:choice?.offer||null,packs:choice?.packs||0,cost:n.toBuy<=0?0:choice?.cost??null,savings:choice?Math.round(Math.max(0,(choice.offer.regularPrice||choice.offer.price)-choice.offer.price)*choice.packs):0,alternatives:priced.sorted.slice(0,5)};});
    const active=rows.filter(r=>r.toBuy>0),missing=active.filter(r=>r.cost===null).length,knownCost=rows.reduce((s,r)=>s+(r.cost||0),0),stores=[...new Set(rows.filter(r=>r.offer).map(r=>r.offer!.store))],tripCost=Math.max(0,stores.length-1)*data.profile.extraTripCost;
    const indicative=rows.some(r=>['promotion','official-promotion','official-search','official-catalog'].includes(r.offer?.kind||''));
    const basket:Basket={rows,knownCost,tripCost,totalCost:knownCost+tripCost,coverage:active.length?Math.round((active.length-missing)/active.length*100):100,missing,budgetStatus:knownCost+tripCost>data.profile.weeklyBudget?'over':missing?'unknown':indicative?'estimate':'within',stores,savings:rows.reduce((s,r)=>s+r.savings,0),allApproved:data.slots.length>0,comparisons:[],indicative};
    if(!best||basket.missing<best.missing||(basket.missing===best.missing&&basket.totalCost<best.totalCost))best=basket;
  }
  const active=needs.filter(n=>n.toBuy>0),comparisons:Basket['comparisons']=data.profile.stores.map(store=>{const priced=active.map(n=>choices.get(n.foodId)!.byStore.get(store)).filter((c):c is NonNullable<typeof c>=>!!c),missing=active.length-priced.length;return {store,cost:priced.length||!active.length?priced.reduce((sum,c)=>sum+c.cost,0):null,missing,coverage:active.length?Math.round(priced.length/active.length*100):100};});
  return {...best!,comparisons:comparisons.sort((a,b)=>a.missing-b.missing||(a.cost??Infinity)-(b.cost??Infinity))};
}
export function basketQuoteMatrix(data:MenuData,offers:PriceOffer[],now=new Date()){
 const eligible=eligibleOffers(data,offers,now);
 return mealNeeds(data).filter(n=>n.toBuy>0).map(n=>({foodId:n.foodId,name:foodMap.get(n.foodId)!.name,quantity:n.toBuy,unit:foodMap.get(n.foodId)!.unit,stores:data.profile.stores.map(store=>{
  const quotes=alternatives(n.toBuy,eligible.filter(o=>o.foodId===n.foodId&&o.store===store)),quote=quotes[0];
  const raw=offers.filter(o=>o.foodId===n.foodId&&o.store===store&&o.city===data.profile.city&&!o.disabled);
  const reason=quote?'':raw.some(o=>o.loyaltyRequired&&!data.profile.loyaltyStores.includes(store)&&!o.regularPrice)?'Нужна карта':raw.some(o=>now.getTime()-Date.parse(o.verifiedAt)>48*3600000)?'Цена устарела':raw.some(o=>!o.compositionConfirmed)&&data.profile.members.some(m=>m.diet!=='regular'||m.allergies.length)?'Состав не подтверждён':'Нет подходящей цены';
  return {store,cost:quote?.cost??null,reason};
 })}));
}
export function optimizeBudget(data:MenuData,offers:PriceOffer[],now=new Date()){
  let current=data,currentBasket=makeBasket(data,offers,now),changed=0;
  for(let pass=0;pass<data.groups.length*3&&(currentBasket.missing>0||currentBasket.totalCost>data.profile.weeklyBudget);pass++){
    let bestData=current,bestBasket=currentBasket;
    for(const group of current.groups)for(let option=0;option<group.options.length;option++){
      if(option===group.selected)continue;const candidate=chooseRecipe(current,group.id,option),basket=makeBasket(candidate,offers,now);
      // Improve verified coverage first. Unknown prices never count as cheaper.
      if(basket.missing<bestBasket.missing||(!basket.missing&&!bestBasket.missing&&basket.totalCost<bestBasket.totalCost)){bestData=candidate;bestBasket=basket;}
    }
    if(bestData===current)break;current=bestData;currentBasket=bestBasket;changed++;
  }
  const reason=currentBasket.missing?'Нет цен для всех ингредиентов. Автоматическое попадание в бюджет пока нельзя проверить.':currentBasket.totalCost<=data.profile.weeklyBudget?(changed?'Найдены варианты в бюджете. Ингредиенты и покупки пересчитаны.':'Меню уже укладывается в бюджет по проверенным ценам.'):'Среди доступных вариантов бюджет пока превышен. Уменьшите стоимость меню, расширьте источники цен или измените бюджет.';
  return {data:current,changed,reason};
}
