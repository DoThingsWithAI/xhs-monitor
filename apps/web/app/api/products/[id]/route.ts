import {NextRequest,NextResponse} from 'next/server';
import {getAdmin,sameOrigin} from '../../../../../packages/core/auth';
import {db} from '../../../../../packages/db';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:NextRequest,ctx:{params:Promise<{id:string}>}){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 const {id}=await ctx.params;
 const p=db().prepare('SELECT * FROM products WHERE id=? AND monitor_status<>?').get(id,'deleted');
 if(!p)return NextResponse.json({error:'NOT_FOUND'},{status:404});
 const observations=db().prepare('SELECT * FROM product_observations WHERE product_id=? ORDER BY observed_at DESC LIMIT 240').all(id);
 return NextResponse.json({data:{product:p,observations}});
}
export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 if(!sameOrigin(req))return NextResponse.json({error:'BAD_ORIGIN'},{status:403});
 const {id}=await ctx.params;
 let body:any;try{body=await req.json();}catch{return NextResponse.json({error:'INVALID_JSON'},{status:400});}
 const status=body.monitor_status;
 if(!['active','paused','deleted'].includes(status))return NextResponse.json({error:'INVALID_STATUS'},{status:400});
 const result=db().prepare('UPDATE products SET monitor_status=?,updated_at=?,deleted_at=? WHERE id=?')
 .run(status,Date.now(),status==='deleted'?Date.now():null,id);
 if(!result.changes)return NextResponse.json({error:'NOT_FOUND'},{status:404});
 if(status==='deleted'||status==='paused')db().prepare("UPDATE collection_jobs SET status='cancelled' WHERE status IN ('queued','retry_wait') AND binding_id IN (SELECT id FROM product_source_bindings WHERE product_id=?)").run(id);
 return NextResponse.json({data:{ok:true}});
}
