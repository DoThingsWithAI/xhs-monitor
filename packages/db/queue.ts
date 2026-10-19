import {db,uuid} from '../db';
import {parseXhsGoodsUrl} from '../core/urls';
import {sourceGapMs} from '../core/pacing';

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
  if(update.run(ts+b.interval_seconds*1000,ts,b.id).changes && enqueueImmediate(d,b.id,ts,'activation:'+ts))count++;
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
   d.prepare('INSERT INTO products (id,platform_product_id,original_url,canonical_url,category,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id,productId,link,link,category.slice(0,100),ts,ts);
   d.prepare('INSERT INTO product_source_bindings (id,product_id,source_id,status,interval_seconds,next_due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(bindingId,id,source.id,authorized?'ready':'awaiting_authorization',Math.max(86400,source.minimum_interval_seconds),authorized?ts+Math.max(86400,source.minimum_interval_seconds)*1000:ts,ts,ts);
   if(authorized)enqueueImmediate(d,bindingId,ts,'initial');
   return {id,created:true,canonicalUrl:link,monitoring:authorized?'queued':'awaiting_source_authorization'};
 })();
}
export function scheduleDue() {
 const d=db(),ts=Date.now();
 // Recover stale awaiting bindings only when the source is genuinely configured
 // and authorized. Never change permission flags here or bypass their checks.
 const sources=d.prepare('SELECT * FROM data_sources WHERE enabled=1').all() as any[];
 d.transaction(()=>{
  for(const source of sources){
   if(permissionOk(source,ts))activateAwaitingBindings(d,source.id,ts);
  }
 })();
 const bindings=d.prepare(
  'SELECT b.* FROM product_source_bindings b JOIN products p ON p.id=b.product_id JOIN data_sources s ON s.id=b.source_id WHERE b.status=? AND b.next_due_at<=? AND p.monitor_status=? AND s.enabled=1 AND s.automated_access_allowed=1 AND s.storage_allowed=1 AND s.analysis_allowed=1 AND length(trim(s.permission_basis))>=12 AND (s.permission_expires_at IS NULL OR s.permission_expires_at>?) ORDER BY b.next_due_at LIMIT 50'
 ).all('ready',ts,'active',ts) as any[];
 const enqueue=d.prepare('INSERT OR IGNORE INTO collection_jobs (id,binding_id,scheduled_for,status,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
 const advance=d.prepare('UPDATE product_source_bindings SET next_due_at=?,updated_at=? WHERE id=? AND next_due_at=?');
 d.transaction(()=>{
  for(const b of bindings){
    enqueue.run(uuid(),b.id,b.next_due_at,'queued',b.id+':'+b.next_due_at,ts,ts);
    advance.run(Math.max(b.next_due_at,ts)+b.interval_seconds*1000,ts,b.id,b.next_due_at);
  }
 })();
 return bindings.length;
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
 d.prepare('INSERT INTO alert_events (id,product_id,source_id,type,severity,dedupe_key,first_seen_at,last_seen_at,details_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO UPDATE SET last_seen_at=excluded.last_seen_at,occurrences=occurrences+1,status=?').run(uuid(),productId,sourceId,type,severity,key,ts,ts,JSON.stringify({message:details.slice(0,150)}),'open');
}
export function heartbeat(name:string){
 db().prepare('INSERT INTO system_heartbeats VALUES (?,?) ON CONFLICT(name) DO UPDATE SET last_seen_at=excluded.last_seen_at').run(name,Date.now());
}
