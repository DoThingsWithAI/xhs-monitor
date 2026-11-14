/**
 * Default product ranking:
 * 1) estimated product value (descending)
 * 2) hot-product rate (descending)
 * 3) today's estimated sales increment (descending)
 * Missing data is never coerced to zero; it sorts after a real numeric value.
 * The original database newest-first order is retained for a complete tie.
 */
export type RankedProduct={
 hot_score?:{
  productValueCents:number|null;
  rate:number|null;
  todaySales:number|null;
 }|null;
};

function compareMetricDesc(a:number|null|undefined,b:number|null|undefined):number{
 const validA=typeof a==='number'&&Number.isFinite(a);
 const validB=typeof b==='number'&&Number.isFinite(b);
 if(!validA)return validB?1:0;
 if(!validB)return -1;
 return b!-a!;
}

export function compareProductsByValue<T extends RankedProduct>(a:T,b:T):number{
 return compareMetricDesc(a.hot_score?.productValueCents,b.hot_score?.productValueCents)
  ||compareMetricDesc(a.hot_score?.rate,b.hot_score?.rate)
  ||compareMetricDesc(a.hot_score?.todaySales,b.hot_score?.todaySales);
}

export function sortProductsByValue<T extends RankedProduct>(products:readonly T[]):T[]{
 // Array.prototype.sort is stable, and the API starts in newest-first order.
 return [...products].sort(compareProductsByValue);
}
