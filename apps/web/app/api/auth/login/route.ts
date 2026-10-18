import {NextRequest,NextResponse} from 'next/server';
import {db} from '../../../../../packages/db';
import {sameOrigin,verifyPassword,sessionCookieName,sessionValue} from '../../../../../packages/core/auth';
export const runtime='nodejs';
const counters=new Map<string,{n:number,until:number}>();
export async function POST(req:NextRequest){
 if(!sameOrigin(req))return NextResponse.json({error:'BAD_ORIGIN'},{status:403});
 const ip=(req.headers.get('x-real-ip')||'unknown').slice(0,100);
 const bucket=counters.get(ip);
 if(bucket && bucket.n>=6 && bucket.until>Date.now())return NextResponse.json({error:'RATE_LIMITED'},{status:429});
 let body:any;try{body=await req.json();}catch{return NextResponse.json({error:'INVALID_JSON'},{status:400});}
 if(typeof body.username!=='string'||typeof body.password!=='string'||body.password.length>256)
   return NextResponse.json({error:'BAD_CREDENTIALS'},{status:401});
 const row=db().prepare('SELECT * FROM admin_users WHERE username=?').get(body.username.trim()) as any;
 if(!row||!verifyPassword(body.password,row.salt,row.password_hash)){
  const prior=bucket&&bucket.until>Date.now()?bucket.n:0;
  counters.set(ip,{n:prior+1,until:Date.now()+900000});
  return NextResponse.json({error:'BAD_CREDENTIALS'},{status:401});
 }
 counters.delete(ip);
 const resp=NextResponse.json({data:{authenticated:true}});
 resp.cookies.set(sessionCookieName(),sessionValue(row.id),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:43200});
 return resp;
}
