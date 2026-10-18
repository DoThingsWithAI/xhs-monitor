import {NextRequest,NextResponse} from 'next/server';
import {getAdmin,sameOrigin} from '@/packages/core/auth';
import {db} from '@/packages/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 return NextResponse.json({data:db().prepare('SELECT * FROM alert_events ORDER BY last_seen_at DESC LIMIT 100').all()});
}
