import {NextRequest,NextResponse} from 'next/server';
import {getAdmin,sameOrigin} from '@/packages/core/auth';
import {audit} from '@/packages/db';
import {enqueueFailedManualRetries} from '@/packages/db/queue';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(req:NextRequest){
 if(!getAdmin(req))return NextResponse.json({error:'UNAUTHORIZED'},{status:401});
 if(!sameOrigin(req))return NextResponse.json({error:'BAD_ORIGIN'},{status:403});

 const result=enqueueFailedManualRetries();
 if(result.queued>0)
  audit('manual_retry_failed_products','collection_jobs',String(result.queued));

 return NextResponse.json({data:result});
}
