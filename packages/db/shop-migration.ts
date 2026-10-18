import type Database from 'better-sqlite3';
// ADD COLUMN is additive and idempotent. Past observations stay NULL / missing.
const FIELDS:Record<string,string>={
 shop_rating_raw_text:'TEXT',shop_rating_hundredths:'INTEGER',
 shop_sales_raw_text:'TEXT',shop_sales_value:'INTEGER',
 shop_sales_precision:"TEXT NOT NULL DEFAULT 'missing'",
 shop_followers_raw_text:'TEXT',shop_followers_value:'INTEGER',
 shop_followers_precision:"TEXT NOT NULL DEFAULT 'missing'"
};
export function migrateShopObservationColumns(d:Database.Database):void{
 const existing=new Set((d.pragma('table_info(product_observations)') as Array<{name:string}>).map(r=>r.name));
 d.transaction(()=>{
  for(const [field,def] of Object.entries(FIELDS)){
   if(!existing.has(field))d.exec('ALTER TABLE product_observations ADD COLUMN '+field+' '+def);
  }
 })();
}
