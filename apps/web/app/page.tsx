import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {getAdminFromToken,sessionCookieName} from '@/packages/core/auth';
import Dashboard from './dashboard';
export const dynamic='force-dynamic';
export default async function Home(){
 const store=await cookies();
 const admin=getAdminFromToken(store.get(sessionCookieName())?.value);
 if(!admin)redirect('/login');
 return <Dashboard username={admin.username}/>;
}
