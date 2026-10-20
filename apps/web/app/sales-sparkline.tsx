'use client';
import {buildSalesChart} from '@/packages/core/sales-chart';

export type SalesTrendPoint={
 t:number;
 sales:number;
 sales_raw_text:string|null;
 precision:'exact'|'lower_bound'|'approximate';
};
const dateLabel=(time:number)=>new Date(time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});

export function SalesSparkline({points}:{points:readonly SalesTrendPoint[]}){
 if(points.length===0)return <div className="sparkline-empty" role="status">
  <strong>暂无有效销量数据</strong>
  <span>等待首次采集成功后，这里自动生成折线图</span>
 </div>;
 const chart=buildSalesChart(points);
 const approximate=points.some(p=>p.precision!=='exact');
 return <div className="sparkline-wrap">
  <div className="sparkline-caption">
   <strong>商品销量趋势</strong>
   <small>最近 {points.length} 次有效采集{approximate?' · 含近似或下界值':''}</small>
  </div>
  <svg className="sales-sparkline" viewBox="0 0 640 166" role="img" aria-label={'商品销量折线图，'+points.length+' 个有效数据点；数值为页面展示值'}>
   <line x1="60" x2="626" y1="25" y2="25" className="sparkline-guide"/>
   <line x1="60" x2="626" y1="137" y2="137" className="sparkline-guide"/>
   <text x="6" y="29" className="sparkline-axis">{chart.max.toLocaleString('zh-CN')}</text>
   <text x="6" y="141" className="sparkline-axis">{chart.min.toLocaleString('zh-CN')}</text>
   {chart.coords.length>1&&<polyline points={chart.coords.map(p=>p.x+','+p.y).join(' ')} className="sparkline-line" fill="none" strokeLinejoin="round" strokeLinecap="round"/>}
   {chart.coords.map((pt,i)=><circle key={i} cx={pt.x} cy={pt.y} r={chart.coords.length===1?5:3.5} className="sparkline-dot">
    <title>{dateLabel(points[i].t)}　{points[i].sales_raw_text||points[i].sales}（{points[i].precision==='exact'?'精确展示值':points[i].precision==='lower_bound'?'下界值':'近似值'}）</title>
   </circle>)}
  </svg>
  <div className="sparkline-dates">
   <span>{dateLabel(points[0].t)}</span>
   {points.length===1?<span>只有 1 个点，等待下次采集形成趋势</span>:<span>{dateLabel(points[points.length-1].t)}</span>}
  </div>
 </div>;
}
