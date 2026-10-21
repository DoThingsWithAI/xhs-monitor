import type {Page} from 'playwright';

/** No HTML, URLs, tokens, screenshots, or page text leave the browser. */
export type ProductPageProbe={
 readyState:string; bodyCharacters:number; productFields:number; challenge:boolean;
};
const challengePattern=/请完成安全验证|请先完成验证|人机验证|滑块验证|验证码验证|访问过于频繁|检测到异常访问|操作过于频繁|访问受限|security verification|unusual traffic|captcha challenge|verify you are human|access denied|请登录后查看/;
export function looksLikeAccessChallenge(text:string):boolean{
 return challengePattern.test(text.toLowerCase());
}
export async function waitForProductFields(page:Page, selectors:Record<string,string>,timeoutMs=15000):Promise<void>{
 const keys=['title','sales','price','shop','shopRating','shopStats'];
 const values=keys.map(k=>selectors[k]).filter(s=>typeof s==='string' && s.trim());
 if(!values.length)return;
 await page.waitForFunction((values:string[])=>values.some(selector=>{
  try{return Boolean(document.querySelector(selector)?.textContent?.trim());}catch{return false;}
 }),values,{timeout:timeoutMs,polling:500}).catch(()=>{});
}
export async function inspectProductPage(page:Page,selectors:Record<string,string>):Promise<ProductPageProbe>{
 const keys=['title','sales','price','shop','shopRating','shopStats'];
 return page.evaluate((values:string[])=>{
  let found=0;
  for(const selector of values){
   if(!selector)continue;
   try{if(document.querySelector(selector)?.textContent?.trim())found++;}
   catch{} // Misconfigured CSS is not permission to read other data.
  }
  const text=(document.body?.innerText||'').slice(0,12000).toLowerCase();
  return {
   readyState:document.readyState,
   bodyCharacters:document.body?.innerText?.length||0,
   productFields:found,
   challenge:/请完成安全验证|请先完成验证|人机验证|滑块验证|验证码验证|访问过于频繁|检测到异常访问|操作过于频繁|访问受限|security verification|unusual traffic|captcha challenge|verify you are human|access denied|请登录后查看/.test(text)
  };
 },keys.map(k=>selectors[k]||''));
}
export function summarizePageProbe(probe:ProductPageProbe,httpStatus:number|null,blockedSubresources:number):string{
 const ready=['loading','interactive','complete'].includes(probe.readyState)?probe.readyState:'unknown';
 const status=httpStatus===null?'none':String(httpStatus);
 return ('http='+status+';dom='+ready+';bodyChars='+probe.bodyCharacters+
  ';fields='+probe.productFields+';blockedSubresources='+blockedSubresources).slice(0,180);
}
