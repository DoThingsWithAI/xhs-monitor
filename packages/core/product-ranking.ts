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

export type ProductSortKey=
 |'recommended'
 |'productValue'
 |'hotRate'
 |'todaySales'
 |'totalSales'
 |'price'
 |'lastCollected';

export type SortableProduct=RankedProduct&{
 price_minor?:number|null;
 observed_at?:number|null;
 last_success_at?:number|null;
 trend_points?:readonly {t:number;sales:number}[]|null;
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


/** Sort a product list by the selected display metric, keeping missing values last. */
export function sortProducts<T extends SortableProduct>(
 products:readonly T[],
 sortBy:ProductSortKey='recommended'
):T[]{
 const metric=(product:T):number|null|undefined=>{
  switch(sortBy){
   case 'productValue':return product.hot_score?.productValueCents;
   case 'hotRate':return product.hot_score?.rate;
   case 'todaySales':return product.hot_score?.todaySales;
   case 'totalSales':{
    const points=product.trend_points;
    return points?.length?points[points.length-1].sales:null;
   }
   case 'price':return product.price_minor;
   case 'lastCollected':return 'observed_at' in product?product.observed_at:product.last_success_at;
   case 'recommended':return null;
  }
 };
 return products.map((product,index)=>({product,index})).sort((a,b)=>{
  const selected=sortBy==='recommended'?0:compareMetricDesc(metric(a.product),metric(b.product));
  return selected||compareProductsByValue(a.product,b.product)||a.index-b.index;
 }).map(entry=>entry.product);
}
