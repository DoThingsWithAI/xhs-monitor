import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const temp=mkdtempSync(join(tmpdir(),'xhs-manual-retry-'));
process.env.DB_PATH=join(temp,'manual-retry.sqlite');

test('manual retry queues only latest terminal failures and still respects source pacing',async()=>{
 const {db,uuid}=await import('../packages/db');
 const {enqueueFailedManualRetries,claimJob}=await import('../packages/db/queue');
 const d=db(),ts=Date.parse('2026-11-17T13:00:00Z');
 d.prepare("UPDATE data_sources SET enabled=1,automated_access_allowed=1,storage_allowed=1,analysis_allowed=1,permission_basis='Documented automated access and storage permission',permission_expires_at=NULL WHERE id='xhs-browser'").run();

 const addBinding=(suffix:string,productStatus='active',bindingStatus='ready')=>{
  const productId=uuid(),bindingId=uuid();
  const url='https://www.xiaohongshu.com/goods-detail/'+suffix;
  d.prepare('INSERT INTO products (id,original_url,canonical_url,monitor_status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
   .run(productId,url,url,productStatus,ts-10000,ts-10000);
  d.prepare('INSERT INTO product_source_bindings (id,product_id,source_id,status,interval_seconds,next_due_at,created_at,updated_at) VALUES (?,? ,\'xhs-browser\',?,86400,?,?,?)')
   .run(bindingId,productId,bindingStatus,ts,ts-10000,ts-10000);
  return {productId,bindingId};
 };
 const addJob=(bindingId:string,status:string,createdAt:number,idempotencyKey:string,nextRetryAt:number|null=null)=>{
  const id=uuid();
  d.prepare('INSERT INTO collection_jobs (id,binding_id,scheduled_for,status,idempotency_key,next_retry_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
   .run(id,bindingId,createdAt,status,idempotencyKey,nextRetryAt,createdAt,createdAt);
  return id;
 };

 const eligible=addBinding('a10000000000000000000001');
 const retrying=addBinding('a20000000000000000000002');
 const blocked=addBinding('a30000000000000000000003','active','blocked');
 const paused=addBinding('a40000000000000000000004','paused');
 const pending=addBinding('a50000000000000000000005');

 const eligibleFailure=addJob(eligible.bindingId,'failed',ts-500,'attempt-failed');
 addJob(retrying.bindingId,'retry_wait',ts-400,'auto-retry',ts+30000);
 addJob(blocked.bindingId,'failed',ts-300,'blocked-failure');
 addJob(paused.bindingId,'failed',ts-200,'paused-failure');
 addJob(pending.bindingId,'queued',ts-900,'older-pending');
 addJob(pending.bindingId,'failed',ts-100,'latest-failure');

 // A request completed recently; the manually queued job must wait for the same 120s source gate.
 d.prepare('INSERT INTO source_request_pacing (source_id,last_started_at,next_allowed_at) VALUES (?,?,?)')
  .run('xhs-browser',ts-60000,ts+60000);

 const result=enqueueFailedManualRetries(ts);
 assert.deepEqual(result,{queued:1,eligible:1});
 const manual=d.prepare('SELECT id,status,scheduled_for,idempotency_key FROM collection_jobs WHERE binding_id=? AND idempotency_key=?')
  .get(eligible.bindingId,'manual-retry:'+eligibleFailure) as {id:string;status:string;scheduled_for:number;idempotency_key:string};
 assert.ok(manual);
 assert.equal(manual.status,'queued');
 assert.equal(manual.scheduled_for,ts);
 assert.equal(manual.idempotency_key,'manual-retry:'+eligibleFailure);

 // The second click is idempotent: the latest job is now queued, not failed.
 assert.deepEqual(enqueueFailedManualRetries(ts+1),{queued:0,eligible:0});
 assert.equal((d.prepare("SELECT count(*) AS n FROM collection_jobs WHERE binding_id=? AND idempotency_key LIKE 'manual-retry:%'").get(eligible.bindingId) as {n:number}).n,1);

 assert.equal(claimJob('manual-retry-test',ts+59999),null);
 const claimed=claimJob('manual-retry-test',ts+60000);
 assert.equal(claimed?.id,manual.id);

 // Manual requeue never changes or deletes historical run/observation rows.
 assert.equal((d.prepare('SELECT count(*) AS n FROM product_observations').get() as {n:number}).n,0);
});

test.after(()=>rmSync(temp,{recursive:true,force:true}));
