import { getChatGPTUser } from '../../chatgpt-auth';
import { getState, act, AppError } from '../../../lib/service';
import { ZodError } from 'zod';
export const dynamic='force-dynamic';
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(){const user=await getChatGPTUser();if(!user)return response({error:'Войдите в аккаунт'},401);try{return response(await getState(user));}catch(error){console.error('state failed',error);return response({error:'Не удалось загрузить покупки. Попробуйте ещё раз.'},500);}}
export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return response({error:'Войдите в аккаунт'},401);
  if(request.headers.get('sec-fetch-site')==='cross-site')return response({error:'Запрос отклонён'},403);
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return response({error:'Запрос отклонён'},403);
  if(!request.headers.get('content-type')?.includes('application/json'))return response({error:'Ожидается JSON'},415);
  try{const body=await request.text();if(body.length>150000)return response({error:'Слишком много данных'},413);const input=JSON.parse(body);if(!input||Array.isArray(input)||typeof input!=='object')throw new AppError('Некорректные данные');return response(await act(user,input));}
  catch(error){if(error instanceof AppError)return response({error:error.message},error.status);if(error instanceof ZodError)return response({error:'Проверьте поля: '+error.issues.map(i=>i.path.join('.')).slice(0,3).join(', ')},400);if(error instanceof SyntaxError)return response({error:'Некорректные данные'},400);console.error('action failed',error);return response({error:'Не удалось сохранить изменения. Попробуйте ещё раз.'},500);}
}
