import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const testDir=mkdtempSync(join(tmpdir(),'xhs-pacing-'));
process.env.DB_PATH=join(testDir,'test.sqlite');
test.after(()=>rmSync(testDir,{recursive:true,force:true}));
import {parseSourceGapSeconds} from '../packages/core/pacing';

// Use a standalone :memory: database for source pacing functions that accept a DB.
test('source interval config enforces a conservative 60-second floor',()=>{
 assert.equal(parseSourceGapSeconds(undefined),120);
 assert.equal(parseSourceGapSeconds('5'),60);
 assert.equal(parseSourceGapSeconds('0'),60);
 assert.equal(parseSourceGapSeconds('90'),90);
 assert.equal(parseSourceGapSeconds('60000'),3600);
 assert.equal(parseSourceGapSeconds('n/a'),120);
});
test('persisted gate holds until after the previous observation completes',async()=>{
 const {db,uuid}=await import('../packages/db');
 const {claimJob,finishSourceRequest,suspendSourceAfterRestriction,activateAwaitingBindings}=await import('../packages/db/queue');
 const d=db();
 // Isolate this from tests/db.test.ts using a synthetic source and three jobs.
 const ts=Date.now()+1000000;
 const source='test-paced-'+uuid();
 d.prepare("INSERT INTO data_sources(id,name,kind,enabled,automated_access_allowed,storage_allowed,analysis_allowed,permission_basis,minimum_interval_seconds,allowed_hosts_json,selectors_json,created_at,updated_at) VALUES(?,?,?,1,1,1,1,?,86400,?,?,?,?)")
 .run(source,source,'licensed_browser','Documented authorized source for automated access','["xiaohongshu.com"]','{"title":".goods-name","sales":".spu-text"}',ts,ts);
 const ids=[];
 for(let n=0;n<3;n++){
  const product=uuid(),binding=uuid(),job=uuid(),canonical='https://www.xiaohongshu.com/goods-detail/'+('9'+n.toString()+'a290d7c3222c60001e051b').slice(0,24);
  d.prepare('INSERT INTO products(id,original_url,canonical_url,created_at,updated_at) VALUES(?,?,?,?,?)')
   .run(product,canonical,canonical,ts+n,ts+n);
  d.prepare("INSERT INTO product_source_bindings(id,product_id,source_id,status,next_due_at,created_at,updated_at) VALUES(?,?,?,'ready',?,?,?)")
   .run(binding,product,source,ts+n,ts+n,ts+n);
  d.prepare("INSERT INTO collection_jobs(id,binding_id,scheduled_for,status,idempotency_key,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)")
   .run(job,binding,ts+n,source+':'+n,ts+n,ts+n);
  ids.push(job);
 }
 // claimJob uses the real configured DB singleton, which includes this synthetic data source.
 const one=claimJob('spaced-worker',ts,120000);
 assert.equal(one?.id,ids[0]);
 assert.equal(claimJob('another-worker',ts+119999,120000),null);
 // Mark first complete, and guarantee full delay since completion, not just start.
 d.prepare("UPDATE collection_jobs SET status='succeeded' WHERE id=?").run(ids[0]);
 finishSourceRequest(d,source,ts+60000,120000);
 assert.equal(claimJob('another-worker',ts+179999,120000),null);
 const two=claimJob('another-worker',ts+180000,120000);
 assert.equal(two?.id,ids[1]);
 // The gate lives in SQLite, so a restarted worker still sees the same timing.
 assert.equal((d.prepare('SELECT next_allowed_at FROM source_request_pacing WHERE source_id=?').get(source) as {next_allowed_at:number}).next_allowed_at,ts+300000);
 // Site access restriction should stop the entire source and cancel remaining queued requests.
 suspendSourceAfterRestriction(d,source,'ACCESS_BLOCKED',ts+180000);
 assert.equal((d.prepare('SELECT enabled FROM data_sources WHERE id=?').get(source) as {enabled:number}).enabled,0);
 assert.equal((d.prepare('SELECT status FROM collection_jobs WHERE id=?').get(ids[2]) as {status:string}).status,'cancelled');
 assert.equal((d.prepare('SELECT status FROM product_source_bindings WHERE product_id=?').get(two!.product_id) as {status:string}).status,'blocked');
 assert.equal(claimJob('next',ts+999999,120000),null);
 // Only a fresh, explicitly confirmed admin action may reactivate blocked bindings.
 d.prepare('UPDATE data_sources SET enabled=1 WHERE id=?').run(source);
 assert.equal(activateAwaitingBindings(d,source,ts+400000),0);
 assert.ok(activateAwaitingBindings(d,source,ts+400000,true)>0);
});
