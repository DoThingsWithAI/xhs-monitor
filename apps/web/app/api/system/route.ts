import {NextRequest,NextResponse} from 'next/server';
import {getAdmin,sameOrigin} from '../../../../packages/core/auth';
import {db} from '../../../../packages/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 const d=db();
 const stats=d.prepare("SELECT (SELECT count(*) FROM products WHERE monitor_status<>'deleted') AS products, (SELECT count(*) FROM product_source_bindings WHERE status='ready') AS ready, (SELECT count(*) FROM product_source_bindings WHERE status='blocked') AS blocked, (SELECT count(*) FROM alert_events WHERE status='open') AS alerts, (SELECT last_seen_at FROM system_heartbeats WHERE name='worker') AS worker_heartbeat").get();
 const jobs=d.prepare('SELECT status,count(*) AS count FROM collection_jobs GROUP BY status').all();
 return NextResponse.json({data:{stats,jobs}});
}
