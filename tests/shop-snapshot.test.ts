import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initSchema} from '../packages/db';
import {insertCollectedObservation} from '../packages/db/save-observation';
import {parseSales,parsePrice} from '../packages/core/metrics';
import {parseShopRating,parseShopStats} from '../packages/core/shop-metrics';

test('real SQLite insert stores product and seller metrics separately, preserving missing/zero',()=>{
 const d=new Database(':memory:');
 try{
  initSchema(d);
  const timestamp=Date.now();
  d.prepare('INSERT INTO products (id,original_url,canonical_url,created_at,updated_at) VALUES (?,?,?,?,?)')
   .run('p','https://www.xiaohongshu.com/goods-detail/6a290d7c3222c60001e051bf',
    'https://www.xiaohongshu.com/goods-detail/6a290d7c3222c60001e051bf',timestamp,timestamp);
  d.prepare('INSERT INTO product_source_bindings (id,product_id,source_id,next_due_at,created_at,updated_at) VALUES (?,?,?,?,?,?)')
   .run('b','p','xhs-browser',timestamp,timestamp,timestamp);
  function createJob(id:string){
   d.prepare('INSERT INTO collection_jobs (id,binding_id,scheduled_for,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id,'b',timestamp,id+'-key',timestamp,timestamp);
   d.prepare('INSERT INTO collection_runs (id,job_id,attempt_no,started_at) VALUES (?,?,?,?)')
    .run(id+'-run',id,1,timestamp);
  }
  createJob('j1');
  const labels=['卖家口碑','粉丝数 1261','已售426'];
  const observation={
   title:'快采采 | 智能表格模板',shop:'辰星提效社的店',
   sales:parseSales('已售431'),price:parsePrice('¥19.9'),
   shopRating:parseShopRating('4.32'),...parseShopStats(labels)
  };
  insertCollectedObservation(d,{id:'j1',product_id:'p',source_id:'xhs-browser'},
   'j1-run',timestamp,observation,'success');
  const r=d.prepare('SELECT * FROM product_observations WHERE job_id=?').get('j1') as any;
  assert.equal(r.sales_value,431);
  assert.equal(r.sales_precision,'exact');
  assert.equal(r.price_minor,1990);
  assert.equal(r.shop_observed,'辰星提效社的店');
  assert.equal(r.shop_rating_raw_text,'4.32');
  assert.equal(r.shop_rating_hundredths,432);
  assert.equal(r.shop_sales_raw_text,'已售426');
  assert.equal(r.shop_sales_value,426);
  assert.equal(r.shop_sales_precision,'exact');
  assert.equal(r.shop_followers_raw_text,'粉丝数 1261');
  assert.equal(r.shop_followers_value,1261);
  assert.equal(r.shop_followers_precision,'exact');
  assert.equal(r.observed_at,timestamp);
  // Unique job_id means duplicated delivery cannot add a second observation.
  insertCollectedObservation(d,{id:'j1',product_id:'p',source_id:'xhs-browser'},
   'j1-run',timestamp,observation,'success');
  assert.equal((d.prepare("SELECT count(*) AS n FROM product_observations").get() as any).n,1);
  createJob('j2');
  insertCollectedObservation(d,{id:'j2',product_id:'p',source_id:'xhs-browser'},
   'j2-run',timestamp+1,{
    title:null,shop:null,sales:parseSales(null),price:parsePrice(null),
    shopRating:parseShopRating(null),...parseShopStats([])
   },'partial');
  const missing=d.prepare('SELECT * FROM product_observations WHERE job_id=?').get('j2') as any;
  assert.equal(missing.sales_value,null);
  assert.equal(missing.shop_sales_value,null);
  assert.equal(missing.shop_followers_value,null);
  assert.equal(missing.shop_rating_hundredths,null);
  assert.equal(missing.shop_sales_precision,'missing');
  assert.equal(missing.shop_followers_precision,'missing');
  createJob('j3');
  insertCollectedObservation(d,{id:'j3',product_id:'p',source_id:'xhs-browser'},
   'j3-run',timestamp+2,{...observation,sales:parseSales('已售0')},'success');
  const zero=d.prepare('SELECT sales_value FROM product_observations WHERE job_id=?').get('j3') as {sales_value:number};
  assert.equal(zero.sales_value,0);
 }finally{d.close();}
});
