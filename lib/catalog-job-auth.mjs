// A short-lived, purpose-bound signature for private catalogue jobs only.
// It cannot be used as an owner login or to call personal shopping APIs.
const encoder=new TextEncoder();
const payload=time=>'sobrano:catalog-refresh:'+time;
async function signingKey(secret){return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function catalogJobHeaders(secret,time=Date.now()){
 if(typeof secret!=='string'||secret.length<32)throw new Error('Catalogue job signing secret is unavailable');
 const stamp=String(time),signature=new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(secret),encoder.encode(payload(stamp))));
 return {'X-Catalog-Time':stamp,'X-Catalog-Auth':btoa(String.fromCharCode(...signature))};
}
export async function verifyCatalogJob(request,secret,time=Date.now()){
 if(request.method!=='POST'||typeof secret!=='string'||secret.length<32)return false;
 const stamp=request.headers.get('x-catalog-time'),signature=request.headers.get('x-catalog-auth');
 if(!stamp||!/^\d{13}$/.test(stamp)||Math.abs(time-Number(stamp))>5*60000||!signature||!/^[A-Za-z0-9+/]{43}=$/.test(signature))return false;
 try{return await crypto.subtle.verify('HMAC',await signingKey(secret),Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),encoder.encode(payload(stamp)));}catch{return false;}
}
export function catalogJobOrigin(env){
 if(!env.URL)throw new Error('Netlify production URL is unavailable');
 const url=new URL(env.URL);
 if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Invalid Netlify production URL');
 return url.origin;
}
