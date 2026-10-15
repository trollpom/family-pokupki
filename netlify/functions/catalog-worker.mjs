import {catalogJobHeaders,catalogJobOrigin,verifyCatalogJob} from '../../lib/catalog-job-auth.mjs';

export default async function(request){
 if(!await verifyCatalogJob(request,process.env.APP_SESSION_SECRET))return;
 const origin=catalogJobOrigin(process.env),deadline=Date.now()+12*60000;
 // Checkpointed short batches fit the Next.js function limit. The next cron
 // run continues a larger inventory without keeping the owner's browser open.
 for(let step=0;step<200&&Date.now()<deadline;step++){
  const response=await fetch(origin+'/api/catalog-refresh',{method:'POST',headers:{...await catalogJobHeaders(process.env.APP_SESSION_SECRET),origin},signal:AbortSignal.timeout(55000)});
  if(!response.ok)throw new Error('Catalogue refresh failed (HTTP '+response.status+')');
  const result=await response.json();
  if(!Array.isArray(result.results)||!result.results.some(r=>r.continuing))return;
  await new Promise(resolve=>setTimeout(resolve,2000));
 }
}
export const config={background:true};
