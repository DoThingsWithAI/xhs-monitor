import {parseSales,type Sales} from './metrics';

/** Displayed seller reputation; hundredths avoid float drift in SQLite. */
export function parseShopRating(value:string|null|undefined):{raw:string|null;hundredths:number|null}{
 const raw=value?.trim()||null;
 if(!raw||!/^\d+(?:\.\d{1,2})?$/.test(raw))return {raw,hundredths:null};
 const n=Math.round(Number(raw)*100);
 return {raw,hundredths:Number.isSafeInteger(n)&&n>=0&&n<=500?n:null};
}
export function parseShopFollowers(value:string|null|undefined):Sales{
 const raw=value?.trim()||null;
 if(!raw||!/^粉丝数\s*[:：]?\s*\d/i.test(raw))return {raw,value:null,precision:'missing'};
 const parsed=parseSales(raw.replace(/^粉丝数/,'已售'));
 return {raw,value:parsed.value,precision:parsed.precision};
}
/** Seller stats share the same CSS class. Filter by the actual text label. */
export function parseShopStats(labels:readonly string[]){
 const texts=labels.map(x=>x.trim());
 const salesText=texts.find(x=>/^已售\s*[:：]?\s*\d/i.test(x))||null;
 const followersText=texts.find(x=>/^粉丝数\s*[:：]?\s*\d/i.test(x))||null;
 return {shopSales:parseSales(salesText),shopFollowers:parseShopFollowers(followersText)};
}
