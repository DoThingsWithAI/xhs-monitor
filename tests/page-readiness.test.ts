import test from 'node:test';
import assert from 'node:assert/strict';
import {looksLikeAccessChallenge,summarizePageProbe} from '../packages/collectors/page-readiness';

test('challenge signals are classified instead of generic empty fields',()=>{
 assert.equal(looksLikeAccessChallenge('请完成安全验证'),true);
 assert.equal(looksLikeAccessChallenge('Security verification required'),true);
 assert.equal(looksLikeAccessChallenge('已售431'),false);
 assert.equal(looksLikeAccessChallenge('登录可享受优惠 商品已售431'),false);
});
test('diagnostics contain metadata only, never raw pages or URLs',()=>{
 assert.equal(summarizePageProbe({readyState:'complete',bodyCharacters:150,productFields:0,challenge:false},200,3),
 'http=200;dom=complete;bodyChars=150;fields=0;blockedSubresources=3');
});
