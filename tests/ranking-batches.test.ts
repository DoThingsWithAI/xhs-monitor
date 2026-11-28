import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initSchema} from '../packages/db';
import {getRankingBatches} from '../packages/db/ranking-batches';
import {getHotProductScores,getProductSalesTrends} from '../packages/db/product-trends';
import {sortProductsByValue} from '../packages/core/product-ranking';

test('publish whole daily batches, not partial refreshes, even across midnight',()=>{
 const d=new Database(':memory:');
 try{
  initSchema(d);d.pragma('foreign_keys = OFF');
  const at=(date:string)=>Date.parse(date+'T19:00:00+08:00');
  const batch=(day:string,total:number)=>d.prepare('INSERT INTO daily_collection_batches VALUES (?,?,?,?)').run(day,at(day),total,at(day));
  const job=(day:string,p:string,status:string,sales?:number,offset=1)=>{
   const id=day+p,t=at(day)+offset;
   d.prepare('INSERT INTO collection_jobs (id,binding_id,scheduled_for,status,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id,p,at(day),status,'daily:'+p+':'+day,at(day),t);
   if(sales!==undefined)d.prepare("INSERT INTO product_observations (id,product_id,source_id,job_id,run_id,observed_at,sales_value,sales_precision,price_minor,price_kind,quality_status) VALUES (?,?, 'xhs-browser',?,?,?,?,'exact',1000,'exact','success')").run(id,p,id,'r'+id,t,sales);
  };
  const a='2026-11-26',b='2026-11-27',c='2026-11-28',e='2026-11-29';
  batch(a,2);job(a,'A','succeeded',100);job(a,'B','succeeded',100);
  batch(b,2);job(b,'A','succeeded',120);job(b,'B','succeeded',110);
  const score=(day:string)=>getHotProductScores(d,['A','B'],'xhs-browser',at(day),day);
  const rank=(day:string)=>Object.entries(score(day)).map(([id,hot_score])=>({id,hot_score}));
  assert.equal(getRankingBatches(d).selected?.date,b);
  assert.deepEqual(sortProductsByValue(rank(b)).map(x=>x.id),['A','B']);
  batch(c,2);job(c,'B','succeeded',200);job(c,'A','retry_wait');
  assert.equal(getRankingBatches(d).latest?.state,'pending');
  assert.equal(getRankingBatches(d).selected?.date,b);
  assert.deepEqual(sortProductsByValue(rank(getRankingBatches(d).selected!.date)).map(x=>x.id),['A','B']);
  assert.equal(getProductSalesTrends(d,['B'],'xhs-browser',30,getRankingBatches(d).cutoff).B.at(-1)?.sales,110);
  d.prepare("UPDATE collection_jobs SET status='failed',updated_at=? WHERE id=?").run(at(c)+6*3600000,c+'A');
  assert.equal(getRankingBatches(d).selected?.date,c);
  assert.equal(score(c).A.todaySales,null);
  assert.equal(score(c).B.todaySales,90);
  assert.equal(getRankingBatches(d,b).selected?.date,b);
  batch(e,1);job(e,'B','failed');
  assert.equal(getRankingBatches(d).latest?.state,'failed');
  assert.equal(getRankingBatches(d).selected?.date,c);
  batch('2026-11-30',0);
  assert.equal(getRankingBatches(d).selected?.date,c);
 }finally{d.close();}
});
