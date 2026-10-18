import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSales,parsePrice,compareSales} from '../packages/core/metrics';
import {normalizedProductUrl,safeHostname} from '../packages/core/urls';
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
