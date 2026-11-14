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


/** 
 * 爆品值 = (今日新增销量 - 商品爆品预值) / 今日累计已售。
 * China Standard Time (UTC+8) defines "today" for XHS products.
 * This is an estimate between snapshots, NOT confirmed calendar-day orders.
 * Missing, rounded, or lower-bound snapshots must never be treated as zero.
 */
export type HotProductScore={
  rate:number|null;
  todaySales:number|null;
  /** Derived value in minor currency units (fen), not a booked revenue figure. */
  productValueCents:number|null;
  observedAt:number|null;
  baselineAt:number|null;
};

export function getHotProductScores(
 d:Database.Database,
 productIds:readonly string[],
 sourceId='xhs-browser',
 now=Date.now()
):Record<string,HotProductScore>{
 const result:Record<string,HotProductScore>=Object.create(null);
 const dayMs=86400000,chinaOffsetMs=8*3600000;
 const todayStart=Math.floor((now+chinaOffsetMs)/dayMs)*dayMs-chinaOffsetMs;
 const yesterdayStart=todayStart-dayMs;
 const thresholdQuery=d.prepare('SELECT hot_threshold FROM products WHERE id=?');
 const latestInDay=d.prepare(
  "SELECT observed_at,sales_value,sales_precision,price_minor,price_kind FROM product_observations "+
  "WHERE product_id=? AND source_id=? AND observed_at>=? AND observed_at<? "+
  "AND sales_value IS NOT NULL ORDER BY observed_at DESC,id DESC LIMIT 1"
 );
 type Sample={observed_at:number;sales_value:number;sales_precision:string;price_minor:number|null;price_kind:string};
 for(const id of productIds){
  const today=latestInDay.get(id,sourceId,todayStart,todayStart+dayMs) as Sample|undefined;
  const yesterday=latestInDay.get(id,sourceId,yesterdayStart,todayStart) as Sample|undefined;
  const valid=!!today&&!!yesterday&&
   today.sales_precision==='exact'&&yesterday.sales_precision==='exact'&&
   Number.isSafeInteger(today.sales_value)&&Number.isSafeInteger(yesterday.sales_value)&&
   today.sales_value>0&&yesterday.sales_value>=0&&
   today.sales_value>=yesterday.sales_value;
  const todaySales=valid?today!.sales_value-yesterday!.sales_value:null;
  const threshold=(thresholdQuery.get(id) as {hot_threshold:number}|undefined)?.hot_threshold??2;
  const rate=valid?(todaySales!-threshold)/today!.sales_value:null;
  // No true paid-order average ticket is collected. Use the exact displayed
  // product price in the SAME today's sales snapshot as a documented proxy.
  // Never calculate from a starting price, missing price, or stale snapshot.
  const priceValid=valid&&today!.price_kind==='exact'&&
   today!.price_minor!==null&&Number.isSafeInteger(today!.price_minor)&&today!.price_minor>=0;
  const valueCents=priceValid?Math.round(today!.price_minor!*todaySales!*rate!):null;
  result[id]={
   rate,
   todaySales,
   productValueCents:valueCents!==null&&Number.isSafeInteger(valueCents)?(valueCents===0?0:valueCents):null,
   observedAt:today?.observed_at??null,
   baselineAt:yesterday?.observed_at??null
  };
 }
 return result;
}
