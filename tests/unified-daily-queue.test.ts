import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const temp=mkdtempSync(join(tmpdir(),'xhs-unified-queue-'));
process.env.DB_PATH=join(temp,'unified.sqlite');
const at=(iso:string)=>Date.parse(iso);

test('unified Beijing 19:00 batch is idempotent and respects pending work and strict intervals',async()=>{
 const {db,uuid}=await import('../packages/db');
 const {
  migrateUnifiedDailyQueue,scheduleDue,nextWorkerWakeAt,claimJob,finishSourceRequest
 }=await import('../packages/db/queue');
 const d=db();
 const now=at('2026-11-17T10:00:00Z'); // 18:00 Beijing
 const dailyAt=at('2026-11-17T11:00:00Z');
 d.prepare("UPDATE data_sources SET enabled=1,automated_access_allowed=1,storage_allowed=1,analysis_allowed=1,permission_basis='Documented automated access and storage permission',permission_expires_at=NULL WHERE id='xhs-browser'").run();

 const addBinding=(suffix:string,options:{lastAttempt:number|null;interval?:number;bindingStatus?:string;productStatus?:string})=>{
  const productId=uuid(),bindingId=uuid();
  const link='https://www.xiaohongshu.com/goods-detail/'+suffix.padEnd(24,'a').slice(0,24);
  d.prepare('INSERT INTO products (id,original_url,canonical_url,monitor_status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
   .run(productId,link,link,options.productStatus||'active',now-5*86400000,now-5*86400000);
  d.prepare('INSERT INTO product_source_bindings (id,product_id,source_id,status,interval_seconds,next_due_at,last_attempt_at,created_at,updated_at) VALUES (?,? ,\'xhs-browser\',?,?,?,?,?,?)')
   .run(bindingId,productId,options.bindingStatus||'ready',options.interval||86400,dailyAt,options.lastAttempt,now-5*86400000,now-5*86400000);
  return {productId,bindingId};
 };

 const legacy=addBinding('a10000000000000000000001',{lastAttempt:at('2026-11-16T10:00:00Z')});
 const pending=addBinding('a20000000000000000000002',{lastAttempt:at('2026-11-16T10:00:00Z')});
 const eligibleA=addBinding('a30000000000000000000003',{lastAttempt:at('2026-11-16T10:00:00Z')});
 const eligibleB=addBinding('a40000000000000000000004',{lastAttempt:at('2026-11-16T10:00:00Z')});
 const strict=addBinding('a50000000000000000000005',{lastAttempt:at('2026-11-16T10:00:00Z'),interval:172800});
 const paused=addBinding('a60000000000000000000006',{lastAttempt:at('2026-11-16T10:00:00Z'),productStatus:'paused'});
 const blocked=addBinding('a70000000000000000000007',{lastAttempt:at('2026-11-16T10:00:00Z'),bindingStatus:'blocked'});

 const addJob=d.prepare('INSERT INTO collection_jobs (id,binding_id,scheduled_for,status,idempotency_key,lease_expires_at,next_retry_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
 const legacyJob=uuid(),initialJob=uuid(),retryJob=uuid(),runningJob=uuid(),historyJob=uuid();
 addJob.run(legacyJob,legacy.bindingId,dailyAt,'queued',legacy.bindingId+':'+dailyAt,null,null,now,now);
 addJob.run(initialJob,pending.bindingId,now,'retry_wait',pending.bindingId+':initial',null,dailyAt+3600000,now,now);
 addJob.run(retryJob,blocked.bindingId,now,'retry_wait',blocked.bindingId+':retry',null,now+3600000,now,now);
 addJob.run(runningJob,blocked.bindingId,now,'running',blocked.bindingId+':running',now-1,null,now,now);
 addJob.run(historyJob,blocked.bindingId,now-86400000,'succeeded',blocked.bindingId+':history',null,null,now,now);
 d.prepare("INSERT INTO collection_schedule_migrations (key,applied_at) VALUES ('daily_collection_calendar_day_1900_beijing_v2',?)").run(now);

 assert.equal(migrateUnifiedDailyQueue(now),1);
 assert.equal(migrateUnifiedDailyQueue(now+1),0);
 const status=(id:string)=>(d.prepare('SELECT status FROM collection_jobs WHERE id=?').get(id) as {status:string}).status;
 assert.equal(status(legacyJob),'cancelled');
 assert.equal(status(initialJob),'retry_wait');
 assert.equal(status(retryJob),'retry_wait');
 assert.equal(status(runningJob),'running');
 assert.equal(status(historyJob),'succeeded');

 assert.equal(scheduleDue(now),0);
 assert.equal(nextWorkerWakeAt(now),dailyAt);
 assert.equal(scheduleDue(dailyAt),3);
 assert.equal(scheduleDue(dailyAt+1000),0);
 assert.equal((d.prepare('SELECT enqueued_count FROM daily_collection_batches WHERE beijing_date=?').get('2026-11-17') as {enqueued_count:number}).enqueued_count,3);

 const dailyKey=(id:string)=>'daily:'+id+':2026-11-17';
 for(const binding of [legacy,eligibleA,eligibleB]){
  const job=d.prepare('SELECT scheduled_for,status FROM collection_jobs WHERE binding_id=? AND idempotency_key=?')
   .get(binding.bindingId,dailyKey(binding.bindingId)) as {scheduled_for:number;status:string}|undefined;
  assert.ok(job);
  assert.equal(job?.scheduled_for,dailyAt);
  assert.equal(job?.status,'queued');
 }
 assert.equal(d.prepare('SELECT 1 FROM collection_jobs WHERE binding_id=? AND idempotency_key=?').get(pending.bindingId,dailyKey(pending.bindingId)),undefined);
 assert.equal(d.prepare('SELECT 1 FROM collection_jobs WHERE binding_id=? AND idempotency_key=?').get(strict.bindingId,dailyKey(strict.bindingId)),undefined);
 assert.equal(d.prepare('SELECT 1 FROM collection_jobs WHERE binding_id=? AND idempotency_key=?').get(paused.bindingId,dailyKey(paused.bindingId)),undefined);
 assert.equal(d.prepare('SELECT 1 FROM collection_jobs WHERE binding_id=? AND idempotency_key=?').get(blocked.bindingId,dailyKey(blocked.bindingId)),undefined);

 // Remove the synthetic initial task after asserting it prevented same-day duplication.
 d.prepare("UPDATE collection_jobs SET status='cancelled' WHERE id=?").run(initialJob);
 assert.equal(nextWorkerWakeAt(dailyAt),dailyAt);
 const job=claimJob('test-worker',dailyAt);
 assert.ok(job);
 assert.equal(claimJob('second-worker',dailyAt),null);

 const finishedAt=dailyAt+45000;
 d.prepare("UPDATE collection_jobs SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").run(finishedAt,job!.id);
 d.prepare("UPDATE collection_runs SET result='success',finished_at=? WHERE job_id=? AND finished_at IS NULL").run(finishedAt,job!.id);
 d.transaction(()=>finishSourceRequest(d,'xhs-browser',finishedAt,120000))();
 assert.equal(nextWorkerWakeAt(finishedAt),finishedAt+120000);

 // Retry time and source pacing are both respected; the later gate wins.
 const remaining=d.prepare("SELECT id FROM collection_jobs WHERE status='queued' AND idempotency_key LIKE 'daily:%' LIMIT 1").get() as {id:string};
 const other=d.prepare("SELECT id FROM collection_jobs WHERE status='queued' AND idempotency_key LIKE 'daily:%' AND id<>? LIMIT 1").get(remaining.id) as {id:string};
 d.prepare("UPDATE collection_jobs SET status='cancelled' WHERE id=?").run(other.id);
 d.prepare("UPDATE collection_jobs SET status='retry_wait',next_retry_at=? WHERE id=?").run(finishedAt+60000,remaining.id);
 assert.equal(nextWorkerWakeAt(finishedAt),finishedAt+120000);
 d.prepare("UPDATE collection_jobs SET next_retry_at=? WHERE id=?").run(finishedAt+240000,remaining.id);
 assert.equal(nextWorkerWakeAt(finishedAt),finishedAt+240000);
});

test.after(()=>rmSync(temp,{recursive:true,force:true}));
