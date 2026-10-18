import {chromium,type Browser} from 'playwright';
import {assertPublicWebUrl} from '../core/urls';
import {parsePrice,parseSales} from '../core/metrics';
import {parseShopRating,parseShopStats} from '../core/shop-metrics';
import {XHS_GOODS_SELECTORS} from '../core/source-selectors';

export type ObservationData={
 title:string|null;shop:string|null;sales:ReturnType<typeof parseSales>;price:ReturnType<typeof parsePrice>;
 shopRating:ReturnType<typeof parseShopRating>;
 shopSales:ReturnType<typeof parseSales>;shopFollowers:ReturnType<typeof parseSales>;
};
export class CollectError extends Error {
 constructor(public code:string, public transient=false,public status:number|null=null){super(code);}
}
let browser:Browser|null=null;
export async function closeBrowser(){if(browser){await browser.close().catch(()=>{});browser=null;}}
export async function collectAllowedBrowserPage(url:string,selectorsRaw:string,hostsRaw:string):Promise<ObservationData>{
 const hosts=JSON.parse(hostsRaw) as string[];
 const sel=JSON.parse(selectorsRaw) as Record<string,string>;
 if(!Array.isArray(hosts)||!hosts.length||!sel.sales||!sel.title)
   throw new CollectError('SOURCE_SELECTOR_NOT_CONFIGURED');
 try{await assertPublicWebUrl(url,hosts);}catch{throw new CollectError('HOST_NOT_ALLOWED');}
 if(!browser||!browser.isConnected()){
   browser=await chromium.launch({headless:true,timeout:30000});
 }
 const context=await browser.newContext({acceptDownloads:false,javaScriptEnabled:true,serviceWorkers:'block'});
 try{
  // Browsing is permitted only on explicitly configured source hosts.
  await context.route('**/*',async route=>{
    const raw=route.request().url();
    if(raw.startsWith('data:')||raw.startsWith('blob:'))return route.continue();
    try {await assertPublicWebUrl(raw,hosts);await route.continue();}
    catch {await route.abort('blockedbyclient');}
  });
  const page=await context.newPage();
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  const status=response?.status()??null;
  if(status===403||status===401||status===429)throw new CollectError('ACCESS_BLOCKED',false,status);
  if(status && status>=500)throw new CollectError('REMOTE_5XX',true,status);
  if(status===404)throw new CollectError('PRODUCT_UNAVAILABLE');
  if(/login|captcha|verify/i.test(page.url()))throw new CollectError('VERIFICATION_REQUIRED');
  await assertPublicWebUrl(page.url(),hosts);
  const take=async(key:string)=>{
    if(!sel[key])return null;
    return page.locator(sel[key]).first().textContent({timeout:8000}).then(x=>x?.trim()||null).catch(()=>null);
  };
  const title=await take('title');
  const salesRaw=await take('sales');
  const priceRaw=await take('price');
  const shop=await take('shop');
  // Shop sales and followers are identified by label; never mix them with item sales.
  // Fallback supports old custom source selector JSON without shop keys.
  const shopStatsLocator=page.locator(sel.shopStats||XHS_GOODS_SELECTORS.shopStats);
  await shopStatsLocator.first().waitFor({state:'attached',timeout:5000}).catch(()=>{});
  const shopStatLabels=await shopStatsLocator.allTextContents().catch(()=>[]);
  const ratingText=await page.locator(sel.shopRating||XHS_GOODS_SELECTORS.shopRating)
    .first().textContent({timeout:5000}).catch(()=>null);
  const shopMetrics=parseShopStats(shopStatLabels);
  if(!title&&!salesRaw&&!priceRaw&&!shop&&!shopMetrics.shopSales.raw&&!shopMetrics.shopFollowers.raw)
    throw new CollectError('PARSER_NO_FIELDS');
  return {title,shop,sales:parseSales(salesRaw),price:parsePrice(priceRaw),
    shopRating:parseShopRating(ratingText),...shopMetrics};
 }catch(e){
  if(e instanceof CollectError)throw e;
  if(String(e).includes('Timeout'))throw new CollectError('TIMEOUT',true);
  if(String(e).includes('Target closed')){await closeBrowser();throw new CollectError('BROWSER_CLOSED',true);}
  throw new CollectError('COLLECTOR_ERROR',false);
 }finally{await context.close().catch(()=>{});}
}
