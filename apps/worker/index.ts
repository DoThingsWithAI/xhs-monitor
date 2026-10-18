import {db,uuid} from '../../packages/db';
import {insertCollectedObservation} from '../../packages/db/save-observation';
import {scheduleDue,claimJob,permissionOk,appendAlert,heartbeat,type JobRow} from '../../packages/db/queue';
import {collectAllowedBrowserPage,CollectError,closeBrowser} from '../../packages/collectors/browser';

const owner='worker-'+process.pid;
let running=true;
process.on('SIGTERM',()=>{running=false;});
process.on('SIGINT',()=>{running=false;});
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function persist(job:JobRow,obs:Awaited<ReturnType<typeof collectAllowedBrowserPage>>){
 const d=db(),ts=Date.now();
 d.transaction(()=>{
  const run=d.prepare('SELECT id FROM collection_runs WHERE job_id=? AND attempt_no=?').get(job.id,job.attempt_count) as {id:string};
  const previous=d.prepare('SELECT * FROM product_observations WHERE product_id=? AND source_id=? ORDER BY observed_at DESC LIMIT 1').get(job.product_id,job.source_id) as any;
  const quality=obs.sales.value===null?'partial':'success';
  insertCollectedObservation(d,job,run.id,ts,obs,quality);
  d.prepare('UPDATE products SET title=COALESCE(?,title),shop_name=COALESCE(?,shop_name),updated_at=? WHERE id=?').run(obs.title,obs.shop,ts,job.product_id);
  d.prepare('UPDATE collection_runs SET result=?,finished_at=? WHERE id=?').run(quality,ts,run.id);
  d.prepare("UPDATE collection_jobs SET status=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?")
   .run(quality==='success'?'succeeded':'partial',ts,job.id);
  d.prepare('UPDATE product_source_bindings SET last_success_at=?,consecutive_failures=0,updated_at=? WHERE id=?')
   .run(ts,ts,job.binding_id);
  if(previous){
   if(obs.price.cents!==null&&previous.price_minor!==null&&obs.price.cents!==previous.price_minor)
     appendAlert(job.product_id,job.source_id,'PRICE_CHANGED','Displayed price changed');
   if(obs.sales.value!==null&&previous.sales_value!==null&&obs.sales.value>previous.sales_value &&
      (obs.sales.precision!=='exact'||previous.sales_precision!=='exact'))
     appendAlert(job.product_id,job.source_id,'SALES_THRESHOLD_CHANGED','Displayed sales threshold increased');
  }
 })();
}
function fail(job:JobRow,error:unknown){
 const d=db(),ts=Date.now(),e=error instanceof CollectError?error:new CollectError('UNEXPECTED_ERROR');
 const blocked=['ACCESS_BLOCKED','VERIFICATION_REQUIRED','HOST_NOT_ALLOWED'].includes(e.code);
 const retry=!blocked&&e.transient&&job.attempt_count<3;
 d.transaction(()=>{
  d.prepare('UPDATE collection_runs SET finished_at=?,result=?,error_code=?,http_status=? WHERE job_id=? AND attempt_no=?')
   .run(ts,blocked?'blocked':'failed',e.code,e.status,job.id,job.attempt_count);
  d.prepare('UPDATE collection_jobs SET status=?,next_retry_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?')
   .run(blocked?'blocked':retry?'retry_wait':'failed',retry?ts+Math.min(300000,2**job.attempt_count*30000):null,ts,job.id);
  d.prepare('UPDATE product_source_bindings SET consecutive_failures=consecutive_failures+1,updated_at=? WHERE id=?')
   .run(ts,job.binding_id);
  if(blocked)d.prepare("UPDATE product_source_bindings SET status='blocked',blocked_reason=? WHERE id=?").run(e.code,job.binding_id);
  if(blocked||!retry)appendAlert(job.product_id,job.source_id,e.code,'Automated collection stopped or failed',blocked?'critical':'warning');
 })();
 console.error(JSON.stringify({event:'job_failed',jobId:job.id,code:e.code,blocked,retry}));
}
async function processOne(job:JobRow){
 const source=db().prepare('SELECT * FROM data_sources WHERE id=?').get(job.source_id) as any;
 if(!source||!permissionOk(source)||source.kind!=='licensed_browser'){
   fail(job,new CollectError('AUTHORIZATION_REQUIRED'));return;
 }
 try{
  const observation=await collectAllowedBrowserPage(job.canonical_url,source.selectors_json,source.allowed_hosts_json);
  persist(job,observation);
  console.log(JSON.stringify({event:'job_complete',jobId:job.id,quality:observation.sales.precision}));
 }catch(e){fail(job,e);}
}
async function main(){
 db();console.log(JSON.stringify({event:'worker_started',owner}));
 while(running){
  try{
   heartbeat('worker');
   scheduleDue();
   let n=0;
   while(running && n<30){
     const job:JobRow|null=claimJob(owner);
     if(!job)break;
     n++;
     await processOne(job);
     heartbeat('worker');
   }
  }catch(e){console.error(JSON.stringify({event:'worker_loop_error',message:e instanceof Error?e.name:'unknown'}));}
  if(running)await sleep(5000);
 }
 await closeBrowser();
}
main().catch(e=>{console.error(e);process.exitCode=1});
