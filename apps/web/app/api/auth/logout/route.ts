import {NextRequest,NextResponse} from 'next/server';
import {getAdmin,sameOrigin,sessionCookieName} from '../../../../../packages/core/auth';
export async function POST(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 if(!sameOrigin(req))return NextResponse.json({error:'BAD_ORIGIN'},{status:403});
 const res=NextResponse.json({data:{ok:true}});
 res.cookies.set(sessionCookieName(),'',{path:'/',httpOnly:true,maxAge:0,secure:process.env.NODE_ENV==='production'});
 return res;
}
