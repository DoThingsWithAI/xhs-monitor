import {db,uuid} from '../db';
import {parseXhsGoodsUrl} from '../core/urls';
import {sourceGapMs} from '../core/pacing';
import {beijing1900ForTimestamp,beijingDateKey,nextBeijing1900AtOrAfter,nextBeijing1900After,nextBeijing1900AfterInterval} from '../core/daily-schedule';

export type JobRow={id:string;binding_id:string;attempt_count:number;product_id:string;source_id:string;canonical_url:string;selectors_json:string;allowed_hosts_json:string};
export function permissionOk(s:any,now=Date.now()) {
 return s.enabled===1 && s.automated_access_allowed===1 && s.storage_allowed===1 &&
   s.analysis_allowed===1 && typeof s.permission_basis==='string' && s.permission_basis.trim().length>=12 &&
   (s.permission_expires_at===null || s.permission_expires_at>now);
}
/** Add a persisted, due-now job in the same transaction as the binding. */
function enqueueImmediate(d:ReturnType<typeof db>, bindingId:string, ts:number, reason:string):boolean {
 const key=bindingId+':'+reason;
 const r=d.prepare('INSERT OR IGNORE INTO collection_jobs (id,binding_id,scheduled_for,status,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
  .run(uuid(),bindingId,ts,'queued',key,ts,ts);
 return r.changes>0;
}
/** Activate only waiting, active products; saving settings repeatedly creates no duplicates. */
export function activateAwaitingBindings(d:ReturnType<typeof db>, sourceId:string, ts=Date.now(),manualResume=false):number {
 const source=d.prepare('SELECT * FROM data_sources WHERE id=?').get(sourceId) as any;
 if(!source || !permissionOk(source,ts))return 0;
 const eligible=manualResume?"b.status IN ('awaiting_authorization','blocked')":"b.status='awaiting_authorization'";
 const bindings=d.prepare("SELECT b.id,b.interval_seconds FROM product_source_bindings b JOIN products p ON p.id=b.product_id WHERE b.source_id=? AND "+eligible+" AND p.monitor_status='active'")
  .all(sourceId) as {id:string;interval_seconds:number}[];
 const update=d.prepare("UPDATE product_source_bindings SET status='ready',next_due_at=?,blocked_reason=NULL,updated_at=? WHERE id=? AND "+(manualResume?"status IN ('awaiting_authorization','blocked')":"status='awaiting_authorization'"));
 const cancel=d.prepare("UPDATE collection_jobs SET status='cancelled',updated_at=? WHERE binding_id=? AND status IN ('queued','retry_wait')");
 let count=0;
 for(const b of bindings) {
  cancel.run(ts,b.id);
  const interval=Math.max(86400,b.interval_seconds,source.minimum_interval_seconds);
  if(update.run(nextBeijing1900AfterInterval(ts,interval),ts,b.id).changes && enqueueImmediate(d,b.id,ts,'activation:'+ts))count++;
 }
 return count;
}

export function createProduct(url:string,category='') {
 const { productId, canonicalUrl:link }=parseXhsGoodsUrl(url),d=db(),ts=Date.now();
 const source=d.prepare('SELECT * FROM data_sources WHERE id=?').get('xhs-browser') as any;
 return d.transaction(()=>{
   // Prefer stable product identity, not the sharing query string.
   let product=d.prepare("SELECT id FROM products WHERE platform='xiaohongshu' AND monitor_status<>'deleted' AND (canonical_url=? OR platform_product_id=?) LIMIT 1")
    .get(link,productId) as {id:string}|undefined;
   if(!product){
     // Older versions saved instation_link / share parameters inside canonical_url.
     // Reuse those records instead of inserting another product.
     const old=d.prepare("SELECT id,canonical_url FROM products WHERE platform='xiaohongshu' AND monitor_status<>'deleted' AND canonical_url LIKE ? LIMIT 100")
      .all('%/goods-detail/'+productId+'%') as {id:string;canonical_url:string}[];
     product=old.find(row=>{
       try{return parseXhsGoodsUrl(row.canonical_url).productId===productId;}
       catch{return false;}
     });
   }
   if(product){
     const conflict=d.prepare('SELECT id FROM products WHERE canonical_url=? AND id<>?').get(link,product.id);
     if(!conflict){
       // Sanitize the existing original_url as well: it may still contain share tokens.
       d.prepare('UPDATE products SET original_url=?,canonical_url=?,platform_product_id=?,updated_at=? WHERE id=?')
        .run(link,link,productId,ts,product.id);
     }
     return {id:product.id,created:false,canonicalUrl:link};
   }
   const id=uuid(),bindingId=uuid(),authorized=permissionOk(source,ts);
   const interval=Math.max(86400,source.minimum_interval_seconds);
   d.prepare('INSERT INTO products (id,platform_product_id,original_url,canonical_url,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id,productId,link,link,category.slice(0,100),ts,ts);
   d.prepare('INSERT INTO product_source_bindings (id,product_id,source_id,status,interval_seconds,next_due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(bindingId,id,source.id,authorized?'ready':'awaiting_authorization',interval,authorized?nextBeijing1900AfterInterval(ts,interval):ts,ts,ts);
   if(authorized)enqueueImmediate(d,bindingId,ts,'initial');
   return {id,created:true,canonicalUrl:link,monitoring:authorized?'queued':'awaiting_source_authorization'};
 })();
}
/**
 * One-time, idempotent migration of v1 daily schedules to next-calendar-day Beijing 19:00.
 * Historical runs/snapshots and in-flight/retry attempts are preserved.
 * Only queued recurring jobs from the old schedule are cancelled, not first runs.
 */
export function migrateDailyCollectionSchedule(ts=Date.now()):number {
 const d=db(),marker='daily_collection_calendar_day_1900_beijing_v2';
 return d.transaction(()=>{
  if(d.prepare('SELECT 1 FROM collection_schedule_migrations WHERE key=?').get(marker))return 0;
  const bindings=d.prepare(
   "SELECT b.id,b.interval_seconds,b.last_attempt_at,b.created_at,s.minimum_interval_seconds "+
   "FROM product_source_bindings b JOIN data_sources s ON s.id=b.source_id WHERE b.status='ready'"
  ).all() as Array<{id:string;interval_seconds:number;last_attempt_at:number|null;created_at:number;minimum_interval_seconds:number}>;
  // Recurring jobs use bindingId:scheduledTimestamp as their idempotency key.
  // Never cancel initial/activation/retry/running jobs.
  d.prepare(
   "UPDATE collection_jobs SET status='cancelled',updated_at=? WHERE status='queued' AND EXISTS ("+
   "SELECT 1 FROM product_source_bindings b WHERE b.id=collection_jobs.binding_id "+
   "AND collection_jobs.idempotency_key=b.id||':'||collection_jobs.scheduled_for)"
  ).run(ts);
  const update=d.prepare("UPDATE product_source_bindings SET next_due_at=?,updated_at=? WHERE id=?");
  for(const b of bindings){
   const interval=Math.max(86400,b.interval_seconds,b.minimum_interval_seconds);
   const anchor=b.last_attempt_at??b.created_at;
   const earliest=nextBeijing1900AfterInterval(anchor,interval);
   update.run(nextBeijing1900AtOrAfter(Math.max(ts+1,earliest)),ts,b.id);
  }
  d.prepare('INSERT INTO collection_schedule_migrations (key,applied_at) VALUES (?,?)').run(marker,ts);
  return bindings.length;
 }).immediate();
}

/**
 * One-time cutover from rolling per-binding daily jobs to the Beijing-date queue.
 * Only queued legacy recurring jobs are cancelled. Initial/activation, retry,
 * running, completed and historical records remain untouched.
 */
export function migrateUnifiedDailyQueue(ts=Date.now()):number{
 const d=db(),marker='unified_daily_queue_beijing_1900_v1';
 return d.transaction(()=>{
  if(d.prepare('SELECT 1 FROM collection_schedule_migrations WHERE key=?').get(marker))return 0;
  const cancelled=d.prepare(
   "UPDATE collection_jobs SET status='cancelled',updated_at=? WHERE status='queued' AND EXISTS ("+
   "SELECT 1 FROM product_source_bindings b WHERE b.id=collection_jobs.binding_id "+
   "AND collection_jobs.idempotency_key=b.id||':'||collection_jobs.scheduled_for)"
  ).run(ts);
  d.prepare('INSERT INTO collection_schedule_migrations (key,applied_at) VALUES (?,?)').run(marker,ts);
  return cancelled.changes;
 }).immediate();
}

/** Enqueue one durable batch for the current Beijing date, once the 19:00 slot arrives. */
function enqueueDailyCollectionBatch(ts:number):number{
 const dailyAt=beijing1900ForTimestamp(ts);
 if(ts<dailyAt)return 0;
 const day=beijingDateKey(ts),d=db();
 return d.transaction(()=>{
  const batch=d.prepare(
   'INSERT OR IGNORE INTO daily_collection_batches (beijing_date,scheduled_at,enqueued_count,created_at) VALUES (?,?,0,?)'
  ).run(day,dailyAt,ts);
  if(!batch.changes)return 0;

  const bindings=d.prepare(
   "SELECT b.id,b.source_id,b.interval_seconds,b.last_attempt_at,b.created_at,"+
   "s.enabled,s.automated_access_allowed,s.storage_allowed,s.analysis_allowed,s.permission_basis,"+
   "s.permission_expires_at,s.minimum_interval_seconds "+
   "FROM product_source_bindings b JOIN products p ON p.id=b.product_id "+
   "JOIN data_sources s ON s.id=b.source_id "+
   "WHERE b.status='ready' AND p.monitor_status='active' AND s.enabled=1 "+
   "AND s.automated_access_allowed=1 AND s.storage_allowed=1 AND s.analysis_allowed=1 "+
   "AND length(trim(s.permission_basis))>=12 "+
   "AND (s.permission_expires_at IS NULL OR s.permission_expires_at>?) "+
   "ORDER BY b.created_at,b.id"
  ).all(ts) as Array<{
   id:string;source_id:string;interval_seconds:number;last_attempt_at:number|null;created_at:number;
   enabled:number;automated_access_allowed:number;storage_allowed:number;analysis_allowed:number;
   permission_basis:string;permission_expires_at:number|null;minimum_interval_seconds:number;
  }>;
  const pending=d.prepare(
   "SELECT 1 FROM collection_jobs WHERE binding_id=? AND status IN ('queued','running','retry_wait') LIMIT 1"
  );
  const enqueue=d.prepare(
   'INSERT OR IGNORE INTO collection_jobs (id,binding_id,scheduled_for,status,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
  );
  const updateDue=d.prepare('UPDATE product_source_bindings SET next_due_at=?,updated_at=? WHERE id=?');
  let enqueued=0;
  for(const binding of bindings){
   if(!permissionOk(binding,ts))continue;
   const interval=Math.max(86400,binding.interval_seconds,binding.minimum_interval_seconds);
   const anchor=binding.last_attempt_at??binding.created_at;
   const eligibleAt=nextBeijing1900AfterInterval(anchor,interval);
   const nextAnchor=Math.max(dailyAt,anchor);
   const nextDue=nextBeijing1900AfterInterval(nextAnchor,interval);

   // Respect stricter source/product intervals. The old next_due_at remains
   // informational for the UI, but no longer decides when daily jobs are created.
   if(eligibleAt>dailyAt){
    updateDue.run(eligibleAt,ts,binding.id);
    continue;
   }
   // Do not pile a new daily task on top of an initial task, an unfinished
   // previous daily task, or a retry still waiting to run.
   if(pending.get(binding.id)){
    updateDue.run(nextDue,ts,binding.id);
    continue;
   }
   const key='daily:'+binding.id+':'+day;
   const result=enqueue.run(uuid(),binding.id,dailyAt,'queued',key,ts,ts);
   if(result.changes)enqueued++;
   updateDue.run(nextDue,ts,binding.id);
  }
  d.prepare('UPDATE daily_collection_batches SET enqueued_count=? WHERE beijing_date=?').run(enqueued,day);
  return enqueued;
 }).immediate();
}

/**
 * Daily queue scheduling is keyed by Beijing calendar date, not by each
 * binding's rolling next_due_at. Immediate activation/initial jobs are retained.
 */
export function scheduleDue(ts=Date.now()):number{
 const d=db();
 const sources=d.prepare('SELECT * FROM data_sources WHERE enabled=1').all() as any[];
 let activated=0;
 d.transaction(()=>{
  for(const source of sources){
   if(permissionOk(source,ts))activated+=activateAwaitingBindings(d,source.id,ts);
  }
 })();
 return activated+enqueueDailyCollectionBatch(ts);
}

/** Absolute time of the next useful worker wake, based on queue, pacing and 19:00. */
export function nextWorkerWakeAt(ts=Date.now()):number{
 const d=db(),day=beijingDateKey(ts),dailyAt=beijing1900ForTimestamp(ts);
 const hasBatch=Boolean(d.prepare('SELECT 1 FROM daily_collection_batches WHERE beijing_date=?').get(day));
 const dailyWake=hasBatch?nextBeijing1900After(ts):(ts>=dailyAt?ts:dailyAt);
 const job=d.prepare(
  "SELECT MIN(CASE "+
  "WHEN j.status='retry_wait' THEN MAX(COALESCE(j.next_retry_at,?),COALESCE(pace.next_allowed_at,0)) "+
  "WHEN j.status='running' THEN COALESCE(j.lease_expires_at,?) "+
  "ELSE COALESCE(pace.next_allowed_at,0) END) AS wake_at "+
  "FROM collection_jobs j "+
  "JOIN product_source_bindings b ON b.id=j.binding_id "+
  "JOIN products p ON p.id=b.product_id "+
  "JOIN data_sources s ON s.id=b.source_id "+
  "LEFT JOIN source_request_pacing pace ON pace.source_id=b.source_id "+
  "WHERE j.status IN ('queued','retry_wait','running') "+
  "AND b.status='ready' AND p.monitor_status='active' "+
  "AND s.enabled=1 AND s.automated_access_allowed=1 AND s.storage_allowed=1 AND s.analysis_allowed=1 "+
  "AND length(trim(s.permission_basis))>=12 "+
  "AND (s.permission_expires_at IS NULL OR s.permission_expires_at>?) "+
  "AND (j.status<>'retry_wait' OR j.next_retry_at IS NOT NULL) "+
  "AND (j.status<>'running' OR j.lease_expires_at IS NOT NULL) "+
  "AND NOT EXISTS(SELECT 1 FROM collection_jobs other "+
  "JOIN product_source_bindings ob ON ob.id=other.binding_id "+
  "WHERE ob.source_id=b.source_id AND other.status='running' AND other.id<>j.id "+
  "AND other.lease_expires_at>?)"
 ).get(ts,ts,ts,ts) as {wake_at:number|null};
 const jobWake=job.wake_at===null?Number.MAX_SAFE_INTEGER:Math.max(ts,job.wake_at);
 return Math.min(dailyWake,jobWake);
}
/** Claim at most one request for a source within the configured spacing window.
 * Persisting the gate in SQLite preserves throttling across worker restarts.
 * The immediate transaction serializes multiple workers so they cannot both claim
 * jobs on the same source. Only sources with valid recorded permissions are eligible.
 */
export function claimJob(owner:string, ts=Date.now(), gapMs=sourceGapMs()):JobRow|null {
 const d=db();
 return d.transaction(()=>{
  const row=d.prepare(
   "SELECT j.id,j.binding_id,j.attempt_count,b.product_id,b.source_id,p.canonical_url,s.selectors_json,s.allowed_hosts_json "+
   "FROM collection_jobs j JOIN product_source_bindings b ON b.id=j.binding_id "+
   "JOIN products p ON p.id=b.product_id JOIN data_sources s ON s.id=b.source_id "+
   "LEFT JOIN source_request_pacing pace ON pace.source_id=b.source_id "+
   "WHERE (j.status='queued' OR (j.status='retry_wait' AND j.next_retry_at<=?) OR (j.status='running' AND j.lease_expires_at<=?)) "+
   "AND b.status='ready' AND p.monitor_status='active' "+
   "AND s.enabled=1 AND s.automated_access_allowed=1 AND s.storage_allowed=1 AND s.analysis_allowed=1 "+
   "AND length(trim(s.permission_basis))>=12 "+
   "AND (s.permission_expires_at IS NULL OR s.permission_expires_at>?) "+
   "AND COALESCE(pace.next_allowed_at,0)<=? "+
   "AND NOT EXISTS(SELECT 1 FROM collection_jobs other "+
   "JOIN product_source_bindings ob ON ob.id=other.binding_id "+
   "WHERE ob.source_id=b.source_id AND other.status='running' "+
   "AND other.id<>j.id AND other.lease_expires_at>?) "+
   "ORDER BY j.scheduled_for LIMIT 1"
  ).get(ts,ts,ts,ts,ts) as JobRow|undefined;
  if(!row)return null;
  const changed=d.prepare("UPDATE collection_jobs SET status='running',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE id=?")
   .run(owner,ts+120000,ts,row.id);
  if(!changed.changes)return null;
  d.prepare("INSERT INTO source_request_pacing(source_id,last_started_at,next_allowed_at) VALUES(?,?,?) "+
    "ON CONFLICT(source_id) DO UPDATE SET last_started_at=excluded.last_started_at, "+
    "next_allowed_at=MAX(source_request_pacing.next_allowed_at,excluded.next_allowed_at)")
   .run(row.source_id,ts,ts+gapMs);
  d.prepare("UPDATE collection_runs SET result='abandoned',finished_at=? WHERE job_id=? AND finished_at IS NULL").run(ts,row.id);
  d.prepare('INSERT INTO collection_runs (id,job_id,attempt_no,started_at) VALUES (?,?,?,?)').run(uuid(),row.id,row.attempt_count+1,ts);
  d.prepare('UPDATE product_source_bindings SET last_attempt_at=?,updated_at=? WHERE id=?').run(ts,ts,row.binding_id);
  return {...row,attempt_count:row.attempt_count+1};
 }).immediate();
}

/** Adds a full gap AFTER finishing, so long page loads do not compress spacing. */
export function finishSourceRequest(d:ReturnType<typeof db>, sourceId:string, finishedAt:number, gapMs=sourceGapMs()):void {
 d.prepare("UPDATE source_request_pacing SET next_allowed_at=MAX(next_allowed_at,?) WHERE source_id=?")
  .run(finishedAt+gapMs,sourceId);
}

/** Access restrictions halt all pending work for this source until manual review. */
export function suspendSourceAfterRestriction(d:ReturnType<typeof db>,sourceId:string,reason:string,ts=Date.now()):void {
 d.prepare("UPDATE data_sources SET enabled=0,updated_at=? WHERE id=?").run(ts,sourceId);
 d.prepare("UPDATE product_source_bindings SET status='blocked',blocked_reason=?,updated_at=? WHERE source_id=? AND status='ready'")
  .run(reason,ts,sourceId);
 d.prepare("UPDATE collection_jobs SET status='cancelled',updated_at=? WHERE status IN ('queued','retry_wait') AND binding_id IN (SELECT id FROM product_source_bindings WHERE source_id=?)")
  .run(ts,sourceId);
}

export function appendAlert(productId:string,sourceId:string,type:string,details:string,severity='warning'){
 const d=db(),ts=Date.now(),key=productId+':'+sourceId+':'+type;
 // Keep the latest safe diagnostic when a deduplicated alert occurs again.
 d.prepare('INSERT INTO alert_events (id,product_id,source_id,type,severity,dedupe_key,first_seen_at,last_seen_at,details_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO UPDATE SET last_seen_at=excluded.last_seen_at,occurrences=occurrences+1,status=?,details_json=excluded.details_json').run(uuid(),productId,sourceId,type,severity,key,ts,ts,JSON.stringify({message:details.slice(0,280)}),'open');
}
export function heartbeat(name:string){
 db().prepare('INSERT INTO system_heartbeats VALUES (?,?) ON CONFLICT(name) DO UPDATE SET last_seen_at=excluded.last_seen_at').run(name,Date.now());
}
