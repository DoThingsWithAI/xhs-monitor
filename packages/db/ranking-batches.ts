import type Database from 'better-sqlite3';

export type RankingBatch={date:string;scheduledAt:number;total:number;finished:number;succeeded:number;completedAt:number|null;state:'empty'|'pending'|'failed'|'published'};

/** Daily queue membership is durable and tied to the planned Beijing date,
 * not to the observation's wall-clock date (jobs can finish after midnight). */
export function getRankingBatches(d:Database.Database,requestedDate?:string|null){
 const rows=d.prepare(`
  SELECT b.beijing_date AS date,b.scheduled_at AS scheduledAt,b.enqueued_count AS total,
   COUNT(j.id) AS actual,
   SUM(CASE WHEN j.status IN ('succeeded','partial','failed','cancelled','blocked') THEN 1 ELSE 0 END) AS finished,
   SUM(CASE WHEN j.status='succeeded' THEN 1 ELSE 0 END) AS succeeded,
   MAX(j.updated_at) AS completedAt
  FROM daily_collection_batches b
  LEFT JOIN collection_jobs j ON j.scheduled_for=b.scheduled_at
    AND j.idempotency_key='daily:'||j.binding_id||':'||b.beijing_date
  GROUP BY b.beijing_date,b.scheduled_at,b.enqueued_count
  ORDER BY b.scheduled_at DESC
 `).all() as Array<{date:string;scheduledAt:number;total:number;actual:number;finished:number;succeeded:number;completedAt:number|null}>;
 const batches:RankingBatch[]=rows.map(({actual,...row})=>{
  const state=row.total===0?'empty':actual!==row.total||row.finished!==row.total?'pending':row.succeeded===0?'failed':'published';
  return {...row,state,completedAt:state==='published'||state==='failed'?row.completedAt:null};
 });
 const published=batches.filter(b=>b.state==='published');
 const selected=requestedDate?published.find(b=>b.date===requestedDate)??published[0]:published[0];
 return {selected:selected??null,latest:batches[0]??null,dates:published.map(b=>b.date),
  cutoff:selected?.completedAt??(batches.length?batches[batches.length-1].scheduledAt-1:Date.now())};
}
