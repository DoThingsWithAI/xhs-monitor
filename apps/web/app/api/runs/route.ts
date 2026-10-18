import {NextRequest,NextResponse} from 'next/server';
import {getAdmin,sameOrigin} from '../../../../packages/core/auth';
import {db} from '../../../../packages/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 return NextResponse.json({data:db().prepare("SELECT r.id,r.started_at,r.finished_at,r.result,r.error_code,r.attempt_no,p.title,p.canonical_url FROM collection_runs r JOIN collection_jobs j ON j.id=r.job_id JOIN product_source_bindings b ON b.id=j.binding_id JOIN products p ON p.id=b.product_id ORDER BY r.started_at DESC LIMIT 80").all()});
}
