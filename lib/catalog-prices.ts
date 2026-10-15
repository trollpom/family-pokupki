import { foodMap, type PriceOffer } from './meal-model';
import type { Product } from './model';
export const regionalCatalogs=[
 {id:'nn-promo-5ka',store:'5ka',city:'Нижний Новгород',url:'https://nn.proshoper.ru/actions/pyaterochka/nizhnij-novgorod/'},
 {id:'nn-promo-magnit',store:'magnit',city:'Нижний Новгород',url:'https://nn.proshoper.ru/actions/magnit-magazin/nizhnij-novgorod/'},
 {id:'nn-promo-spar',store:'spar',city:'Нижний Новгород',url:'https://nn.proshoper.ru/actions/eurospar/nizhnij-novgorod/'},
 {id:'nn-promo-perekrestok',store:'perekrestok',city:'Нижний Новгород',url:'https://nn.proshoper.ru/actions/perekrestok/nizhnij-novgorod/'},
] as const;
export function regionalSource(raw:string,store:string){return regionalCatalogs.find(s=>s.url===raw&&s.store===store);}
// These are public pages discovered on each retailer's own website. A city in
// this registry is a requested city, not proof that the response uses it.
export const officialCatalogs=[
 {id:'nn-official-5ka',store:'5ka',city:'Нижний Новгород',url:'https://5ka.ru/catalog/'},
 {id:'nn-official-magnit',store:'magnit',city:'Нижний Новгород',url:'https://magnit.ru/categories'},
 {id:'nn-official-spar',store:'spar',city:'Нижний Новгород',url:'https://myspar.ru/catalog/'},
 {id:'nn-official-perekrestok',store:'perekrestok',city:'Нижний Новгород',url:'https://www.perekrestok.ru/cat'},
 {id:'nn-official-chizhik',store:'chizhik',city:'Нижний Новгород',url:'https://chizhik.club/catalog/'},
 {id:'nn-official-lenta',store:'lenta',city:'Нижний Новгород',url:'https://lenta.com/catalog/'},
 {id:'nn-official-auchan',store:'auchan',city:'Нижний Новгород',url:'https://www.auchan.ru/catalog/tags/geo/nnov/'},
 {id:'nn-official-smart',store:'smart',city:'Нижний Новгород',url:'https://smart.swnn.ru/'},
] as const;
export function officialSource(raw:string,store:string){return officialCatalogs.find(s=>s.url===raw&&s.store===store);}
export function sourceOrigin(url:string){return url.startsWith('https://nn.proshoper.ru/')?'Региональный каталог · Прошопер':url==='https://smart.swnn.ru/'?'Официальный каталог · Федосеенко, 44А':'Официальный сайт магазина';}
const rules:[string,RegExp][]=[
 ['oats',/^(?:хлопья\s+(?:.*\s)?овсяные(?:\s|$)|овсяные\s+хлопья)/],['rice',/^(?:рис|крупа рис(?:овая)?)(?:\s|$)/u],['buckwheat',/^(?:гречка|греча|крупа гречневая|гречневая крупа)/],['millet',/^(?:пшено|крупа пшено|крупа пшенная)/],['pasta',/^(?:макароны|макаронные изделия|спагетти|паста|вермишель)/],['flour',/^мука\s+(?:.*\s)?пшеничная(?:\s|$)/],['bread',/^(?:хлеб|батон)(?:\s|$)/],
 ['plantmilk',/^(?:молоко соевое|напиток соевый|соевый напиток)/],['milk',/^молоко\s/],['cottage',/^творог\s/],['yogurt',/^йогурт.*(?:натуральный|без добавок)/],['cheese',/^сыр\s.*(?:полутвердый|твердый|российский|голландский|гауда|маасдам)/],['eggs',/^(?:яйцо куриное|яйца куриные|куриное яйцо)/],
 ['chicken',/^(?:филе\s+(?:курин|цыпленка|грудки кур|грудки цыпленка-бройлера)|грудка (?:куриная|цыпленка).*филе)/],['turkey',/^(?:филе\s+(?:индейки|из мяса индейки)|филе грудки индейки)/],['fish',/^(?:филе\s+(?:минтая|трески|хека)|(?:минтай|треска|хек).*филе)/],['beef',/^говядина.*(?:мякоть|вырезка|лопатка)/],
 ['potato',/^картофель(?:\s|$)/],['carrot',/^морковь(?:\s|$)/],['onion',/^лук репчатый/],['tomato',/^(?:томат|томаты|помидоры)(?:\s|$)/],['cucumber',/^огурцы(?:\s|$)/],['pepper',/^перец.*(?:сладкий|болгарский|рамиро)/],['zucchini',/^(?:кабачки|кабачок|цукини)(?:\s|$)/],['cabbage',/^капуста белокочанная/],['pumpkin',/^тыква(?:\s|$)/],['broccoli',/^капуста брокколи|^брокколи/],['mushroom',/^шампиньоны/],['apple',/^яблок[ио](?:\s|$)/],['banana',/^бананы(?:\s|$)/],['avocado',/^авокадо(?:\s|$)/],
 ['lentils',/^(?:чечевица|крупа чечевица)/],['beans',/^фасоль.*(?:в собственном соку|натуральная|консерв|готовая)/],['chickpeas',/^нут.*(?:консерв|в собственном соку|готовый)/],['tofu',/^(?:тофу|сыр тофу)/],['nuts',/^(?:орехи (?:грецкие|кешью|миндаль|фундук)|орех грецкий|грецкий орех|миндаль|кешью|фундук)(?:\s|$)/],['oil',/^масло.*(?:подсолнечное|оливковое|растительное|рапсовое)/],['salt',/^соль(?:\s|$)/],['sugar',/^(?:сахар(?:-песок)?|сахарный песок)(?:\s|$)/],
];
export function matchCatalogFood(name:string,unit='шт'):{foodId:string;packQuantity:number;variableWeight:boolean}|null{
 const n=name.toLowerCase().replace(/ё/g,'е').replace(/\u00a0/g,' ');
 if(/смесь|суп |пюре|салат|фарш|начинк|копчен|марин|жарен|запеч|вареный|вялен|в соусе|с добавлением|сгущен|сухое молоко|коктейль|продукт творож|сырок|цукат|фруктов.*паст|со вкусом|или |ассорти(?=$|[\s,.;:()])/.test(n))return null;
 const foodId=rules.find(([,re])=>re.test(n))?.[0];if(!foodId)return null;const f=foodMap.get(foodId)!;
 if(foodId==='oats'&&/ягод|клубник|персик|черник|сахар|молок|фрукт|шоколад|банан/.test(n))return null;
 if(foodId==='oats'&&/пшеничн|гречнев|рисов|ржан|кукуруз|злаков/.test(n)||foodId==='flour'&&/рисовая|овсяная|ржаная|кукурузная|гречневая|нутовая|полбяная|блинн/.test(n))return null;
 if(foodId==='milk'&&/соев|растительн|кокос|миндал|овсян/.test(n)||foodId==='plantmilk'&&/ванил|шоколад|сахар|клубник/.test(n)||foodId==='nuts'&&/соль|солен|глазур|карамел|сахар|шоколад|микс/.test(n))return null;
 if(foodId==='pasta'&&/шоколад|арахис|какао|орехов|намаз|паштет/.test(n)||foodId==='potato'&&/\bфри|картофель фри/.test(n))return null;
 if(unit==='кг'&&f.unit==='г')return {foodId,packQuantity:1000,variableWeight:true};
 // Explicit pack units only: never infer kilograms for a price without a unit.
 const drained=['beans','chickpeas'].includes(foodId)?n.match(/(?:масса (?:основного продукта|без жидкости)|вес без жидкости)\s*[:—-]?\s*(\d+(?:[.,]\d+)?)\s*(кг|г)(?=$|[\s,).;/])/u):null;
 if(drained){const q=Number(drained[1].replace(',','.'))*(drained[2]==='кг'?1000:1);return q>0&&q<=100000?{foodId,packQuantity:q,variableWeight:false}:null;}
 const pack=n.match(/(?:^|[\s,(])(?:(\d+)\s*[xх×*]\s*)?(\d+(?:[.,]\d+)?)\s*(кг|мл|шт\.?|г|л)(?=$|[\s,).;/])/u);
 if(!pack)return null;const q=Number(pack[1]||1)*Number(pack[2].replace(',','.')),u=pack[3].replace('.','');
 const quantity=f.unit==='г'&&(u==='г'||u==='кг')?q*(u==='кг'?1000:1):f.unit==='мл'&&(u==='мл'||u==='л')?q*(u==='л'?1000:1):f.unit==='шт'&&u==='шт'?q:0;
 if(!Number.isFinite(quantity)||quantity<=0||quantity>100000)return null;
 if(['beans','chickpeas'].includes(foodId)&&!/готовая|готовый|масса основного продукта|без жидкости/.test(n))return null;
 return {foodId,packQuantity:quantity,variableWeight:false};
}
export function catalogOffer(p:Product):PriceOffer|null{
 if(!p.regionVerified||!p.foodId||!p.packQuantity||!foodMap.has(p.foodId))return null;
 return {id:'catalog:'+p.id,foodId:p.foodId,store:p.store,city:p.city,name:p.name,packQuantity:p.packQuantity,price:p.price,regularPrice:p.regularPrice??null,minPacks:p.minPacks||1,minQuantity:p.minQuantity??null,quantityStep:p.quantityStep??null,loyaltyRequired:p.loyaltyRequired||0,compositionConfirmed:0,validFrom:p.validFrom??null,validTo:p.validTo??null,url:p.url,kind:p.priceKind||'catalog',verifiedAt:p.updatedAt,disabled:0,variableWeight:p.unit==='кг'};
}
export function offerOrigin(o:PriceOffer){return o.kind==='manual'?'введено вами':o.kind==='promotion'?'каталог акций · Прошопер':o.kind==='official-promotion'?'официальный каталог акций':o.kind==='official-search'?'электронный поиск SPAR · Нижний Новгород':o.kind==='official-catalog'?(o.store==='smart'?'электронный каталог · Федосеенко, 44А':'официальный электронный каталог'):'каталог магазина';}
