import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const folder=fs.mkdtempSync(path.resolve('node_modules/.deepseek-recipes-checks-'));
try{
 for(const name of ['model','meal-model','meal-recipes','meal-engine','deepseek'])fs.writeFileSync(path.join(folder,name+'.js'),ts.transpileModule(fs.readFileSync('lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText);
 const require=createRequire(import.meta.url),model=require(path.join(folder,'meal-model.js')),engine=require(path.join(folder,'meal-engine.js')),ai=require(path.join(folder,'deepseek.js')),local=require(path.join(folder,'meal-recipes.js'));
 const profile={...model.defaultFamily(),weeklyBudget:500000,aiConsent:true,members:[{id:'a',name:'PRIVATE_PERSON',age:35,portion:1,diet:'regular',allergies:[],excludedFoods:[],likedFoods:[],meals:['breakfast','lunch','dinner']}]};
 const recipes=['breakfast','lunch','dinner'].flatMap(meal=>local.localMenuRecipes.filter(r=>r.meal===meal&&engine.recipeMatches(r,profile)).slice(0,3).map(({id,origin,...r})=>r));
 const key='test-only-credential-must-not-appear';
 const reply=(rows)=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({recipes:rows})}}],usage:{prompt_tokens:100,completion_tokens:200}});
 const mock=(responses)=>{const calls=[];return {calls,fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body),signal:init.signal});return responses[Math.min(calls.length-1,responses.length-1)]();}};};
 const invalid={...recipes[0],ingredients:[{foodId:'UNKNOWN_PRODUCT',quantity:100},{foodId:'rice',quantity:70}]};
 // Previously one invalid alternative rejected the entire otherwise usable menu.
 const mixed=mock([()=>reply([...recipes,invalid])]);
 const generated=await ai.generateDeepseek(profile,key,'deepseek-flash',[],mixed.fetch);
 assert.equal(generated.recipes.length,9);assert.equal(mixed.calls.length,1);assert.ok(generated.recipes.every(r=>r.ingredients.every(i=>model.foodMap.has(i.foodId))));
 const numeric=mock([()=>reply(recipes.map(r=>{const {emoji,...rest}=r;return {...rest,time:String(r.time),storageDays:String(r.storageDays),ingredients:r.ingredients.map(i=>({...i,quantity:String(i.quantity).replace('.',',')}))};}))]);
 const normalized=await ai.generateDeepseek(profile,key,'deepseek-flash',[],numeric.fetch);
 assert.equal(normalized.recipes[0].ingredients[0].quantity,recipes[0].ingredients[0].quantity);assert.equal(typeof normalized.recipes[0].time,'number');assert.equal(normalized.recipes[0].emoji,'🍽️');
 const fenced=mock([()=>Response.json({choices:[{finish_reason:'stop',message:{content:'```json\n'+JSON.stringify({recipes})+'\n```'}}]})]);
 assert.equal((await ai.generateDeepseek(profile,key,'deepseek-flash',[],fenced.fetch)).recipes.length,9);
 const repaired=mock([()=>reply([{...invalid,ingredients:[{foodId:'oats',quantity:'70 г '+key},{foodId:'banana',quantity:100}]}]),()=>reply(recipes)]);
 const fixed=await ai.generateDeepseek(profile,key,'deepseek-flash',[],repaired.fetch);
 assert.equal(repaired.calls.length,2);assert.equal(fixed.inputTokens,200);assert.equal(fixed.outputTokens,400);assert.equal(repaired.calls[0].signal,repaired.calls[1].signal,'both attempts share the same timeout');
 assert.ok(JSON.stringify(repaired.calls[1].body).includes('validationFeedback'));assert.ok(!JSON.stringify(repaired.calls[1].body).includes(key),'repair request never echoes raw provider output');
 assert.ok(repaired.calls[0].body.messages[0].content.includes('storageDays — целое число 1–3'));
 const partial=mock([()=>reply(recipes.filter(r=>r.meal==='breakfast')),()=>reply(recipes.filter(r=>r.meal!=='breakfast'))]);
 assert.equal((await ai.generateDeepseek(profile,key,'deepseek-flash',[],partial.fetch)).recipes.length,9);
 for(const quantity of ['70 г',null,true,0,-1,2001]){
  const bad=mock([()=>reply([{...invalid,ingredients:[{foodId:'oats',quantity},{foodId:'banana',quantity:100}]}])]);
  await assert.rejects(()=>ai.generateDeepseek(profile,key,'deepseek-flash',[],bad.fetch),error=>{assert.match(error.message,/количество/);assert.ok(!error.message.includes(key));return true;});
  assert.equal(bad.calls.length,2,'no third paid attempt');
 }
 const forbidden=mock([()=>reply([invalid])]);await assert.rejects(()=>ai.generateDeepseek(profile,key,'deepseek-flash',[],forbidden.fetch),/продукт: foodId/);
 const duplicate=mock([()=>reply(Array(9).fill(recipes[0]))]);await assert.rejects(()=>ai.generateDeepseek(profile,key,'deepseek-flash',[],duplicate.fetch),/недостаточно блюд/);
 const vegan={...profile,members:[{...profile.members[0],diet:'vegan',allergies:['milk']}]};
 const unsafe=mock([()=>reply(recipes.map(r=>({...r,ingredients:[{foodId:'milk',quantity:100},{foodId:'rice',quantity:50}]})))]);
 await assert.rejects(()=>ai.generateDeepseek(vegan,key,'deepseek-flash',[],unsafe.fetch),/недостаточно блюд/);
 const denied=mock([()=>new Response('{}',{status:401})]);await assert.rejects(()=>ai.generateDeepseek(profile,key,'deepseek-flash',[],denied.fetch),/HTTP 401/);assert.equal(denied.calls.length,1);
 const truncated=mock([()=>Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]})]);await assert.rejects(()=>ai.generateDeepseek(profile,key,'deepseek-flash',[],truncated.fetch),/не завершил/);assert.equal(truncated.calls.length,1);
 const lunch=recipes.find(r=>r.meal==='lunch'),replacement=mock([()=>reply([{...lunch,storageDays:4}]),()=>reply([{...lunch,name:'Новый подходящий суп'}])]);
 const changed=await ai.replaceDeepseek(profile,key,'deepseek-flash','lunch',2,[lunch.name],[],replacement.fetch);
 assert.equal(changed.recipe.name,'Новый подходящий суп');assert.equal(changed.inputTokens,200);assert.equal(replacement.calls.length,2);assert.ok(replacement.calls[1].body.messages[0].content.includes('ровно один НОВЫЙ рецепт'));
 for(const unsuitable of [{...lunch,storageDays:1},{...lunch,meal:'breakfast'},lunch,{...lunch,time:profile.maxCookMinutes+1}]){
  const rejected=mock([()=>reply([unsuitable])]);await assert.rejects(()=>ai.replaceDeepseek(profile,key,'deepseek-flash','lunch',2,[lunch.name],[],rejected.fetch),/Текущий рецепт сохранён/);
 }
 console.log('DeepSeek recipe checks passed: isolated validation, decimal strings, bounded repair, combined usage/timeout, partial results, strict ingredients/quantities/restrictions and replacement requirements.');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
