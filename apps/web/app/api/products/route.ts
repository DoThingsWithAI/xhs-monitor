import {NextRequest,NextResponse} from 'next/server';
import {getAdmin,sameOrigin} from '@/packages/core/auth';
import {db} from '@/packages/db';
import {createProduct} from '@/packages/db/queue';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 const rows=db().prepare("SELECT p.*,b.status AS binding_status,b.last_success_at,b.next_due_at,b.consecutive_failures, o.sales_raw_text,o.sales_precision,o.price_minor,o.observed_at FROM products p LEFT JOIN product_source_bindings b ON b.product_id=p.id AND b.source_id='xhs-browser' LEFT JOIN product_observations o ON o.id=(SELECT id FROM product_observations WHERE product_id=p.id ORDER BY observed_at DESC LIMIT 1) WHERE p.monitor_status<>'deleted' ORDER BY p.created_at DESC LIMIT 150").all();
 return NextResponse.json({data:rows});
}
export async function POST(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 if(!sameOrigin(req))return NextResponse.json({error:'BAD_ORIGIN'},{status:403});
 let body:any;try{body=await req.json();}catch{return NextResponse.json({error:'INVALID_JSON'},{status:400});}
 const urls=Array.isArray(body.urls)?body.urls:[body.url];
 if(urls.length>20||urls.length===0)return NextResponse.json({error:'MAX_20_ITEMS'},{status:400});
 const results=[];
 for(const url of urls){
  try{results.push({...createProduct(url,typeof body.category==='string'?body.category:''),url});}
  catch(e){results.push({url,error:e instanceof Error?e.message:'INVALID_URL'});}
 }
 return NextResponse.json({data:results},{status:201});
}
