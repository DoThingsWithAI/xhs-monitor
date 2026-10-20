import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initSchema} from '../packages/db';
import {getProductSalesTrends} from '../packages/db/product-trends';

test('product cards receive only 30 newest valid sales samples in chronological order',()=>{
 const d=new Database(':memory:');
 try{
  initSchema(d);
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
  assert.equal(trends['product-A'][0].sales,7);
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
