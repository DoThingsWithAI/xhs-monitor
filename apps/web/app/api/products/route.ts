import {NextRequest,NextResponse} from 'next/server';
import {getAdmin,sameOrigin} from '@/packages/core/auth';
import {db} from '@/packages/db';
import {createProduct} from '@/packages/db/queue';
import {getProductSalesTrends,getHotProductScores} from '@/packages/db/product-trends';
import {sortProductsByValue} from '@/packages/core/product-ranking';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 const rows=db().prepare("SELECT p.*,b.status AS binding_status,b.last_success_at,b.last_attempt_at,b.next_due_at,b.consecutive_failures, latest_job.status AS latest_job_status,latest_job.idempotency_key AS latest_job_idempotency_key,CASE WHEN b.status='ready' AND p.monitor_status='active' AND latest_job.status='failed' AND s.kind='licensed_browser' AND s.enabled=1 AND s.automated_access_allowed=1 AND s.storage_allowed=1 AND s.analysis_allowed=1 AND length(trim(s.permission_basis))>=12 AND (s.permission_expires_at IS NULL OR s.permission_expires_at>?) AND NOT EXISTS(SELECT 1 FROM collection_jobs pending WHERE pending.binding_id=b.id AND pending.status IN ('queued','running','retry_wait')) THEN 1 ELSE 0 END AS manual_retry_available, (SELECT r.error_code FROM collection_runs r JOIN collection_jobs j ON j.id=r.job_id WHERE j.binding_id=b.id ORDER BY r.started_at DESC,r.rowid DESC LIMIT 1) AS latest_error_code, (SELECT r.error_message_redacted FROM collection_runs r JOIN collection_jobs j ON j.id=r.job_id WHERE j.binding_id=b.id ORDER BY r.started_at DESC,r.rowid DESC LIMIT 1) AS latest_error_diagnostic, o.sales_raw_text,o.sales_precision,o.price_minor,o.observed_at,o.shop_rating_raw_text,o.shop_rating_hundredths,o.shop_sales_raw_text,o.shop_sales_value,o.shop_sales_precision,o.shop_followers_raw_text,o.shop_followers_value,o.shop_followers_precision FROM products p LEFT JOIN product_source_bindings b ON b.product_id=p.id AND b.source_id='xhs-browser' LEFT JOIN data_sources s ON s.id=b.source_id LEFT JOIN collection_jobs latest_job ON latest_job.id=(SELECT id FROM collection_jobs WHERE binding_id=b.id ORDER BY created_at DESC,rowid DESC LIMIT 1) LEFT JOIN product_observations o ON o.id=(SELECT id FROM product_observations WHERE product_id=p.id ORDER BY observed_at DESC LIMIT 1) WHERE p.monitor_status<>'deleted' ORDER BY p.created_at DESC LIMIT 150").all(Date.now());
 const ids=(rows as Array<{id:string}>).map(row=>row.id);
 const trends=getProductSalesTrends(db(),ids,'xhs-browser');
 const hotScores=getHotProductScores(db(),ids,'xhs-browser');
 const products=(rows as Array<{id:string}>).map(row=>({...row,trend_points:trends[row.id]||[],hot_score:hotScores[row.id]}));
 return NextResponse.json({data:sortProductsByValue(products)});
}
export async function POST(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 if(!sameOrigin(req))return NextResponse.json({error:'BAD_ORIGIN'},{status:403});
 let body:any;try{body=await req.json();}catch{return NextResponse.json({error:'INVALID_JSON'},{status:400});}
 const urls=Array.isArray(body.urls)?body.urls:[body.url];
 if(urls.length>20||urls.length===0)return NextResponse.json({error:'MAX_20_ITEMS'},{status:400});
 const results=[];
 for(const [index,url] of urls.entries()){
  // Never echo share tokens or nested tracking URLs back to the client.
  try{results.push({index,...createProduct(url,typeof body.category==='string'?body.category:'')});}
  catch(e){results.push({index,error:e instanceof Error?e.message:'INVALID_URL'});}
 }
 return NextResponse.json({data:results},{status:201});
}
