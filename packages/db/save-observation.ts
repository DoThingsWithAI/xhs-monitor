import type Database from 'better-sqlite3';
import type {ObservationData} from '../collectors/browser';
import {uuid} from './index';

/** Writes one coherent product+seller snapshot for a completed job.
 * Call within the worker's existing transaction with run and job status changes.
 */
export function insertCollectedObservation(
 d:Database.Database,job:{id:string;product_id:string;source_id:string},
 runId:string,observedAt:number,obs:ObservationData,quality:'success'|'partial'
):void{
  d.prepare(`INSERT OR IGNORE INTO product_observations (
    id,product_id,source_id,job_id,run_id,observed_at,
    sales_raw_text,sales_value,sales_precision,price_raw_text,price_minor,price_kind,
    title_observed,shop_observed,quality_status,
    shop_rating_raw_text,shop_rating_hundredths,
    shop_sales_raw_text,shop_sales_value,shop_sales_precision,
    shop_followers_raw_text,shop_followers_value,shop_followers_precision
  ) VALUES (${Array(23).fill('?').join(',')})`).run(
    uuid(),job.product_id,job.source_id,job.id,runId,observedAt,
    obs.sales.raw,obs.sales.value,obs.sales.precision,obs.price.raw,obs.price.cents,obs.price.kind,
    obs.title,obs.shop,quality,
    obs.shopRating.raw,obs.shopRating.hundredths,
    obs.shopSales.raw,obs.shopSales.value,obs.shopSales.precision,
    obs.shopFollowers.raw,obs.shopFollowers.value,obs.shopFollowers.precision);
}
