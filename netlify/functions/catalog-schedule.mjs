import {catalogJobHeaders,catalogJobOrigin} from '../../lib/catalog-job-auth.mjs';

// Netlify invokes this short scheduler only on published production deploys.
export default async function(){
 const origin=catalogJobOrigin(process.env),headers=await catalogJobHeaders(process.env.APP_SESSION_SECRET);
 const response=await fetch(origin+'/.netlify/functions/catalog-worker',{method:'POST',headers,signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Catalogue worker could not start (HTTP '+response.status+')');
}
export const config={schedule:'*/15 * * * *'};
