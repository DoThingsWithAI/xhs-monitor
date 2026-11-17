import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beijing1900ForTimestamp,beijingDateKey,nextBeijing1900AtOrAfter,nextBeijing1900After,nextBeijing1900AfterInterval} from '../packages/core/daily-schedule';

const at=(iso:string)=>Date.parse(iso);

test('daily sales collection uses 19:00 Beijing regardless of server timezone',()=>{
 assert.equal(nextBeijing1900After(at('2026-11-15T10:59:59Z')),at('2026-11-15T11:00:00Z'));
 assert.equal(nextBeijing1900After(at('2026-11-15T11:00:00Z')),at('2026-11-16T11:00:00Z'));
 assert.equal(nextBeijing1900After(at('2026-11-15T18:30:00Z')),at('2026-11-16T11:00:00Z'));
 assert.equal(nextBeijing1900AtOrAfter(at('2026-11-16T11:00:00Z')),at('2026-11-16T11:00:00Z'));
 assert.equal(beijingDateKey(at('2026-11-16T16:30:00Z')),'2026-11-17');
 assert.equal(beijing1900ForTimestamp(at('2026-11-16T16:30:00Z')),at('2026-11-17T11:00:00Z'));
 // First collection is immediate; the next regular capture is the next Beijing DATE at 19:00.
 assert.equal(nextBeijing1900AfterInterval(at('2026-11-15T10:59:00Z'),86400),at('2026-11-16T11:00:00Z'));
 assert.equal(nextBeijing1900AfterInterval(at('2026-11-15T11:01:00Z'),86400),at('2026-11-16T11:00:00Z'));
 assert.equal(nextBeijing1900AfterInterval(at('2026-11-15T14:00:00Z'),86400),at('2026-11-16T11:00:00Z'));
 assert.equal(nextBeijing1900AfterInterval(at('2026-11-15T10:59:00Z'),172800),at('2026-11-17T11:00:00Z'));
 assert.equal(nextBeijing1900AfterInterval(at('2026-11-15T14:00:00Z'),172800),at('2026-11-18T11:00:00Z'));
});

const temp=mkdtempSync(join(tmpdir(),'xhs-schedule-'));
process.env.DB_PATH=join(temp,'schedule.sqlite');

test('v2 upgrade realigns old daily plans without deleting history or initial jobs',async()=>{
 const {db,uuid}=await import('../packages/db');
 const {migrateDailyCollectionSchedule,migrateUnifiedDailyQueue,scheduleDue}=await import('../packages/db/queue');
 const d=db(),now=at('2026-11-16T10:30:00Z'),due=at('2026-11-16T11:00:00Z');
 const productId=uuid(),bindingId=uuid(),source='xhs-browser';
 const link='https://www.xiaohongshu.com/goods-detail/6a290d7c3222c60001e051bf';
 d.prepare('INSERT INTO products (id,original_url,canonical_url,created_at,updated_at) VALUES (?,?,?,?,?)')
  .run(productId,link,link,now,now);
 d.prepare("UPDATE data_sources SET enabled=1,automated_access_allowed=1,storage_allowed=1,analysis_allowed=1,permission_basis='Documented automated access permission' WHERE id=?").run(source);
 const oldSchedule=at('2026-11-17T11:00:00Z');
 d.prepare("INSERT INTO product_source_bindings (id,product_id,source_id,status,interval_seconds,next_due_at,last_attempt_at,created_at,updated_at) VALUES (?,?,?,'ready',86400,?,?,?,?)")
  .run(bindingId,productId,source,oldSchedule,at('2026-11-15T10:15:00Z'),now,now);
 const queuedId=uuid(),initialId=uuid(),historyId=uuid(),runId=uuid();
 const addJob=d.prepare('INSERT INTO collection_jobs (id,binding_id,scheduled_for,status,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
 addJob.run(queuedId,bindingId,oldSchedule,'queued',bindingId+':'+oldSchedule,now,now);
 addJob.run(initialId,bindingId,now,'queued',bindingId+':initial',now,now);
 addJob.run(historyId,bindingId,now-86400000,'succeeded',bindingId+':history',now,now);
 d.prepare("INSERT INTO collection_runs (id,job_id,attempt_no,started_at,finished_at,result) VALUES (?,?,1,?,?,'success')")
  .run(runId,historyId,now-86400000,now-86400000);
 d.prepare('INSERT INTO product_observations (id,product_id,source_id,job_id,run_id,observed_at,sales_raw_text,sales_value,sales_precision,price_kind,quality_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(uuid(),productId,source,historyId,runId,now-86400000,'已售431',431,'exact','regular','success');
 // Simulate an installation that already applied v1 (24h) migration.
 d.prepare("INSERT INTO collection_schedule_migrations (key,applied_at) VALUES ('daily_collection_1900_beijing_v1',?)").run(now-1000);
 // An initial capture at 22:00 Beijing on Nov 15 was previously postponed to Nov 17.
 const lateProductId=uuid(),lateBindingId=uuid(),lateJobId=uuid();
 d.prepare('INSERT INTO products (id,original_url,canonical_url,created_at,updated_at) VALUES (?,?,?,?,?)')
  .run(lateProductId,link.replace(/bf$/, 'be'),link.replace(/bf$/, 'be'),now-86400000,now-86400000);
 d.prepare("INSERT INTO product_source_bindings (id,product_id,source_id,status,interval_seconds,next_due_at,last_attempt_at,created_at,updated_at) VALUES (?,?,?,'ready',86400,?,?,?,?)")
  .run(lateBindingId,lateProductId,source,oldSchedule,at('2026-11-15T14:00:00Z'),now-86400000,now);
 addJob.run(lateJobId,lateBindingId,oldSchedule,'queued',lateBindingId+':'+oldSchedule,now,now);
 // A stricter-than-daily source/product interval is never shortened.
 const strictProductId=uuid(),strictBindingId=uuid();
 d.prepare('INSERT INTO products (id,original_url,canonical_url,created_at,updated_at) VALUES (?,?,?,?,?)')
  .run(strictProductId,link.replace(/bf$/, 'bd'),link.replace(/bf$/, 'bd'),now-86400000,now-86400000);
 d.prepare("INSERT INTO product_source_bindings (id,product_id,source_id,status,interval_seconds,next_due_at,last_attempt_at,created_at,updated_at) VALUES (?,?,?,'ready',172800,?,?,?,?)")
  .run(strictBindingId,strictProductId,source,oldSchedule,at('2026-11-15T14:00:00Z'),now-86400000,now);
 assert.equal(migrateDailyCollectionSchedule(now),3);
 assert.equal(migrateDailyCollectionSchedule(now+1000),0);
 assert.equal(migrateUnifiedDailyQueue(now),0);
 assert.equal(migrateUnifiedDailyQueue(now+1000),0);
 assert.equal((d.prepare('SELECT next_due_at FROM product_source_bindings WHERE id=?').get(bindingId) as {next_due_at:number}).next_due_at,due);
 const status=(id:string)=>(d.prepare('SELECT status FROM collection_jobs WHERE id=?').get(id) as {status:string}).status;
 assert.equal(status(queuedId),'cancelled');
 assert.equal(status(lateJobId),'cancelled');
 assert.equal((d.prepare('SELECT next_due_at FROM product_source_bindings WHERE id=?').get(lateBindingId) as {next_due_at:number}).next_due_at,due);
 assert.equal((d.prepare('SELECT next_due_at FROM product_source_bindings WHERE id=?').get(strictBindingId) as {next_due_at:number}).next_due_at,at('2026-11-18T11:00:00Z'));
 assert.equal(status(initialId),'queued');
 assert.equal(status(historyId),'succeeded');
 assert.equal((d.prepare('SELECT sales_value FROM product_observations WHERE job_id=?').get(historyId) as {sales_value:number}).sales_value,431);
 // The queued initial capture is preserved and prevents a duplicate daily task.
 // The second binding is eligible and receives today's single unified daily job.
 assert.equal(scheduleDue(due+5000),1);
 const newJob=d.prepare("SELECT scheduled_for FROM collection_jobs WHERE binding_id=? AND idempotency_key=?")
  .get(lateBindingId,'daily:'+lateBindingId+':2026-11-16') as {scheduled_for:number};
 assert.equal(newJob.scheduled_for,due);
 assert.equal((d.prepare('SELECT next_due_at FROM product_source_bindings WHERE id=?').get(bindingId) as {next_due_at:number}).next_due_at,at('2026-11-17T11:00:00Z'));
 assert.equal((d.prepare('SELECT enqueued_count FROM daily_collection_batches WHERE beijing_date=?').get('2026-11-16') as {enqueued_count:number}).enqueued_count,1);
 assert.equal(scheduleDue(due+6000),0);
});
test.after(()=>rmSync(temp,{recursive:true,force:true}));
