'use client';
import {useEffect,useState,useCallback} from 'react';
import {XHS_GOODS_SELECTORS} from '@/packages/core/source-selectors';
type Product={id:string;title:string|null;shop_name:string|null;category:string|null;canonical_url:string;monitor_status:string;binding_status:string;last_success_at:number|null;next_due_at:number|null;sales_raw_text:string|null;sales_precision:string|null;price_minor:number|null;observed_at:number|null;consecutive_failures:number;latest_job_status:string|null};
type Source={id:string;enabled:number;automated_access_allowed:number;storage_allowed:number;analysis_allowed:number;permission_basis:string;selectors_json:string;};
type Stats={products:number;ready:number;blocked:number;alerts:number;worker_heartbeat:number|null};
type Run={id:string;title:string|null;canonical_url:string;started_at:number;finished_at:number|null;result:string|null;error_code:string|null;attempt_no:number};
type Alert={id:string;type:string;severity:string;occurrences:number;last_seen_at:number;status:string;details_json:string};
type Observation={observed_at:number;sales_raw_text:string|null;sales_value:number|null;sales_precision:string;price_minor:number|null;quality_status:string};
const date=(value:number|null|undefined)=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
const yuan=(c:number|null|undefined)=>c===null||c===undefined?'—':'¥'+(c/100).toFixed(2);
function statusName(p:Product){
 if(p.monitor_status==='paused')return '已暂停';
 if(p.binding_status==='awaiting_authorization')return '等待来源授权';
 if(p.binding_status==='blocked')return '来源已阻断';
 if(p.binding_status!=='ready')return '未准备就绪';
 if(p.latest_job_status==='queued' && !p.last_success_at)return '首次采集排队中';
 if(p.latest_job_status==='running' && !p.last_success_at)return '首次采集中';
 if(p.latest_job_status==='retry_wait')return '采集失败，等待重试';
 if(p.latest_job_status==='failed' && !p.last_success_at)return '首次采集失败';
 if(p.latest_job_status==='partial' && !p.last_success_at)return '首次采集部分成功';
 return '监控已排期';
}
async function api<T>(path:string,options?:RequestInit):Promise<T>{
 const res=await fetch(path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...options?.headers}});
 if(res.status===401){location.href='/login';throw new Error('登录已过期');}
 const body=await res.json();
 if(!res.ok)throw new Error(body.error||'操作失败');
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
 const [runs,setRuns]=useState<Run[]>([]),[alerts,setAlerts]=useState<Alert[]>([]),[sources,setSources]=useState<Source[]>([]);
 const [urls,setUrls]=useState(''),[category,setCategory]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [detailId,setDetailId]=useState<string|null>(null),[history,setHistory]=useState<Observation[]>([]);
 const [sourceForm,setSourceForm]=useState({enabled:false,automated_access_allowed:false,storage_allowed:false,analysis_allowed:false,permission_basis:'',titleSelector:XHS_GOODS_SELECTORS.title,salesSelector:XHS_GOODS_SELECTORS.sales,priceSelector:XHS_GOODS_SELECTORS.price,shopSelector:XHS_GOODS_SELECTORS.shop});
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
   titleSelector:sel.title||XHS_GOODS_SELECTORS.title,salesSelector:sel.sales||XHS_GOODS_SELECTORS.sales,priceSelector:sel.price||XHS_GOODS_SELECTORS.price,shopSelector:sel.shop||XHS_GOODS_SELECTORS.shop});
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
  setBusy(true);setMessage('');
  try{await api('/api/sources',{method:'PATCH',body:JSON.stringify(sourceForm)});
   setMessage('来源设置已保存。启用前必须确认具备相应自动访问与存储授权。');await refresh();
  }catch(e){setMessage(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
 }
 async function updateProduct(id:string,monitor_status:string){
  try{await api('/api/products/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({monitor_status})});await refresh();}
  catch(e){setMessage(e instanceof Error?e.message:'修改失败');}
 }
 async function showDetail(id:string){
  try{const data=await api<{observations:Observation[]}>('/api/products/'+id);setDetailId(id);setHistory(data.observations);}
  catch(e){setMessage(e instanceof Error?e.message:'详情加载失败');}
 }
 async function logout(){
  await api('/api/auth/logout',{method:'POST'});location.href='/login';
 }
 const recent=stats?.worker_heartbeat?Date.now()-stats.worker_heartbeat<600000:false;
 return <div className="app-shell">
  <aside className="sidebar">
   <div className="logo"><span className="brand-mark">X</span><span>XHS Monitor<small>Competitor Intelligence</small></span></div>
   <nav>{[['products','商品监控'],['runs','采集记录'],['alerts','异常告警'],['settings','数据源与设置']].map(([k,v])=><button key={k} className={tab===k?'nav-item active':'nav-item'} onClick={()=>{setTab(k);setDetailId(null);}}>{v}</button>)}</nav>
   <div className="side-bottom"><span>当前用户 · {username}</span><button className="ghost" onClick={logout}>退出登录</button></div>
  </aside>
  <main className="content">
   <header className="top"><div><div className="eyebrow">PERSONAL ANALYTICS</div><h1>{({products:'商品监控',runs:'采集运行记录',alerts:'异常中心',settings:'数据源与设置'} as Record<string,string>)[tab]}</h1><p className="muted">竞品商品公开展示指标观察 · 请以数据来源和精度标记为准</p></div><button className="secondary" onClick={()=>void refresh()}>刷新数据</button></header>
   {message&&<div className="notice" role="status">{message}<button className="tiny" onClick={()=>setMessage('')}>关闭</button></div>}
   <div className="metrics">
    {[['监控商品',stats?.products??'—'],['已排期',stats?.ready??'—'],['来源阻断',stats?.blocked??'—'],['未处理告警',stats?.alerts??'—']].map(([name,v])=><div className="metric" key={name}><span className="muted">{name}</span><strong>{v}</strong></div>)}
   </div>
   <div className={recent?'worker-status ok':'worker-status warn'}>Worker：{recent?'运行心跳正常':'未检测到近期心跳'} · 上次心跳：{date(stats?.worker_heartbeat)} · 不代表销量采集成功</div>
   {tab==='products'&&<section className="panel">
     <h2>添加竞品商品</h2><p className="muted">每行一个小红书商品链接，最多 20 条。合法来源启用后自动开始首采。</p>
     <textarea rows={3} value={urls} placeholder="https://www.xiaohongshu.com/..." onChange={e=>setUrls(e.target.value)}/>
     <div className="actions"><input value={category} onChange={e=>setCategory(e.target.value)} placeholder="分类（可选，例如：班主任资料）"/><button onClick={add} disabled={busy||!urls.trim()}>{busy?'处理中…':'添加并建立监控'}</button></div>
   </section>}
   {tab==='products'&&<section className="panel">
     <div className="panel-head"><h2>商品列表</h2><span className="muted">{products.length} 个商品</span></div>
     <div className="table-scroll"><table><thead><tr><th>商品 / 店铺</th><th>展示销量</th><th>价格</th><th>状态</th><th>最近有效数据</th><th>操作</th></tr></thead><tbody>
      {products.map(p=><tr key={p.id}><td><strong>{p.title||'待采集商品名称'}</strong><small>{p.shop_name||p.category||'—'}</small><a href={p.canonical_url} target="_blank" rel="noopener noreferrer">原始商品链接 ↗</a></td>
       <td>{p.sales_raw_text||'未知'}<small>{p.sales_precision||'无数据'}</small></td><td>{yuan(p.price_minor)}</td>
       <td><span className={'tag '+(p.binding_status==='ready'?'tag-ok':'')}>{statusName(p)}</span></td>
       <td>{date(p.last_success_at)}</td><td><button className="text-button" onClick={()=>void showDetail(p.id)}>历史</button> <button className="text-button" onClick={()=>void updateProduct(p.id,p.monitor_status==='active'?'paused':'active')}>{p.monitor_status==='active'?'暂停':'恢复'}</button></td>
      </tr>)}
      {!products.length&&<tr><td colSpan={6} className="empty">还没有商品。添加链接后系统会检查来源许可并创建监控任务。</td></tr>}
     </tbody></table></div>
    </section>}
   {tab==='products'&&detailId&&<section className="panel"><div className="panel-head"><h2>历史观察</h2><button className="ghost" onClick={()=>setDetailId(null)}>关闭</button></div><Trend items={history}/>
    <div className="table-scroll"><table><thead><tr><th>采集时间</th><th>销售展示值</th><th>精度</th><th>价格</th><th>数据质量</th></tr></thead><tbody>{history.map(o=><tr key={o.observed_at}><td>{date(o.observed_at)}</td><td>{o.sales_raw_text||'未知'}</td><td>{o.sales_precision}</td><td>{yuan(o.price_minor)}</td><td>{o.quality_status}</td></tr>)}</tbody></table></div>
   </section>}
   {tab==='runs'&&<section className="panel"><h2>最新运行记录</h2><div className="table-scroll"><table><thead><tr><th>商品</th><th>开始</th><th>状态</th><th>错误码</th><th>尝试</th></tr></thead><tbody>{runs.map(r=><tr key={r.id}><td>{r.title||r.canonical_url.slice(0,42)}</td><td>{date(r.started_at)}</td><td>{r.result||'运行中'}</td><td>{r.error_code||'—'}</td><td>{r.attempt_no}</td></tr>)}</tbody></table></div>{!runs.length&&<p className="muted">尚无运行记录。仅有排队任务不代表抓取成功。</p>}</section>}
   {tab==='alerts'&&<section className="panel"><h2>采集与数据质量告警</h2><div className="table-scroll"><table><thead><tr><th>类型</th><th>级别</th><th>发生次数</th><th>最近发生</th><th>状态</th></tr></thead><tbody>{alerts.map(a=><tr key={a.id}><td>{a.type}</td><td>{a.severity}</td><td>{a.occurrences}</td><td>{date(a.last_seen_at)}</td><td>{a.status}</td></tr>)}</tbody></table></div>{!alerts.length&&<p className="muted">暂无异常告警。</p>}</section>}
   {tab==='settings'&&<section className="panel"><h2>自动采集来源</h2><p className="error">默认关闭。只有拥有明确的自动访问、保存和内部分析许可，才可以启用来源。配置选择器并不等同于取得授权。</p>
    <div className="form-grid">
     <label>授权依据 / 使用许可说明<textarea value={sourceForm.permission_basis} rows={2} onChange={e=>setSourceForm(v=>({...v,permission_basis:e.target.value}))} placeholder="注明许可提供方、授权范围、有效期及依据（不得虚构）"/></label>
     {([['titleSelector','商品标题 CSS 选择器'],['salesSelector','销量展示 CSS 选择器'],['priceSelector','价格 CSS 选择器'],['shopSelector','店铺 CSS 选择器']] as const).map(([k,label])=><label key={k}>{label}<input value={sourceForm[k]} onChange={e=>setSourceForm(v=>({...v,[k]:e.target.value}))} placeholder="配置获得许可的页面字段"/></label>)}
     {([['automated_access_allowed','已核实允许自动访问'],['storage_allowed','已核实允许存储'],['analysis_allowed','已核实允许内部分析'],['enabled','启用来源']] as const).map(([k,label])=><label className="check" key={k}><input type="checkbox" checked={sourceForm[k]} onChange={e=>setSourceForm(v=>({...v,[k]:e.target.checked}))}/>{label}</label>)}
    </div><div className="actions"><button disabled={busy} onClick={saveSource}>保存来源设置</button></div>
    <p className="footnote">Playwright 只访问被允许的 HTTPS 域名；遇到验证码、401/403/429 会暂停或终止，不提供绕过手段。</p>
   </section>}
   <footer>© XHS Monitor · 本工具分析的是来源展示指标，不是实际支付订单数据。</footer>
  </main>
 </div>;
}
