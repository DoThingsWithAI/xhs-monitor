'use client';
import {useEffect,useState,useCallback,useRef,useMemo} from 'react';
import {XHS_GOODS_SELECTORS} from '@/packages/core/source-selectors';
import {sourceBlockingReason} from '@/packages/core/source-readiness';
import {validateSourceForm} from '@/packages/core/source-form-validation';
import {sortProducts,type ProductSortKey} from '@/packages/core/product-ranking';
import {SalesSparkline,type SalesTrendPoint} from './sales-sparkline';
type HotProductScore={rate:number|null;todaySales:number|null;productValueCents:number|null;observedAt:number|null;baselineAt:number|null};
type Product={id:string;title:string|null;shop_name:string|null;category:string|null;canonical_url:string;monitor_status:string;hot_threshold:number;binding_status:string;last_success_at:number|null;next_due_at:number|null;sales_raw_text:string|null;sales_precision:string|null;price_minor:number|null;observed_at:number|null;consecutive_failures:number;latest_job_status:string|null;latest_error_code:string|null;trend_points:SalesTrendPoint[];hot_score:HotProductScore|null;shop_rating_raw_text:string|null;shop_rating_hundredths:number|null;shop_sales_raw_text:string|null;shop_sales_precision:string|null;shop_followers_raw_text:string|null;shop_followers_precision:string|null;};
type Source={id:string;enabled:number;automated_access_allowed:number;storage_allowed:number;analysis_allowed:number;permission_basis:string;permission_expires_at:number|null;selectors_json:string;};
type Stats={products:number;ready:number;blocked:number;alerts:number;worker_heartbeat:number|null};
type Run={id:string;title:string|null;canonical_url:string;started_at:number;finished_at:number|null;result:string|null;error_code:string|null;attempt_no:number};
type Alert={id:string;type:string;severity:string;occurrences:number;last_seen_at:number;status:string;details_json:string};
type Observation={observed_at:number;sales_raw_text:string|null;sales_value:number|null;sales_precision:string;price_minor:number|null;quality_status:string;shop_observed:string|null;shop_rating_raw_text:string|null;shop_rating_hundredths:number|null;shop_sales_raw_text:string|null;shop_sales_value:number|null;shop_sales_precision:string;shop_followers_raw_text:string|null;shop_followers_value:number|null;shop_followers_precision:string};
const date=(value:number|null|undefined)=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
const yuan=(c:number|null|undefined)=>c===null||c===undefined?'—':(c<0?'-':'')+'¥'+(Math.abs(c)/100).toFixed(2);
function statusName(p:Product,sourceIssue:string|null){
 if(p.monitor_status==='paused')return '已暂停';
 if(p.binding_status==='awaiting_authorization')return sourceIssue??'来源配置已满足，等待任务绑定同步';
 if(p.binding_status==='blocked')return '来源已阻断';
 if(p.binding_status!=='ready')return '未准备就绪';
 if(p.latest_job_status==='queued' && !p.last_success_at)return '首次采集排队中';
 if(p.latest_job_status==='running' && !p.last_success_at)return '首次采集中';
 if(p.latest_job_status==='retry_wait')return '采集失败，等待重试';
 if(p.latest_job_status==='failed')return p.last_success_at?'最近采集失败（保留历史）':'首次采集失败';
 if(p.latest_job_status==='partial')return p.last_success_at?'最近采集不完整':'首次采集部分成功';
 return '监控已排期';
}
async function api<T>(path:string,options?:RequestInit):Promise<T>{
 const res=await fetch(path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...options?.headers}});
 if(res.status===401){location.href='/login';throw new Error('登录已过期');}
 const body=await res.json();
 if(!res.ok)throw new Error(Array.isArray(body.details)&&body.details.length?body.details.join('；'):(body.error||'操作失败'));
 return body.data as T;
}
function Trend({items}:{items:Observation[]}){
 const points=items.filter(o=>o.sales_value!==null).slice().reverse();
 if(points.length<2)return <p className="muted">至少需要 2 次有效观察才能展示趋势。</p>;
 const vals=points.map(p=>p.sales_value as number),min=Math.min(...vals),max=Math.max(...vals),span=Math.max(1,max-min);
 const path=points.map((p,i)=>((i/(points.length-1))*740+20).toFixed(1)+','+(160-(((p.sales_value as number)-min)/span)*120).toFixed(1)).join(' ');
 return <div><svg role="img" aria-label="销量展示值历史趋势，不代表真实订单增量" viewBox="0 0 780 185" className="trend"><polyline points={path} fill="none" stroke="#3e78f0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg><p className="footnote">仅供展示值趋势参考；“万+”属于近似下界，不代表真实订单增量。</p></div>;
}
export default function Dashboard({username}:{username:string}){
 const [tab,setTab]=useState('products'),[products,setProducts]=useState<Product[]>([]),[stats,setStats]=useState<Stats|null>(null);
 const [sortBy,setSortBy]=useState<ProductSortKey>('recommended');
 const sortedProducts=useMemo(()=>sortProducts(products,sortBy),[products,sortBy]);
 const [runs,setRuns]=useState<Run[]>([]),[alerts,setAlerts]=useState<Alert[]>([]),[sources,setSources]=useState<Source[]>([]);
 const [urls,setUrls]=useState(''),[category,setCategory]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [sourceSaveError,setSourceSaveError]=useState('');
 const [editingThresholdId,setEditingThresholdId]=useState<string|null>(null);
 const [thresholdDraft,setThresholdDraft]=useState('2');
 const [savingThreshold,setSavingThreshold]=useState(false);
 const [detailId,setDetailId]=useState<string|null>(null),[history,setHistory]=useState<Observation[]>([]);
 const [detailLoading,setDetailLoading]=useState(false),[detailError,setDetailError]=useState('');
 const detailRequestId=useRef(0);
 const detailDrawerRef=useRef<HTMLElement|null>(null),detailCloseRef=useRef<HTMLButtonElement|null>(null);
 const detailTriggerRef=useRef<HTMLElement|null>(null);
 const [sourceForm,setSourceForm]=useState({enabled:false,automated_access_allowed:false,storage_allowed:false,analysis_allowed:false,permission_basis:'',titleSelector:XHS_GOODS_SELECTORS.title as string,salesSelector:XHS_GOODS_SELECTORS.sales as string,priceSelector:XHS_GOODS_SELECTORS.price as string,shopSelector:XHS_GOODS_SELECTORS.shop as string,shopRatingSelector:XHS_GOODS_SELECTORS.shopRating as string,shopStatsSelector:XHS_GOODS_SELECTORS.shopStats as string});
 const refresh=useCallback(async()=>{
  try{
   const [p,s,r,a,so]=await Promise.all([api<Product[]>('/api/products'),api<{stats:Stats}>('/api/system'),api<Run[]>('/api/runs'),api<Alert[]>('/api/alerts'),api<Source[]>('/api/sources')]);
   setProducts(p);setStats(s.stats);setRuns(r);setAlerts(a);setSources(so);
  }catch(e){setMessage(e instanceof Error?e.message:'加载失败');}
 },[]);
 useEffect(()=>{void refresh();const id=setInterval(()=>void refresh(),45000);return()=>clearInterval(id);},[refresh]);
 useEffect(()=>{
  if(!sources[0])return;
  const s=sources[0];let sel:Record<string,string>={};
  try{sel=JSON.parse(s.selectors_json);}catch{}
  setSourceForm({enabled:!!s.enabled,automated_access_allowed:!!s.automated_access_allowed,
   storage_allowed:!!s.storage_allowed,analysis_allowed:!!s.analysis_allowed,permission_basis:s.permission_basis||'',
   titleSelector:sel.title||XHS_GOODS_SELECTORS.title,salesSelector:sel.sales||XHS_GOODS_SELECTORS.sales,priceSelector:sel.price||XHS_GOODS_SELECTORS.price,shopSelector:sel.shop||XHS_GOODS_SELECTORS.shop,shopRatingSelector:sel.shopRating||XHS_GOODS_SELECTORS.shopRating,shopStatsSelector:sel.shopStats||XHS_GOODS_SELECTORS.shopStats});
 },[sources.length]); // Fetch refresh does not erase unsaved edits
 async function add(){
  const items=urls.split(/[\n\r]+/).map(s=>s.trim()).filter(Boolean);
  if(!items.length)return;
  setBusy(true);setMessage('');
  try{const result=await api<Array<{created?:boolean;error?:string;monitoring?:string}>>('/api/products',{method:'POST',body:JSON.stringify({urls:items,category})});
   const ok=result.filter(x=>!x.error).length;
   const queued=result.filter(x=>x.monitoring==='queued').length;
   setMessage('已处理 '+ok+'/'+result.length+' 个商品，其中 '+queued+' 个已自动加入首次采集队列。没有来源许可的商品将等待授权。');
   setUrls('');await refresh();
  }catch(e){setMessage(e instanceof Error?e.message:'添加失败');}finally{setBusy(false);}
 }
 async function saveSource(){
  setSourceSaveError('');setMessage('');
  const issues=validateSourceForm(sourceForm);
  if(issues.length){setSourceSaveError(issues.join('；'));return;}
  setBusy(true);
  try{await api('/api/sources',{method:'PATCH',body:JSON.stringify(sourceForm)});
   setMessage('来源配置已保存。请查看监控任务状态；表单校验不代表第三方已授予许可。');
   await refresh();
  }catch(e){setSourceSaveError(e instanceof Error?e.message:'保存失败');}
  finally{setBusy(false);}
 }
 async function updateProduct(id:string,monitor_status:string){
  try{await api('/api/products/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({monitor_status})});await refresh();}
  catch(e){setMessage(e instanceof Error?e.message:'修改失败');}
 }
 async function saveHotThreshold(id:string){
  const v=thresholdDraft.trim();
  if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)>1000000){
   setMessage('爆品预值只能填写 0 到 1000000 的整数');return;
  }
  setSavingThreshold(true);setMessage('');
  try{
   await api('/api/products/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({hot_threshold:Number(v)})});
   setEditingThresholdId(null);await refresh();
  }catch(e){setMessage(e instanceof Error?e.message:'爆品预值保存失败');}
  finally{setSavingThreshold(false);}
 }
 function closeDetail(){
  detailRequestId.current+=1;
  setDetailId(null);
  setDetailLoading(false);
  setDetailError('');
 }
 async function showDetail(id:string){
  const requestId=++detailRequestId.current;
  detailTriggerRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  setDetailId(id);setHistory([]);setDetailError('');setDetailLoading(true);
  try{
   const data=await api<{observations:Observation[]}>('/api/products/'+encodeURIComponent(id));
   if(detailRequestId.current===requestId)setHistory(data.observations);
  }catch(e){
   if(detailRequestId.current===requestId)setDetailError(e instanceof Error?e.message:'详情加载失败');
  }finally{
   if(detailRequestId.current===requestId)setDetailLoading(false);
  }
 }
 // The drawer opens over the current card; keep the scroll position in the product list.
 useEffect(()=>{
  if(!detailId)return;
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  detailCloseRef.current?.focus();
  function keydown(event:KeyboardEvent){
   if(event.key==='Escape'){
    event.preventDefault();
    closeDetail();
   }
   if(event.key!=='Tab')return;
   const drawer=detailDrawerRef.current;
   if(!drawer)return;
   const focusable=Array.from(drawer.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
   const first=focusable[0],last=focusable[focusable.length-1];
   if(!first||!last)return;
   if(event.shiftKey&&(document.activeElement===first||!drawer.contains(document.activeElement))){
    event.preventDefault();last.focus();
   }else if(!event.shiftKey&&(document.activeElement===last||!drawer.contains(document.activeElement))){
    event.preventDefault();first.focus();
   }
  }
  window.addEventListener('keydown',keydown);
  return ()=>{
   document.body.style.overflow=previousOverflow;
   window.removeEventListener('keydown',keydown);
   detailTriggerRef.current?.focus();
  };
 },[detailId]);

 async function logout(){
  await api('/api/auth/logout',{method:'POST'});location.href='/login';
 }
 const recent=stats?.worker_heartbeat?Date.now()-stats.worker_heartbeat<600000:false;
 const sourceIssue=sources.length>0?sourceBlockingReason(sources.find(s=>s.id==='xhs-browser')):null;
 const sourceFormIssues=validateSourceForm(sourceForm);
 const detailProduct=products.find(product=>product.id===detailId);
 return <div className="app-shell">
  <header className="app-topbar">
   <div className="logo"><span className="brand-mark">X</span><span>XHS Monitor<small>Competitor Intelligence</small></span></div>
   <nav aria-label="主导航">{[['products','商品监控'],['runs','采集记录'],['alerts','异常告警'],['settings','数据源与设置']].map(([k,v])=><button key={k} type="button" aria-pressed={tab===k} className={tab===k?'nav-item active':'nav-item'} onClick={()=>{setTab(k);closeDetail();}}>{v}</button>)}</nav>
   <div className="topbar-user"><span title={username}>当前用户 · {username}</span><button className="ghost" onClick={logout}>退出登录</button></div>
  </header>
  <main className="content">
   <header className="top"><div><div className="eyebrow">PERSONAL ANALYTICS</div><h1>{({products:'商品监控',runs:'采集运行记录',alerts:'异常中心',settings:'数据源与设置'} as Record<string,string>)[tab]}</h1><p className="muted">竞品商品公开展示指标观察 · 请以数据来源和精度标记为准</p></div><button className="secondary" onClick={()=>void refresh()}>刷新数据</button></header>
   {message&&<div className="notice" role="status">{message}<button className="tiny" onClick={()=>setMessage('')}>关闭</button></div>}
   <div className="metrics">
    {[['监控商品',stats?.products??'—'],['已排期',stats?.ready??'—'],['来源阻断',stats?.blocked??'—'],['未处理告警',stats?.alerts??'—']].map(([name,v])=><div className="metric" key={name}><span className="muted">{name}</span><strong>{v}</strong></div>)}
   </div>
   <div className={recent?'worker-status ok':'worker-status warn'}>Worker：{recent?'运行心跳正常':'未检测到近期心跳'} · 上次心跳：{date(stats?.worker_heartbeat)} · 不代表销量采集成功</div>
   {tab==='products'&&sourceIssue&&<div className="notice" role="status">
    <span><strong>自动监控暂不可用：</strong>{sourceIssue}。字段解析代码已提交，但不会自动授予站点访问权限。</span>
    <button className="secondary" onClick={()=>setTab('settings')}>查看来源设置</button>
   </div>}
   {tab==='products'&&<section className="panel">
     <h2>添加竞品商品</h2><p className="muted">每行一个小红书商品链接，最多 20 条。合法来源启用后自动开始首采。</p>
     <textarea rows={3} value={urls} placeholder="https://www.xiaohongshu.com/..." onChange={e=>setUrls(e.target.value)}/>
     <div className="actions"><input value={category} onChange={e=>setCategory(e.target.value)} placeholder="分类（可选，例如：班主任资料）"/><button onClick={add} disabled={busy||!urls.trim()}>{busy?'处理中…':'添加并建立监控'}</button></div>
   </section>}
   {tab==='products'&&<section className="panel monitored-products">
     <div className="panel-head product-list-toolbar">
      <div className="product-list-heading"><h2>商品销量趋势</h2><span className="muted">{products.length} 个商品 · 每个商品显示最近 30 次有效观察</span></div>
      <label className="product-sort-control">
       <span>排序方式</span>
       <select aria-label="商品排序方式" value={sortBy} onChange={event=>setSortBy(event.target.value as ProductSortKey)}>
        <option value="recommended">默认推荐（商品价值 → 爆品值 → 今日新增销量）</option>
        <option value="productValue">商品价值（高 → 低）</option>
        <option value="hotRate">爆品值（高 → 低）</option>
        <option value="todaySales">今日新增销量（高 → 低）</option>
        <option value="totalSales">商品累计已售（高 → 低）</option>
        <option value="price">当前展示价格（高 → 低）</option>
        <option value="lastCollected">最近采集时间（新 → 旧）</option>
       </select>
      </label>
     </div>
     {products.length===0?<p className="empty">还没有商品。添加链接后，商品卡片将在这里出现；只有真实采集数据才会形成折线图。</p>:
      <div className="product-card-grid">
       {sortedProducts.map(p=>{
        const trend=p.trend_points||[];
        const latest=trend.length?trend[trend.length-1]:null;
        const hot=p.hot_score;
        return <article className="product-card" key={p.id}>
         <div className="product-card-top">
          <div className="product-card-title">
           <strong title={p.title||p.canonical_url}>{p.title||'待采集商品名称'}</strong>
           <span>{p.shop_name||p.category||'店铺信息待采集'}</span>
          </div>
          <span className={'tag product-card-status '+(p.binding_status==='ready'&&p.latest_job_status!=='failed'?'tag-ok':'')}>{statusName(p,sourceIssue)}</span>
         </div>
         <div className="product-card-kpis">
          <div><small>最近有效商品已售</small><strong>{latest?(latest.sales_raw_text||latest.sales.toLocaleString('zh-CN')):'—'}</strong></div>
          <div><small>爆品值（今日新增－预值）/累计已售</small><strong title={hot?.rate!==null&&hot?.rate!==undefined?'对比 '+date(hot.baselineAt)+' 与 '+date(hot.observedAt)+' 两次采集的展示销量':'需今日和昨日均有精确销量记录'}>{typeof hot?.rate==='number'?(hot.rate*100).toFixed(2)+'%':'—'}</strong></div>
          <div><small>今日新增销量（快照估算）</small><strong>{typeof hot?.todaySales==='number'?hot.todaySales.toLocaleString('zh-CN'):'—'}</strong></div>
           <div className="hot-threshold-control">
            <small>爆品预值（阈值，默认 2）</small>
            {editingThresholdId===p.id?
             <div className="hot-threshold-editor">
              <input aria-label="爆品预值" type="number" min="0" max="1000000" step="1" value={thresholdDraft} onChange={e=>setThresholdDraft(e.target.value)}/>
              <button disabled={savingThreshold} onClick={()=>void saveHotThreshold(p.id)}>保存</button>
              <button className="ghost" disabled={savingThreshold} onClick={()=>setEditingThresholdId(null)}>取消</button>
             </div>:
             <div className="hot-threshold-display"><strong>{p.hot_threshold??2}</strong><button className="text-button" onClick={()=>{setEditingThresholdId(p.id);setThresholdDraft(String(p.hot_threshold??2));}}>调整</button></div>}
           </div>
          <div><small>商品价值（估算）</small><strong title="商品价值 = 商品当日展示价（代替实际客单价）× 今日新增销量 × 爆品值。缺少精确价格或销量时不计算。">{yuan(hot?.productValueCents)}</strong></div>
          <div><small>当前展示价格</small><strong>{yuan(p.price_minor)}</strong></div>
          <div><small>卖家口碑</small><strong>{p.shop_rating_raw_text??'—'}</strong></div>
          <div><small>店铺已售 / 粉丝</small><strong className="product-card-small-number">{p.shop_sales_raw_text??'—'} / {p.shop_followers_raw_text??'—'}</strong></div>
         </div>
         {p.latest_job_status==='failed'&&p.latest_error_code&&
          <div className="product-collection-error" role="status">最近一次采集失败：{p.latest_error_code}。折线图仍显示上次成功保存的数据。</div>}
         <SalesSparkline points={trend}/>
         <div className="product-card-footer">
          <small>最近有效销量：{latest?date(latest.t):'尚无记录'}</small>
          <div>
           <a href={p.canonical_url} target="_blank" rel="noopener noreferrer">商品链接 ↗</a>
           <button className="text-button" onClick={()=>void showDetail(p.id)}>明细</button>
           <button className="text-button" onClick={()=>void updateProduct(p.id,p.monitor_status==='active'?'paused':'active')}>{p.monitor_status==='active'?'暂停':'恢复'}</button>
          </div>
         </div>
        </article>;
       })}
      </div>}
     <p className="footnote">爆品值 =（今日新增销量－爆品预值）÷当前累计已售，爆品预值按商品设置，默认 2，可修改。按北京时间划分日期；爆品值可能是负数。商品价值（估算）= 当天商品展示价 × 今日新增销量（快照估算）× 爆品值；展示价不是实际客单价，因此不代表真实销售额或利润。仅在当日有明确展示价格且今昨均有精确累计销量时计算；缺值、起售价、近似/下界销量或异常回退均显示“—”，不误记为 0。</p>
    </section>}

   {tab==='runs'&&<section className="panel"><h2>最新运行记录</h2><div className="table-scroll"><table><thead><tr><th>商品</th><th>开始</th><th>状态</th><th>错误码</th><th>尝试</th></tr></thead><tbody>{runs.map(r=><tr key={r.id}><td>{r.title||r.canonical_url.slice(0,42)}</td><td>{date(r.started_at)}</td><td>{r.result||'运行中'}</td><td>{r.error_code||'—'}</td><td>{r.attempt_no}</td></tr>)}</tbody></table></div>{!runs.length&&<p className="muted">尚无运行记录。仅有排队任务不代表抓取成功。</p>}</section>}
   {tab==='alerts'&&<section className="panel"><h2>采集与数据质量告警</h2><div className="table-scroll"><table><thead><tr><th>类型</th><th>级别</th><th>发生次数</th><th>最近发生</th><th>状态</th></tr></thead><tbody>{alerts.map(a=><tr key={a.id}><td>{a.type}</td><td>{a.severity}</td><td>{a.occurrences}</td><td>{date(a.last_seen_at)}</td><td>{a.status}</td></tr>)}</tbody></table></div>{!alerts.length&&<p className="muted">暂无异常告警。</p>}</section>}
   {tab==='settings'&&<section className="panel"><h2>自动采集来源</h2><p className="error">默认关闭。只有拥有明确的自动访问、保存和内部分析许可，才可以启用来源。配置选择器并不等同于取得授权。</p>
    <div className="form-grid">
     <label>授权依据 / 使用许可说明（启用时至少 12 个字符）
       <textarea value={sourceForm.permission_basis} rows={2} onChange={e=>{setSourceForm(v=>({...v,permission_basis:e.target.value}));setSourceSaveError('');}} placeholder="如有真实许可，请注明提供方、授权范围、有效期及依据（不得虚构）"/>
       <small>已填写 {sourceForm.permission_basis.trim().length} / 至少 12 字符。填写文本和勾选权限不能代替实际授权。</small>
      </label>
     {([['titleSelector','商品标题 CSS 选择器'],['salesSelector','销量展示 CSS 选择器'],['priceSelector','价格 CSS 选择器'],['shopSelector','店铺名称 CSS 选择器'],['shopRatingSelector','卖家口碑 CSS 选择器'],['shopStatsSelector','店铺销量/粉丝行 CSS 选择器']] as const).map(([k,label])=><label key={k}>{label}<input value={sourceForm[k]} onChange={e=>setSourceForm(v=>({...v,[k]:e.target.value}))} placeholder="配置获得许可的页面字段"/></label>)}
     {([['automated_access_allowed','已核实允许自动访问'],['storage_allowed','已核实允许存储'],['analysis_allowed','已核实允许内部分析'],['enabled','启用来源']] as const).map(([k,label])=><label className="check" key={k}><input type="checkbox" checked={sourceForm[k]} onChange={e=>setSourceForm(v=>({...v,[k]:e.target.checked}))}/>{label}</label>)}
    </div>
    {sourceFormIssues.length>0&&<p className="error" role="status">启用前需要补全：{sourceFormIssues.join('；')}</p>}
    {sourceSaveError&&<p className="error" role="alert">保存失败：{sourceSaveError}</p>}
    <div className="actions"><button disabled={busy} onClick={saveSource}>{busy?'正在保存…':'保存来源设置'}</button></div>
    <p className="footnote">Playwright 只访问被允许的 HTTPS 域名；遇到验证码、401/403/429 会暂停或终止，不提供绕过手段。</p>
   </section>}
   <footer>© XHS Monitor · 本工具分析的是来源展示指标，不是实际支付订单数据。</footer>
  </main>
  {detailId&&<div className="detail-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeDetail();}}>
   <aside className="detail-drawer" ref={detailDrawerRef} role="dialog" aria-modal="true" aria-labelledby="detail-drawer-title">
    <div className="detail-drawer-header">
     <div className="detail-drawer-heading">
      <small>商品销量监控 · 历史观察</small>
      <h2 id="detail-drawer-title">{detailProduct?.title||'商品销量明细'}</h2>
      <p title={detailProduct?.shop_name||undefined}>{detailProduct?.shop_name||'历史采集记录'}</p>
     </div>
     <button type="button" className="detail-close" ref={detailCloseRef} aria-label="关闭明细" onClick={closeDetail}>×</button>
    </div>
    <div className="detail-drawer-body">
     {detailLoading?<p className="detail-state" role="status">正在加载历史记录…</p>:
      detailError?<div className="detail-state" role="alert">明细加载失败：{detailError}<button className="secondary" onClick={()=>void showDetail(detailId)}>重新加载</button></div>:
      history.length===0?<p className="detail-state">暂无历史采集记录。</p>:
      <>
       <div className="detail-record-count">{history.length} 条采集记录 · 按采集时间从近到远</div>
       <div className="detail-history-list">
        {history.map((o,i)=><article className="detail-history-entry" key={o.observed_at+'-'+i}>
         <div className="detail-history-entry-head">
          <time dateTime={new Date(o.observed_at).toISOString()}>{date(o.observed_at)}</time>
          <span className="detail-quality">{o.quality_status==='success'?'采集成功':o.quality_status==='partial'?'采集部分成功':o.quality_status}</span>
         </div>
         <div className="detail-history-fields">
          <div><small>商品已售</small><strong>{o.sales_raw_text||(o.sales_value===null?'—':o.sales_value.toLocaleString('zh-CN'))}</strong><span>精度：{o.sales_precision}</span></div>
          <div><small>展示价格</small><strong>{yuan(o.price_minor)}</strong></div>
          <div><small>卖家口碑</small><strong>{o.shop_rating_raw_text??'—'}</strong></div>
          <div><small>店铺已售</small><strong>{o.shop_sales_raw_text??'—'}</strong><span>{o.shop_sales_precision}</span></div>
          <div><small>店铺粉丝</small><strong>{o.shop_followers_raw_text??'—'}</strong><span>{o.shop_followers_precision}</span></div>
          <div><small>采集店铺</small><strong>{o.shop_observed??'—'}</strong></div>
         </div>
        </article>)}
       </div>
       <section className="detail-history-chart">
        <h3>商品累计销量走势</h3>
        <Trend items={history}/>
       </section>
      </>}
    </div>
   </aside>
  </div>}
 </div>;
}
