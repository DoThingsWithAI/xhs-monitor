import {db,uuid} from '../db';
import {normalizedProductUrl} from '../core/urls';

export type JobRow={id:string;binding_id:string;attempt_count:number;product_id:string;source_id:string;canonical_url:string;selectors_json:string;allowed_hosts_json:string};
export function permissionOk(s:any,now=Date.now()) {
 return s.enabled===1 && s.automated_access_allowed===1 && s.storage_allowed===1 &&
   s.analysis_allowed===1 && typeof s.permission_basis==='string' && s.permission_basis.trim().length>=12 &&
   (s.permission_expires_at===null || s.permission_expires_at>now);
}
export function createProduct(url:string,category='') {
 const link=normalizedProductUrl(url), d=db(), ts=Date.now();
 const source=d.prepare('SELECT * FROM data_sources WHERE id=?').get('xhs-browser') as any;
 return d.transaction(()=>{
   let product=d.prepare('SELECT id FROM products WHERE canonical_url=? AND monitor_status <> ?').get(link,'deleted') as {id:string}|undefined;
   if(product)return {id:product.id,created:false};
   const id=uuid(),bindingId=uuid(),authorized=permissionOk(source,ts);
   d.prepare('INSERT INTO products (id,original_url,canonical_url,category,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(id,url,link,category.slice(0,100),ts,ts);
   d.prepare('INSERT INTO product_source_bindings (id,product_id,source_id,status,interval_seconds,next_due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(bindingId,id,source.id,authorized?'ready':'awaiting_authorization',Math.max(86400,source.minimum_interval_seconds)*1000,ts,ts,ts);
   return {id,created:true,monitoring:authorized?'queued':'awaiting_source_authorization'};
 })();
}
export function scheduleDue() {
 const d=db(),ts=Date.now();
 const bindings=d.prepare(
  'SELECT b.* FROM product_source_bindings b JOIN products p ON p.id=b.product_id JOIN data_sources s ON s.id=b.source_id WHERE b.status=? AND b.next_due_at<=? AND p.monitor_status=? AND s.enabled=1 AND s.automated_access_allowed=1 AND s.storage_allowed=1 AND s.analysis_allowed=1 AND length(trim(s.permission_basis))>=12 AND (s.permission_expires_at IS NULL OR s.permission_expires_at>?) ORDER BY b.next_due_at LIMIT 50'
 ).all('ready',ts,'active',ts) as any[];
 const enqueue=d.prepare('INSERT OR IGNORE INTO collection_jobs (id,binding_id,scheduled_for,status,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)');
 const advance=d.prepare('UPDATE product_source_bindings SET next_due_at=?,updated_at=? WHERE id=? AND next_due_at=?');
 d.transaction(()=>{
  for(const b of bindings){
    enqueue.run(uuid(),b.id,b.next_due_at,'queued',b.id+':'+b.next_due_at,ts,ts);
    advance.run(Math.max(b.next_due_at,ts)+b.interval_seconds,ts,b.id,b.next_due_at);
  }
 })();
 return bindings.length;
}
export function claimJob(owner:string):JobRow|null {
 const d=db(),ts=Date.now();
 return d.transaction(()=>{
  const row=d.prepare(
   "SELECT j.id,j.binding_id,j.attempt_count,b.product_id,b.source_id,p.canonical_url,s.selectors_json,s.allowed_hosts_json FROM collection_jobs j JOIN product_source_bindings b ON b.id=j.binding_id JOIN products p ON p.id=b.product_id WHERE (j.status='queued' OR (j.status='retry_wait' AND j.next_retry_at<=?) OR (j.status='running' AND j.lease_expires_at<=?)) AND b.status='ready' AND p.monitor_status='active' ORDER BY j.scheduled_for LIMIT 1"
  ).get(ts,ts) as JobRow|undefined;
  if(!row)return null;
  const changed=d.prepare("UPDATE collection_jobs SET status='running',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=? WHERE id=?").run(owner,ts+120000,ts,row.id);
  if(!changed.changes)return null;
  d.prepare("UPDATE collection_runs SET result='abandoned',finished_at=? WHERE job_id=? AND finished_at IS NULL").run(ts,row.id);
  d.prepare('INSERT INTO collection_runs (id,job_id,attempt_no,started_at) VALUES (?,?,?,?)').run(uuid(),row.id,row.attempt_count+1,ts);
  d.prepare('UPDATE product_source_bindings SET last_attempt_at=?,updated_at=? WHERE id=?').run(ts,ts,row.binding_id);
  return {...row,attempt_count:row.attempt_count+1};
 })();
}
export function appendAlert(productId:string,sourceId:string,type:string,details:string,severity='warning'){
 const d=db(),ts=Date.now(),key=productId+':'+sourceId+':'+type;
 d.prepare('INSERT INTO alert_events (id,product_id,source_id,type,severity,dedupe_key,first_seen_at,last_seen_at,details_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO UPDATE SET last_seen_at=excluded.last_seen_at,occurrences=occurrences+1,status=?').run(uuid(),productId,sourceId,type,severity,key,ts,ts,JSON.stringify({message:details.slice(0,150)}),'open');
}
export function heartbeat(name:string){
 db().prepare('INSERT INTO system_heartbeats VALUES (?,?) ON CONFLICT(name) DO UPDATE SET last_seen_at=excluded.last_seen_at').run(name,Date.now());
}
