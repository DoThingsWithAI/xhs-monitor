import type Database from 'better-sqlite3';

/** One sampled display value from a specific licensed source; never an order count. */
export type SalesTrendPoint={
  t:number;
  sales:number;
  sales_raw_text:string|null;
  precision:'exact'|'lower_bound'|'approximate';
};

/**
 * Keep product list requests bounded: at most 150 products x 30 index-backed rows.
 * This deliberately selects valid observations, not 30 observations that may be
 * missing sales. Different sources must never be plotted as one series.
 */
export function getProductSalesTrends(
 d:Database.Database,
 productIds:readonly string[],
 sourceId='xhs-browser',
 limit=30
):Record<string,SalesTrendPoint[]>{
 const result:Record<string,SalesTrendPoint[]>=Object.create(null);
 const cappedLimit=Math.max(1,Math.min(30,Math.trunc(limit)||30));
 const statement=d.prepare(
  "SELECT observed_at,sales_value,sales_raw_text,sales_precision "+
  "FROM product_observations "+
  "WHERE product_id=? AND source_id=? AND sales_value IS NOT NULL "+
  "AND sales_precision IN ('exact','lower_bound','approximate') "+
  "ORDER BY observed_at DESC,id DESC LIMIT ?"
 );
 for(const id of productIds){
  const rows=statement.all(id,sourceId,cappedLimit) as Array<{
    observed_at:number;sales_value:number;sales_raw_text:string|null;
    sales_precision:SalesTrendPoint['precision'];
  }>;
  result[id]=rows.reverse().map(row=>({
   t:row.observed_at,
   sales:row.sales_value,
   sales_raw_text:row.sales_raw_text,
   precision:row.sales_precision
  }));
 }
 return result;
}
