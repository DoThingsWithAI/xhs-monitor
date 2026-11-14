import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initSchema} from '../packages/db';
import {getProductSalesTrends,getHotProductScores} from '../packages/db/product-trends';

test('product cards receive only 30 newest valid sales samples in chronological order',()=>{
 const d=new Database(':memory:');
 try{
  initSchema(d);
  // Read-only query unit test: use synthetic observation IDs without creating
  // every parent job/run. Production inserts are FK-enforced and tested elsewhere.
  d.pragma('foreign_keys = OFF');
  const insert=d.prepare(
   "INSERT INTO product_observations "+
   "(id,product_id,source_id,job_id,run_id,observed_at,sales_raw_text,sales_value,sales_precision,price_kind,quality_status) "+
   "VALUES (?,?,?,?,?,?,?,?,?,'missing','success')"
  );
  for(let n=0;n<37;n++){
   const sales=n===11?null:n;
   insert.run('a'+n,'product-A','xhs-browser','job-a'+n,'run-a'+n,1700000000000+n*86400000,
    sales===null?null:'已售'+sales,sales,sales===null?'missing':'exact');
  }
  insert.run('other-source','product-A','other','job-other','run-other',1900000000000,'已售99999',99999,'exact');
  insert.run('other-product','product-B','xhs-browser','job-b','run-b',1900000000000,'已售7',7,'exact');
  const trends=getProductSalesTrends(d,['product-A','product-B','product-C']);
  assert.equal(trends['product-A'].length,30);
  assert.equal(trends['product-A'][0].sales,6);
  assert.equal(trends['product-A'].at(-1)?.sales,36);
  assert.equal(trends['product-A'].some(x=>x.sales===11),false);
  assert.ok(trends['product-A'].every((point,i,arr)=>i===0||point.t>=arr[i-1].t));
  assert.deepEqual(trends['product-B'].map(x=>x.sales),[7]);
  assert.deepEqual(trends['product-C'],[]);
  assert.equal(getProductSalesTrends(d,['product-A'],'xhs-browser',2)['product-A'].length,2);
 }finally{d.close();}
});
test('zero sales is a valid point, missing and different scopes never become fabricated zeros',()=>{
 const d=new Database(':memory:');
 try{
  initSchema(d);
  d.pragma('foreign_keys = OFF');
  const stmt=d.prepare("INSERT INTO product_observations "+
   "(id,product_id,source_id,job_id,run_id,observed_at,sales_raw_text,sales_value,sales_precision,price_kind,quality_status) "+
   "VALUES (?,?,?,?,?,?,?,?,?,'missing','partial')");
  stmt.run('zero','p','xhs-browser','jzero','rzero',1,'已售0',0,'exact');
  stmt.run('missing','p','xhs-browser','jmiss','rmiss',2,null,null,'missing');
  stmt.run('lower','p','xhs-browser','jlow','rlow',3,'已售1万+',10000,'lower_bound');
  const points=getProductSalesTrends(d,['p']).p;
  assert.deepEqual(points.map(p=>p.sales),[0,10000]);
  assert.deepEqual(points.map(p=>p.precision),['exact','lower_bound']);
  assert.equal(points[1].sales_raw_text,'已售1万+');
 }finally{d.close();}
});


test('hot product score uses Shanghai calendar day and exact cumulative snapshots only',()=>{
 const d=new Database(':memory:');
 try{
  initSchema(d);d.pragma('foreign_keys = OFF');
  const insert=d.prepare(
   "INSERT INTO product_observations "+
   "(id,product_id,source_id,job_id,run_id,observed_at,sales_raw_text,sales_value,sales_precision,price_kind,quality_status) "+
   "VALUES (?,?,?,?,?,?,?,?,?,'missing','success')"
  );
  const when=(v:string)=>Date.parse(v);
  const put=(id:string,pid:string,ts:string,sales:number|null,precision:'exact'|'lower_bound'|'missing'='exact',source='xhs-browser')=>
   insert.run(id,pid,source,'j'+id,'r'+id,when(ts),sales===null?null:'已售'+sales,sales,precision);
  // Includes the precise day boundary, not the host server's timezone.
  put('prev','good','2026-11-13T23:59:00+08:00',800);
  put('curr','good','2026-11-14T00:01:00+08:00',1000);
  // Missing later observations must not turn the baseline into zero.
  put('missing','good','2026-11-14T12:00:00+08:00',null,'missing');
  // A different data source must not affect the score.
  put('other','good','2026-11-14T13:00:00+08:00',9000,'exact','other');
  put('only','new','2026-11-14T12:00:00+08:00',150);
  put('rounded-prev','rounded','2026-11-13T12:00:00+08:00',10000,'lower_bound');
  put('rounded-today','rounded','2026-11-14T12:00:00+08:00',12000);
  put('zero-prev','zero','2026-11-13T12:00:00+08:00',0);
  put('zero-today','zero','2026-11-14T12:00:00+08:00',0);
  put('same-prev','same','2026-11-13T12:00:00+08:00',120);
  put('same-today','same','2026-11-14T12:00:00+08:00',120);
  put('decrease-prev','decrease','2026-11-13T12:00:00+08:00',200);
  put('decrease-today','decrease','2026-11-14T12:00:00+08:00',190);
  put('starting-prev','starting','2026-11-13T12:00:00+08:00',100);
  put('starting-today','starting','2026-11-14T12:00:00+08:00',120);
  put('no-price-prev','no-price','2026-11-13T12:00:00+08:00',100);
  put('no-price-today','no-price','2026-11-14T12:00:00+08:00',120);
  put('free-prev','free','2026-11-13T12:00:00+08:00',100);
  put('free-today','free','2026-11-14T12:00:00+08:00',120);
  const setPrice=d.prepare("UPDATE product_observations SET price_minor=?,price_kind=? WHERE id=?");
  setPrice.run(2990,'exact','curr'); // ¥29.90, today's increment is 200 at 20%
  setPrice.run(2000,'exact','prev'); // Yesterday's price must never be used.
  setPrice.run(500,'exact','only');
  setPrice.run(500,'exact','rounded-today');
  setPrice.run(500,'exact','zero-today');
  setPrice.run(1700,'exact','same-today');
  setPrice.run(500,'exact','decrease-today');
  setPrice.run(1099,'starting_from','starting-today');
  setPrice.run(0,'exact','free-today');
  const scores=getHotProductScores(d,['good','new','rounded','zero','same','decrease','starting','no-price','free'],'xhs-browser',when('2026-11-14T18:00:00+08:00'));
  assert.equal(scores.good.todaySales,200);
  assert.equal(scores.good.rate,0.2);
  assert.equal(scores.good.productValueCents,119600); // ¥29.90 * 200 * 0.2 = ¥1,196
  assert.equal(scores.good.observedAt,when('2026-11-14T00:01:00+08:00'));
  for(const id of ['new','rounded','zero','decrease']){
   assert.equal(scores[id].todaySales,null,id);
   assert.equal(scores[id].rate,null,id);
   assert.equal(scores[id].productValueCents,null,id);
  }
  assert.equal(scores.same.todaySales,0);
  assert.equal(scores.same.rate,0);
  assert.equal(scores.same.productValueCents,0); // A real zero increment is a valid zero value.
  assert.equal(scores.starting.todaySales,20);
  assert.equal(scores.starting.productValueCents,null); // A "starting from" price is not a ticket.
  assert.equal(scores['no-price'].todaySales,20);
  assert.equal(scores['no-price'].productValueCents,null);
  assert.equal(scores.free.productValueCents,0);
  // Yesterday's sample is no longer valid when it becomes two days old.
  const tomorrow=getHotProductScores(d,['good'],'xhs-browser',when('2026-11-15T12:00:00+08:00'));
  assert.equal(tomorrow.good.rate,null);
  assert.equal(tomorrow.good.productValueCents,null);
 }finally{d.close();}
});
