import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSales,parsePrice,compareSales} from '../packages/core/metrics';
import {normalizedProductUrl,parseXhsGoodsUrl,safeHostname} from '../packages/core/urls';
import {XHS_GOODS_SELECTORS} from '../packages/core/source-selectors';
import {parseShopRating,parseShopFollowers,parseShopStats} from '../packages/core/shop-metrics';
test('exact zero is not missing', () => assert.deepEqual(parseSales('已售 0'),{raw:'已售 0',value:0,precision:'exact'}));
test('lower-bound display not exact', () => assert.deepEqual(parseSales('已售 1.2万+'),{raw:'已售 1.2万+',value:12000,precision:'lower_bound'}));
test('missing sales is null', () => assert.equal(parseSales(undefined).value,null));
test('currency uses cents', () => assert.equal(parsePrice('¥19.90').cents,1990));
test('starting price flagged', () => assert.equal(parsePrice('¥9.9起').kind,'starting_from'));
test('lower-bound change no exact delta', () => assert.deepEqual(compareSales(
 {value:12000,precision:'lower_bound',scope:'cumulative',sourceId:'s'},
 {value:13000,precision:'lower_bound',scope:'cumulative',sourceId:'s'}),{kind:'threshold_changed',delta:null}));
test('cross source values incomparable', () => assert.equal(compareSales(
 {value:1,precision:'exact',scope:'cumulative',sourceId:'a'},
 {value:2,precision:'exact',scope:'cumulative',sourceId:'b'}).kind,'not_comparable'));
test('reject SSRF host and non XHS', () => {
 assert.throws(()=>normalizedProductUrl('http://127.0.0.1/'),/INVALID_URL/);
 assert.throws(()=>normalizedProductUrl('https://evil.com/item'),/UNSUPPORTED_HOST/);
 assert.equal(safeHostname('localhost',['localhost']),false);
 assert.equal(safeHostname('evilxiaohongshu.com',['xiaohongshu.com']),false);
});

test('XHS goods share: redact xsec_token, instation_link and share metadata',()=>{
 const long='https://www.xiaohongshu.com/goods-detail/6a290d7c3222c60001e051bf?xsec_token=PRIVATE_SHARE_TOKEN&xsec_source=app_share&instation_link=xhsdiscover%3A%2F%2Fgoods_detail%2F6a290d7c3222c60001e051bf%3FitemId%3D6a290d7c3222c60001e051be&share_id=TRACKING_ID&share_channel=wechat';
 const parsed=parseXhsGoodsUrl(long);
 assert.equal(parsed.productId,'6a290d7c3222c60001e051bf');
 assert.equal(parsed.canonicalUrl,'https://www.xiaohongshu.com/goods-detail/6a290d7c3222c60001e051bf');
 assert.equal(normalizedProductUrl(long),parsed.canonicalUrl);
 assert.ok(!parsed.canonicalUrl.includes('PRIVATE_SHARE_TOKEN'));
 assert.ok(!parsed.canonicalUrl.includes('instation_link'));
 assert.ok(!parsed.canonicalUrl.includes('6a290d7c3222c60001e051be'));
 assert.equal(normalizedProductUrl('https://m.xiaohongshu.com/goods-detail/6A290D7C3222C60001E051BF/'),parsed.canonicalUrl);
});
test('reject note link, malformed product IDs, and untrusted hosts',()=>{
 assert.throws(()=>normalizedProductUrl('https://www.xiaohongshu.com/explore/abc123'),/UNSUPPORTED_PRODUCT_URL/);
 assert.throws(()=>normalizedProductUrl('https://www.xiaohongshu.com/goods-detail/xyz'),/UNSUPPORTED_PRODUCT_URL/);
 assert.throws(()=>normalizedProductUrl('https://xiaohongshu.com.evil.example/goods-detail/6a290d7c3222c60001e051bf'),/UNSUPPORTED_HOST/);
});

test('goods-detail snapshot: product-level sales, current price and selectors', () => {
 assert.deepEqual(parseSales('已售431'),{raw:'已售431',value:431,precision:'exact'});
 assert.equal(parsePrice('¥19.9').cents,1990);
 assert.equal(parsePrice('¥39').cents,3900);
 assert.equal(XHS_GOODS_SELECTORS.sales,'.price-container .spu-text');
 assert.equal(XHS_GOODS_SELECTORS.price,'.price-container .price');
 assert.equal(XHS_GOODS_SELECTORS.title,'.goods-name');
 assert.equal(XHS_GOODS_SELECTORS.shop,'.seller-container .seller-name');
});

test('seller stats are distinct from product sales and are not made-up zero',()=>{
 assert.deepEqual(parseShopRating('4.32'),{raw:'4.32',hundredths:432});
 assert.equal(parseShopRating(undefined).hundredths,null);
 assert.equal(parseShopRating('4.321').hundredths,null);
 assert.deepEqual(parseShopFollowers('粉丝数 1261'),{raw:'粉丝数 1261',value:1261,precision:'exact'});
 const stats=parseShopStats(['卖家口碑','粉丝数 1261','已售426']);
 assert.deepEqual(stats.shopSales,{raw:'已售426',value:426,precision:'exact'});
 assert.equal(stats.shopFollowers.value,1261);
 assert.equal(parseSales('已售431').value,431);
 const empty=parseShopStats(['卖家口碑']);
 assert.equal(empty.shopSales.value,null);
 assert.equal(empty.shopFollowers.value,null);
 assert.equal(XHS_GOODS_SELECTORS.shopStats,'.seller-container .name-info .sub-title');
 assert.equal(XHS_GOODS_SELECTORS.shopRating,'.seller-container .score-text');
});
