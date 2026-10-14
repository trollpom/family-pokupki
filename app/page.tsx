import { requireChatGPTUser } from './chatgpt-auth';
import { getState } from '../lib/service';
import ShoppingApp from './shopping-app';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await requireChatGPTUser('/');
  return <ShoppingApp initial={await getState(user)} />;
}
