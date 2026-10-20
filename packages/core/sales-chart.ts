/** Deterministic time-proportional coordinates for a display-sales sparkline. */
export type NumericTrendPoint={t:number;sales:number};
export type ChartCoordinate={x:number;y:number};
export function buildSalesChart(points:readonly NumericTrendPoint[]):{
  coords:ChartCoordinate[];min:number;max:number
}{
 if(points.length===0)return {coords:[],min:0,max:0};
 const finite=points.filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.sales));
 if(!finite.length)return {coords:[],min:0,max:0};
 const min=Math.min(...finite.map(p=>p.sales));
 const max=Math.max(...finite.map(p=>p.sales));
 const start=Math.min(...finite.map(p=>p.t));
 const end=Math.max(...finite.map(p=>p.t));
 const timed=end!==start;
 const coords=finite.map((p,i)=>({
  x:Math.round(60+(timed?(p.t-start)/(end-start):(finite.length===1?0.5:i/(finite.length-1)))*566),
  y:Math.round(max===min?81:137-((p.sales-min)/(max-min))*112)
 }));
 return {coords,min,max};
}
