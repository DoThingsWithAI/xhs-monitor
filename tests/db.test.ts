import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const path=mkdtempSync(join(tmpdir(),'xhs-monitor-'));
process.env.DB_PATH=join(path,'test.sqlite');

test('authorization defaults to disabled; scheduling and claiming are durable',async()=>{
 const {db}=await import('../packages/db');
 const {createProduct,scheduleDue,claimJob}=await import('../packages/db/queue');
 const d=db();
 const originalSelectors=JSON.parse((d.prepare("SELECT selectors_json FROM data_sources WHERE id='xhs-browser'").get() as {selectors_json:string}).selectors_json);
 assert.equal(originalSelectors.sales,'.price-container .spu-text');
 assert.equal(originalSelectors.price,'.price-container .price');
 assert.equal(originalSelectors.shopRating,'.seller-container .score-text');
 assert.equal(originalSelectors.shopStats,'.seller-container .name-info .sub-title');
 const cols=(d.pragma('table_info(product_observations)') as Array<{name:string}>).map(x=>x.name);
 for(const name of ['shop_rating_raw_text','shop_rating_hundredths','shop_sales_raw_text','shop_sales_value','shop_sales_precision','shop_followers_raw_text','shop_followers_value','shop_followers_precision'])
  assert.ok(cols.includes(name),name);
 assert.equal((d.prepare("SELECT enabled FROM data_sources WHERE id='xhs-browser'").get() as {enabled:number}).enabled,0);
 const result=createProduct('https://www.xiaohongshu.com/goods-detail/6a290d7c3222c60001e051bf?xsec_token=PRIVATE_SHARE_TOKEN&instation_link=nested_token&share_id=track');
 assert.equal((d.prepare('SELECT platform_product_id FROM products WHERE id=?').get(result.id) as {platform_product_id:string}).platform_product_id,'6a290d7c3222c60001e051bf');
 assert.equal((d.prepare('SELECT canonical_url FROM products WHERE id=?').get(result.id) as {canonical_url:string}).canonical_url,'https://www.xiaohongshu.com/goods-detail/6a290d7c3222c60001e051bf');
 assert.equal((d.prepare('SELECT original_url FROM products WHERE id=?').get(result.id) as {original_url:string}).original_url,'https://www.xiaohongshu.com/goods-detail/6a290d7c3222c60001e051bf');
 assert.equal(createProduct('https://m.xiaohongshu.com/goods-detail/6a290d7c3222c60001e051bf?share_id=second').created,false);
 assert.equal((d.prepare('SELECT count(*) AS n FROM products').get() as {n:number}).n,1);
 assert.equal(result.created,true);
 assert.equal(result.monitoring,'awaiting_source_authorization');
 assert.equal(scheduleDue(),0);
 assert.equal((d.prepare('SELECT count(*) AS n FROM collection_jobs').get() as {n:number}).n,0);
 const now=Date.now();
 d.prepare("UPDATE data_sources SET enabled=1,automated_access_allowed=1,storage_allowed=1,analysis_allowed=1,permission_basis='License documented for internal monitoring',updated_at=? WHERE id='xhs-browser'").run(now);
 d.prepare("UPDATE product_source_bindings SET status='ready' WHERE product_id=?").run(result.id);
 assert.equal(scheduleDue(),1);
 assert.equal(scheduleDue(),0);
 const job=claimJob('test-owner');
 assert.ok(job);
 assert.equal(job?.product_id,result.id);
 assert.equal(job?.attempt_count,1);
 assert.equal(claimJob('other-owner'),null);
 assert.equal((d.prepare('SELECT count(*) AS n FROM collection_jobs').get() as {n:number}).n,1);
 assert.equal((d.prepare('SELECT count(*) AS n FROM collection_runs').get() as {n:number}).n,1);
});
test('legacy stored share URLs are reused and scrubbed when re-added',async()=>{
 const {db,uuid}=await import('../packages/db');
 const {createProduct}=await import('../packages/db/queue');
 const d=db(), id=uuid(), stamp=Date.now();
 const old='https://www.xiaohongshu.com/goods-detail/7a290d7c3222c60001e051bf?instation_link=PRIVATE&share_id=private';
 d.prepare('INSERT INTO products (id,original_url,canonical_url,created_at,updated_at) VALUES (?,?,?,?,?)')
   .run(id,old,old,stamp,stamp);
 const result=createProduct('https://www.xiaohongshu.com/goods-detail/7a290d7c3222c60001e051bf?xsec_token=OTHER');
 assert.equal(result.created,false);
 assert.equal(result.id,id);
 const stored=d.prepare('SELECT canonical_url,original_url,platform_product_id FROM products WHERE id=?').get(id) as {canonical_url:string;original_url:string;platform_product_id:string};
 assert.equal(stored.canonical_url,'https://www.xiaohongshu.com/goods-detail/7a290d7c3222c60001e051bf');
 assert.equal(stored.original_url,stored.canonical_url);
 assert.equal(stored.platform_product_id,'7a290d7c3222c60001e051bf');
});
test.after(()=>rmSync(path,{recursive:true,force:true}));

test('migration expands legacy snapshot schema and preserves historical values',async()=>{
 const Database=(await import('better-sqlite3')).default;
 const {initSchema}=await import('../packages/db');
 const legacy=new Database(':memory:');
 try{
  legacy.exec("CREATE TABLE product_observations (id TEXT PRIMARY KEY,product_id TEXT,source_id TEXT,observed_at INTEGER,sales_value INTEGER); INSERT INTO product_observations (id,product_id,source_id,observed_at,sales_value) VALUES ('old','p','s',1,431);");
  initSchema(legacy);
  initSchema(legacy);
  const historic=legacy.prepare("SELECT sales_value,shop_sales_value,shop_followers_value,shop_rating_hundredths,shop_sales_precision FROM product_observations WHERE id='old'").get() as any;
  assert.equal(historic.sales_value,431);
  assert.equal(historic.shop_sales_value,null);
  assert.equal(historic.shop_followers_value,null);
  assert.equal(historic.shop_rating_hundredths,null);
  assert.equal(historic.shop_sales_precision,'missing');
 }finally{legacy.close();}
});

test('worker scheduling reconciles stale awaiting binding only when source is authorized',async()=>{
 const {db,uuid}=await import('../packages/db');
 const {scheduleDue}=await import('../packages/db/queue');
 const d=db(),ts=Date.now();
 const pid=uuid(),bindingId=uuid(),link='https://www.xiaohongshu.com/goods-detail/8a290d7c3222c60001e051bf';
 d.prepare('INSERT INTO products (id,original_url,canonical_url,created_at,updated_at) VALUES (?,?,?,?,?)').run(pid,link,link,ts,ts);
 d.prepare("INSERT INTO product_source_bindings (id,product_id,source_id,status,interval_seconds,next_due_at,created_at,updated_at) VALUES (?,?,'xhs-browser','awaiting_authorization',86400,?,?,?)")
  .run(bindingId,pid,ts,ts,ts);
 d.prepare("UPDATE data_sources SET enabled=0 WHERE id='xhs-browser'").run();
 scheduleDue();
 assert.equal((d.prepare('SELECT status FROM product_source_bindings WHERE id=?').get(bindingId) as {status:string}).status,'awaiting_authorization');
 const before=(d.prepare('SELECT count(*) AS n FROM collection_jobs WHERE binding_id=?').get(bindingId) as {n:number}).n;
 assert.equal(before,0);
 d.prepare("UPDATE data_sources SET enabled=1,automated_access_allowed=1,storage_allowed=1,analysis_allowed=1,permission_basis='Documented automated access and storage permission',permission_expires_at=NULL WHERE id='xhs-browser'").run();
 // Deliberately simulate a previously authorized source with a stale awaiting row.
 scheduleDue();
 assert.equal((d.prepare('SELECT status FROM product_source_bindings WHERE id=?').get(bindingId) as {status:string}).status,'ready');
 assert.equal((d.prepare("SELECT count(*) AS n FROM collection_jobs WHERE binding_id=? AND status='queued'").get(bindingId) as {n:number}).n,1);
 scheduleDue();
 assert.equal((d.prepare('SELECT count(*) AS n FROM collection_jobs WHERE binding_id=?').get(bindingId) as {n:number}).n,1);
});
