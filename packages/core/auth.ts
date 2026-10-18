import {randomBytes,createHmac,scryptSync,timingSafeEqual} from 'node:crypto';
import type {NextRequest} from 'next/server';
import {db} from '../db/index';

const COOKIE = 'xhs_session';
export function passwordHash(password:string, salt:string):string {
 return scryptSync(password,salt,64).toString('hex');
}
export function newSalt():string { return randomBytes(24).toString('hex'); }
export function verifyPassword(password:string,salt:string,hash:string):boolean {
 const computed=Buffer.from(passwordHash(password,salt),'hex');
 const expected=Buffer.from(hash,'hex');
 return computed.length === expected.length && timingSafeEqual(computed,expected);
}
function secret(): string {
 const value=process.env.SESSION_SECRET;
 if (!value || value.length<40) throw new Error('SESSION_SECRET_MISSING');
 return value;
}
export function sessionValue(id:string):string {
 const expires=Date.now()+12*60*60*1000;
 const payload=Buffer.from(JSON.stringify({id,expires,nonce:randomBytes(12).toString('hex')})).toString('base64url');
 const signature=createHmac('sha256',secret()).update(payload).digest('base64url');
 return payload+'.'+signature;
}
export function sessionCookieName(){return COOKIE;}

export function getAdminFromToken(token:string|undefined):{id:string;username:string}|null {
 if(!token)return null;
 const [payload,sig]=token.split('.');
 if(!payload || !sig || payload.length>2000)return null;
 const expected=createHmac('sha256',secret()).update(payload).digest('base64url');
 if(sig.length!==expected.length || !timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;
 let p:{id:string;expires:number};
 try{p=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{return null;}
 if(!p || typeof p.id!=='string' || !Number.isFinite(p.expires) || p.expires<Date.now())return null;
 const row=db().prepare('SELECT id,username FROM admin_users WHERE id=?').get(p.id) as {id:string;username:string}|undefined;
 return row??null;
}

export function getAdmin(req:NextRequest){ return getAdminFromToken(req.cookies.get(COOKIE)?.value); }
export function sameOrigin(req:NextRequest): boolean {
 const origin=req.headers.get('origin');
 if(!origin)return false;
 try {
   const u=new URL(origin);
   const host=req.headers.get('x-forwarded-host')||req.headers.get('host');
   return u.host===host && ((u.protocol==='https:' && host===process.env.APP_DOMAIN) || (process.env.NODE_ENV!=='production' && u.protocol==='http:' && /^localhost(:\d+)?$/.test(host||'')));
 } catch {return false;}
}
