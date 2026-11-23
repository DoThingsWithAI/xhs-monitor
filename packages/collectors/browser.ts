import {chromium,type Browser,type Page} from 'playwright';
import {assertPublicWebUrl} from '../core/urls';
import {selectProductImageUrls,type ProductImageCandidate} from '../core/product-images';
import {parsePrice,parseSales} from '../core/metrics';
import {parseShopRating,parseShopStats} from '../core/shop-metrics';
import {XHS_GOODS_SELECTORS} from '../core/source-selectors';
import {classifyPageProbe,inspectProductPage,summarizePageProbe,waitForProductFields} from './page-readiness';

export type ObservationData={
 title:string|null;shop:string|null;sales:ReturnType<typeof parseSales>;price:ReturnType<typeof parsePrice>;
 shopRating:ReturnType<typeof parseShopRating>;
 shopSales:ReturnType<typeof parseSales>;shopFollowers:ReturnType<typeof parseSales>;
 imageUrls?:string[];
};
export class CollectError extends Error {
 constructor(public code:string, public transient=false,public status:number|null=null,public diagnostic:string|null=null){super(code);}
}
let browser:Browser|null=null;
let activeContexts=0;
let lastBrowserActivityAt=0;
export async function closeBrowser(){
 if(browser){await browser.close().catch(()=>{});browser=null;}
 lastBrowserActivityAt=0;
}
/** Pure idle guard so the five-minute close policy is independently testable. */
export function browserIdleCloseDue(lastActivityAt:number,now:number,activeContextCount:number,idleMs=5*60_000):boolean{
 return activeContextCount===0&&lastActivityAt>0&&now-lastActivityAt>=idleMs;
}
/** Close Chromium only when no page context is active and the browser has been idle long enough. */
export async function closeBrowserIfIdle(now=Date.now(),idleMs=5*60_000):Promise<boolean>{
 if(!browser||!browserIdleCloseDue(lastBrowserActivityAt,now,activeContexts,idleMs))return false;
 await closeBrowser();
 return true;
}

/** Read only large image URLs already present in the permitted product-page DOM. */
async function collectProductImageUrls(page:Page):Promise<string[]>{
 const candidates=await page.locator('img').evaluateAll(images=>images.map(image=>{
  const img=image as HTMLImageElement;
  const rect=img.getBoundingClientRect();
  const srcset=(img.getAttribute('srcset')||'').split(',')
   .map(item=>item.trim().split(/\s+/)[0]).filter(Boolean);
  return {
   urls:[img.currentSrc,img.getAttribute('src')||'',img.getAttribute('data-src')||'',
    img.getAttribute('data-original')||'',img.getAttribute('data-lazy-src')||'',...srcset]
    .filter((value):value is string=>typeof value==='string'&&value.length>0),
   naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,
   renderedWidth:rect.width,renderedHeight:rect.height
  };
 })) as ProductImageCandidate[];
 return selectProductImageUrls(candidates,page.url());
}

export async function collectAllowedBrowserPage(url:string,selectorsRaw:string,hostsRaw:string):Promise<ObservationData>{
 const hosts=JSON.parse(hostsRaw) as string[];
 const sel=JSON.parse(selectorsRaw) as Record<string,string>;
 if(!Array.isArray(hosts)||!hosts.length||!sel.sales||!sel.title)
   throw new CollectError('SOURCE_SELECTOR_NOT_CONFIGURED');
 try{await assertPublicWebUrl(url,hosts);}catch{throw new CollectError('HOST_NOT_ALLOWED');}
 if(!browser||!browser.isConnected()){
   browser=await chromium.launch({headless:true,chromiumSandbox:true,timeout:30000});
 }
 lastBrowserActivityAt=Date.now();
 const context=await browser.newContext({acceptDownloads:false,javaScriptEnabled:true,serviceWorkers:'block'});
 activeContexts++;
 lastBrowserActivityAt=Date.now();
 try{
  // Browsing is permitted only on explicitly configured source hosts.
  let blockedSubresources=0;
  await context.route('**/*',async route=>{
    const raw=route.request().url();
    if(raw.startsWith('data:')||raw.startsWith('blob:'))return route.continue();
    try {await assertPublicWebUrl(raw,hosts);await route.continue();}
    catch {blockedSubresources++;await route.abort('blockedbyclient');}
  });
  const page=await context.newPage();
  // domcontentloaded can fire before client-side product fields exist.
  const effective={...sel,shopRating:sel.shopRating||XHS_GOODS_SELECTORS.shopRating,
   shopStats:sel.shopStats||XHS_GOODS_SELECTORS.shopStats};
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  const status=response?.status()??null;
  if(status===403||status===401||status===429)
    throw new CollectError('ACCESS_BLOCKED',false,status,'reason=http_restriction;http='+status);
  if(status && status>=500)
    throw new CollectError('REMOTE_5XX',true,status,'reason=upstream_server_error;http='+status);
  if(status===404)
    throw new CollectError('PRODUCT_UNAVAILABLE',false,status,'reason=product_not_found;http=404');
  await assertPublicWebUrl(page.url(),hosts);
  if(/login|captcha|verify/i.test(page.url())){
    const probe=await inspectProductPage(page,effective);
    throw new CollectError('VERIFICATION_REQUIRED',false,status,
      summarizePageProbe(probe,status,blockedSubresources,'challenge_url'));
  }
  await waitForProductFields(page,effective,15000);
  const pageProbe=await inspectProductPage(page,effective);
  if(pageProbe.challenge)
    throw new CollectError('VERIFICATION_REQUIRED',false,status,
      summarizePageProbe(pageProbe,status,blockedSubresources,'verification_required'));
  const take=async(key:string)=>{
    if(!sel[key])return null;
    return page.locator(sel[key]).first().textContent({timeout:1200}).then(x=>x?.trim()||null).catch(()=>null);
  };
  const title=await take('title');
  const salesRaw=await take('sales');
  const priceRaw=await take('price');
  const shop=await take('shop');
  // Shop sales and followers are identified by label; never mix them with item sales.
  // Fallback supports old custom source selector JSON without shop keys.
  const shopStatsLocator=page.locator(sel.shopStats||XHS_GOODS_SELECTORS.shopStats);
  await shopStatsLocator.first().waitFor({state:'attached',timeout:1200}).catch(()=>{});
  const shopStatLabels=await shopStatsLocator.allTextContents().catch(()=>[]);
  const ratingText=await page.locator(sel.shopRating||XHS_GOODS_SELECTORS.shopRating)
    .first().textContent({timeout:1200}).catch(()=>null);
  const shopMetrics=parseShopStats(shopStatLabels);
  if(!title&&!salesRaw&&!priceRaw&&!shop&&!shopMetrics.shopSales.raw&&!shopMetrics.shopFollowers.raw){
    const reason=classifyPageProbe(pageProbe,blockedSubresources);
    const diagnostic=summarizePageProbe(pageProbe,status,blockedSubresources,reason);
    if(reason==='verification_required')
      throw new CollectError('VERIFICATION_REQUIRED',false,status,diagnostic);
    // Only a genuinely near-empty, unblocked document gets a bounded retry.
    // Selector drift, invalid CSS and blocked resources require diagnosis instead.
    throw new CollectError('PARSER_NO_FIELDS',reason==='page_not_rendered',status,diagnostic);
  }
  // Image discovery is best-effort and never changes the sales collection result.
  const imageUrls=await collectProductImageUrls(page).catch(()=>[]);
  return {title,shop,sales:parseSales(salesRaw),price:parsePrice(priceRaw),
    shopRating:parseShopRating(ratingText),...shopMetrics,imageUrls};
 }catch(e){
  if(e instanceof CollectError)throw e;
  if(String(e).includes('Timeout'))throw new CollectError('TIMEOUT',true);
  if(String(e).includes('Target closed')){await closeBrowser();throw new CollectError('BROWSER_CLOSED',true);}
  throw new CollectError('COLLECTOR_ERROR',false);
 }finally{
  await context.close().catch(()=>{});
  activeContexts=Math.max(0,activeContexts-1);
  if(browser)lastBrowserActivityAt=Date.now();
 }
}
