import { getChatGPTUser } from '../../chatgpt-auth';
import { getPlanner, plannerAction } from '../../../lib/planner-service';
import { AppError } from '../../../lib/service';
import { ZodError } from 'zod';
import { sameRequestOrigin } from '../../../lib/request-origin';
export const dynamic='force-dynamic';
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export async function GET(){try{const user=await getChatGPTUser();if(!user)return response({error:'Войдите в аккаунт'},401);return response(await getPlanner(user));}catch{console.error('Planner state unavailable');return response({error:'Не удалось загрузить планировщик'},500);}}
export async function POST(request:Request){
 try{const user=await getChatGPTUser();if(!user)return response({error:'Войдите в аккаунт'},401);if(!sameRequestOrigin(request))return response({error:'Запрос отклонён'},403);if(!request.headers.get('content-type')?.includes('application/json'))return response({error:'Ожидается JSON'},415);if(Number(request.headers.get('content-length')||0)>80000)return response({error:'Слишком много данных'},413);
 const body=await request.text();if(body.length>80000)return response({error:'Слишком много данных'},413);const input=JSON.parse(body);if(!input||Array.isArray(input)||typeof input!=='object')return response({error:'Некорректные данные'},400);return response(await plannerAction(user,input));}
 catch(error){if(error instanceof AppError)return response({error:error.message},error.status);if(error instanceof ZodError)return response({error:'Проверьте поля: '+error.issues.map(i=>i.path.join('.')).slice(0,4).join(', ')},400);if(error instanceof SyntaxError)return response({error:'Некорректные данные'},400);console.error('Planner action unavailable');return response({error:'Не удалось выполнить действие. Проверьте подключение и попробуйте снова.'},500);}
}
