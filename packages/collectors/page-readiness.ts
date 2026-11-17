import type {Page} from 'playwright';

const SELECTOR_KEYS=['title','sales','price','shop','shopStats','shopRating'] as const;
const PRODUCT_FIELD_KEYS=['title','sales','price','shop','shopStats'] as const;

export type SelectorProbe={
 configured:boolean;
 matched:number;
 nonEmpty:number;
 invalid:boolean;
};

/** Metadata only: never returns page text, HTML, URLs, selectors, tokens, or screenshots. */
export type ProductPageProbe={
 readyState:string;
 bodyCharacters:number;
 productFields:number;
 matchedFields:number;
 configuredSelectors:number;
 invalidSelectors:string[];
 challenge:boolean;
 fields:Record<string,SelectorProbe>;
};

export type PageFailureReason=
 |'verification_required'
 |'invalid_selectors'
 |'page_not_rendered'
 |'resources_blocked'
 |'selectors_not_matched'
 |'fields_empty';

const challengePattern=/请完成安全验证|请先完成验证|人机验证|滑块验证|验证码验证|访问过于频繁|检测到异常访问|操作过于频繁|访问受限|security verification|unusual traffic|captcha challenge|verify you are human|access denied|请登录后查看/i;

export function looksLikeAccessChallenge(text:string):boolean{
 return challengePattern.test(text);
}

export async function waitForProductFields(page:Page,selectors:Record<string,string>,timeoutMs=15000):Promise<void>{
 const values=PRODUCT_FIELD_KEYS.map(key=>selectors[key]).filter(value=>typeof value==='string'&&value.trim());
 if(!values.length)return;
 await page.waitForFunction((items:string[])=>items.some(selector=>{
  try{return Boolean(document.querySelector(selector)?.textContent?.trim());}
  catch{return false;}
 }),values,{timeout:timeoutMs,polling:500}).catch(()=>{});
}

export async function inspectProductPage(page:Page,selectors:Record<string,string>):Promise<ProductPageProbe>{
 const entries=SELECTOR_KEYS.map(key=>[key,typeof selectors[key]==='string'?selectors[key].trim():''] as [string,string]);
 return page.evaluate(({entries,productKeys})=>{
  const fields:Record<string,SelectorProbe>={};
  for(const [key,selector] of entries){
   if(!selector){
    fields[key]={configured:false,matched:0,nonEmpty:0,invalid:false};
    continue;
   }
   try{
    const nodes=Array.from(document.querySelectorAll(selector));
    fields[key]={
     configured:true,
     matched:nodes.length,
     nonEmpty:nodes.filter(node=>Boolean(node.textContent?.trim())).length,
     invalid:false
    };
   }catch{
    fields[key]={configured:true,matched:0,nonEmpty:0,invalid:true};
   }
  }
  const bodyText=document.body?.innerText||'';
  const bodyCharacters=bodyText.length;
  const productFields=productKeys.filter(key=>(fields[key]?.nonEmpty||0)>0).length;
  const matchedFields=productKeys.filter(key=>(fields[key]?.matched||0)>0).length;
  return {
   readyState:document.readyState,
   bodyCharacters,
   productFields,
   matchedFields,
   configuredSelectors:entries.filter(([,selector])=>Boolean(selector)).length,
   invalidSelectors:entries.filter(([key])=>fields[key]?.invalid).map(([key])=>key),
   challenge:/请完成安全验证|请先完成验证|人机验证|滑块验证|验证码验证|访问过于频繁|检测到异常访问|操作过于频繁|访问受限|security verification|unusual traffic|captcha challenge|verify you are human|access denied|请登录后查看/i.test(bodyText.slice(0,12000)),
   fields
  };
 },{entries,productKeys:[...PRODUCT_FIELD_KEYS]});
}

/** Heuristic classification only; it does not assert what the remote page means. */
export function classifyPageProbe(probe:ProductPageProbe,blockedSubresources:number):PageFailureReason{
 if(probe.challenge)return 'verification_required';
 if(probe.invalidSelectors.length)return 'invalid_selectors';
 if(probe.bodyCharacters<80)return blockedSubresources>0?'resources_blocked':'page_not_rendered';
 if(probe.matchedFields===0)return 'selectors_not_matched';
 return 'fields_empty';
}

/** A bounded allowlist of structural metadata; no page content or selector values are logged. */
export function summarizePageProbe(
 probe:ProductPageProbe,
 httpStatus:number|null,
 blockedSubresources:number,
 reason:PageFailureReason|'challenge_url'
):string{
 const ready=['loading','interactive','complete'].includes(probe.readyState)?probe.readyState:'unknown';
 const status=httpStatus===null?'none':String(httpStatus);
 const invalid=probe.invalidSelectors.length?probe.invalidSelectors.join(','):'none';
 const hits=SELECTOR_KEYS.map(key=>{
  const field=probe.fields[key];
  return key+':'+(field?.matched||0)+'/'+(field?.nonEmpty||0)+(field?.invalid?'!':'');
 }).join(',');
 return ('reason='+reason+';http='+status+';dom='+ready+
  ';bodyChars='+probe.bodyCharacters+';fields='+probe.productFields+
  ';matched='+probe.matchedFields+';invalid='+invalid+
  ';hits='+hits+';blockedSubresources='+blockedSubresources).slice(0,320);
}
