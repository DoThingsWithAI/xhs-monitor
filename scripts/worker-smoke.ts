import {chromium} from 'playwright';
import {XHS_GOODS_SELECTORS} from '../packages/core/source-selectors';
import {parseSales,parsePrice} from '../packages/core/metrics';
async function main(){
 const browser=await chromium.launch({headless:true,timeout:30000});
 try{
  const page=await browser.newPage();
  await page.goto('about:blank');
  if(await page.title()!=='')throw new Error('Unexpected smoke page title');
  console.log('Chromium sandbox smoke check: OK');
  // Synthetic minimal fixture based only on the field fragments supplied by the user.
  // Deliberately place seller's "已售426" near product's "已售431" to catch bad locators.
  await page.setContent(`<section class="seller"><p class="seller-name">辰星提效社的店</p><span class="sub-title">已售426</span></section>
    <div class="goods-name">快采采 | 智能表格模板</div>
    <div class="price-container"><div class="price"><span>¥</span><p><span>19</span><span class="priceDecimalPart_price2">.9</span></p></div>
    <span class="del-price">¥39</span><span class="spu-text">已售431</span></div>`);
  const text=async (selector:string)=>page.locator(selector).first().textContent();
  const sales=parseSales(await text(XHS_GOODS_SELECTORS.sales));
  const price=parsePrice(await text(XHS_GOODS_SELECTORS.price));
  const title=await text(XHS_GOODS_SELECTORS.title);
  const shop=await text(XHS_GOODS_SELECTORS.shop);
  if(sales.value!==431 || sales.precision!=='exact' || price.cents!==1990 ||
     !title?.includes('快采采') || shop!=='辰星提效社的店')
    throw new Error('Goods DOM field smoke check failed');
  console.log('Goods DOM smoke check: selectors matched correct sales=431 and price=1990 cents.');
 }finally{await browser.close();}
}
main().catch(e=>{console.error('Chromium smoke check FAILED:',e instanceof Error?e.message:String(e));process.exitCode=1;});
