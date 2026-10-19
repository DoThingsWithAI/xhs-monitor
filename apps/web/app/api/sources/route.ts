import {NextRequest,NextResponse} from 'next/server';
import {getAdmin,sameOrigin} from '@/packages/core/auth';
import {db} from '@/packages/db';
import {activateAwaitingBindings} from '@/packages/db/queue';
import {validateSourceForm} from '@/packages/core/source-form-validation';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 return NextResponse.json({data:db().prepare('SELECT * FROM data_sources ORDER BY id').all()});
}
export async function PATCH(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 if(!sameOrigin(req))return NextResponse.json({error:'BAD_ORIGIN'},{status:403});
 let body:any;try{body=await req.json();}catch{return NextResponse.json({error:'INVALID_JSON'},{status:400});}
 const enabled=body.enabled===true?1:0;
 const basis=typeof body.permission_basis==='string'?body.permission_basis.trim().slice(0,600):'';
 const sales=typeof body.salesSelector==='string'?body.salesSelector.trim().slice(0,250):'';
 const title=typeof body.titleSelector==='string'?body.titleSelector.trim().slice(0,250):'';
 const price=typeof body.priceSelector==='string'?body.priceSelector.trim().slice(0,250):'';
 const shop=typeof body.shopSelector==='string'?body.shopSelector.trim().slice(0,250):'';
 const shopRating=typeof body.shopRatingSelector==='string'?body.shopRatingSelector.trim().slice(0,250):'';
 const shopStats=typeof body.shopStatsSelector==='string'?body.shopStatsSelector.trim().slice(0,250):'';
 const problems=validateSourceForm({
  enabled:!!enabled,automated_access_allowed:body.automated_access_allowed===true,
  storage_allowed:body.storage_allowed===true,analysis_allowed:body.analysis_allowed===true,
  permission_basis:basis,titleSelector:title,salesSelector:sales
 });
 if(problems.length)
  return NextResponse.json({error:'PERMISSION_AND_SELECTORS_REQUIRED',details:problems},{status:400});
 const ts=Date.now(),d=db();
 d.transaction(()=>{
  d.prepare('UPDATE data_sources SET enabled=?,automated_access_allowed=?,storage_allowed=?,analysis_allowed=?,permission_basis=?,selectors_json=?,updated_at=? WHERE id=?')
   .run(enabled,body.automated_access_allowed===true?1:0,body.storage_allowed===true?1:0,body.analysis_allowed===true?1:0,basis,JSON.stringify({title,sales,price,shop,shopRating,shopStats}),ts,'xhs-browser');
  if(enabled){
   activateAwaitingBindings(d,'xhs-browser',ts);
  }else{
   d.prepare("UPDATE product_source_bindings SET status='awaiting_authorization',updated_at=? WHERE source_id='xhs-browser' AND status='ready'").run(ts);
   d.prepare("UPDATE collection_jobs SET status='cancelled',updated_at=? WHERE status IN ('queued','retry_wait') AND binding_id IN (SELECT id FROM product_source_bindings WHERE source_id='xhs-browser')").run(ts);
  }
  d.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),'admin','update_source_permission','data_sources','xhs-browser',ts);
 })();
 return NextResponse.json({data:{saved:true,enabled:!!enabled}});
}
