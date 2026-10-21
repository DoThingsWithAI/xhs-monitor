import {chromium} from 'playwright';
import {XHS_GOODS_SELECTORS} from '../packages/core/source-selectors';
import {parseSales,parsePrice} from '../packages/core/metrics';
import {parseShopRating,parseShopStats} from '../packages/core/shop-metrics';
import {inspectProductPage,waitForProductFields} from '../packages/collectors/page-readiness';
async function main(){
 const browser=await chromium.launch({headless:true,timeout:30000});
 try{
  const page=await browser.newPage();
  await page.goto('about:blank');
  if(await page.title()!=='')throw new Error('Unexpected smoke page title');
  console.log('Chromium sandbox smoke check: OK');
  // Synthetic minimal fixture based only on the field fragments supplied by the user.
  // Deliberately place seller's "已售426" near product's "已售431" to catch bad locators.
  await page.setContent(`<section class="seller-container"><div class="name-info"><p class="seller-name">辰星提效社的店</p><span class="sub-title">卖家口碑</span><span class="score-text">4.32</span><span class="sub-title">粉丝数 1261</span><span class="sub-title">已售426</span></div></section>
    <div class="goods-name">快采采 | 智能表格模板</div>
    <div class="price-container"><div class="price"><span>¥</span><p><span>19</span><span class="priceDecimalPart_price2">.9</span></p></div>
    <span class="del-price">¥39</span><span class="spu-text">已售431</span></div>`);
  const text=async (selector:string)=>page.locator(selector).first().textContent();
  const sales=parseSales(await text(XHS_GOODS_SELECTORS.sales));
  const price=parsePrice(await text(XHS_GOODS_SELECTORS.price));
  const title=await text(XHS_GOODS_SELECTORS.title);
  const shop=await text(XHS_GOODS_SELECTORS.shop);
  const rating=parseShopRating(await text(XHS_GOODS_SELECTORS.shopRating));
  const shopStats=parseShopStats(await page.locator(XHS_GOODS_SELECTORS.shopStats).allTextContents());
  if(sales.value!==431 || sales.precision!=='exact' || price.cents!==1990 ||
     rating.hundredths!==432 || shopStats.shopSales.value!==426 || shopStats.shopFollowers.value!==1261 ||
     !title?.includes('快采采') || shop!=='辰星提效社的店')
    throw new Error('Goods DOM field smoke check failed');
  console.log('Goods DOM smoke check: product sold=431 price=1990 cents; seller rating=4.32 sold=426 followers=1261.');
  // Synthetic delayed client-side rendering regression check (no remote request).
  await page.setContent('<main id="app"></main>');
  await page.evaluate(()=>setTimeout(()=>{
   const app=document.getElementById('app');
   if(app)app.innerHTML='<h1 class="goods-name">Late rendered product</h1><span class="spu-text">已售7</span>';
  },200));
  await waitForProductFields(page,XHS_GOODS_SELECTORS,3000);
  const probe=await inspectProductPage(page,XHS_GOODS_SELECTORS);
  if(probe.productFields!==1 || probe.challenge)throw new Error('Delayed product hydration was not detected');
  console.log('Delayed client-side product rendering smoke check: OK');
 }finally{await browser.close();}
}
main().catch(e=>{console.error('Chromium smoke check FAILED:',e instanceof Error?e.message:String(e));process.exitCode=1;});
