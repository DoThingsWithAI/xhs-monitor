'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
export default function LoginForm(){
 const router=useRouter();
 const [username,setUsername]=useState('admin'),[password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e:React.FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{
   const res=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
   if(!res.ok){setError(res.status===429?'尝试次数过多，请稍后重试':'用户名或密码错误');return;}
   router.replace('/');router.refresh();
  }catch{setError('网络错误，请稍后重试');}finally{setBusy(false);}
 }
 return <div className="login-card"><div className="brand-mark">X</div><h1>XHS Monitor</h1>
  <p className="muted">小红书竞品监控 · 私人工作台</p>
  <form onSubmit={submit} className="stack">
   <label>用户名<input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required/></label>
   <label>密码<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
   {error&&<p className="error">{error}</p>}
   <button type="submit" disabled={busy}>{busy?'正在登录…':'登录工作台'}</button>
  </form>
  <p className="footnote">首次使用：在 VPS 执行 npm run admin:init 初始化管理员。</p>
 </div>;
}
