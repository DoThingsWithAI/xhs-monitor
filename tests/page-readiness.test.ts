import test from 'node:test';
import assert from 'node:assert/strict';
import {
 classifyPageProbe,
 looksLikeAccessChallenge,
 summarizePageProbe,
 type ProductPageProbe,
 type SelectorProbe
} from '../packages/collectors/page-readiness';

const emptyField=():SelectorProbe=>({configured:true,matched:0,nonEmpty:0,invalid:false});
function makeProbe(overrides:Partial<ProductPageProbe>={}):ProductPageProbe{
 return {
  readyState:'complete',
  bodyCharacters:500,
  productFields:0,
  matchedFields:0,
  configuredSelectors:6,
  invalidSelectors:[],
  challenge:false,
  fields:{
   title:emptyField(),
   sales:emptyField(),
   price:emptyField(),
   shop:emptyField(),
   shopStats:emptyField(),
   shopRating:emptyField()
  },
  ...overrides
 };
}

test('challenge signals are classified instead of generic empty fields',()=>{
 assert.equal(looksLikeAccessChallenge('请完成安全验证'),true);
 assert.equal(looksLikeAccessChallenge('Security verification required'),true);
 assert.equal(looksLikeAccessChallenge('已售431'),false);
 assert.equal(looksLikeAccessChallenge('登录可享受优惠 商品已售431'),false);
 assert.equal(classifyPageProbe(makeProbe({challenge:true}),0),'verification_required');
});

test('empty, unblocked documents are retryable but selector drift is not',()=>{
 assert.equal(classifyPageProbe(makeProbe({bodyCharacters:20}),0),'page_not_rendered');
 assert.equal(classifyPageProbe(makeProbe({bodyCharacters:20}),4),'resources_blocked');
 assert.equal(classifyPageProbe(makeProbe({bodyCharacters:500}),0),'selectors_not_matched');
});

test('invalid selectors and matched-but-empty fields have distinct diagnoses',()=>{
 assert.equal(classifyPageProbe(makeProbe({invalidSelectors:['sales']}),0),'invalid_selectors');
 assert.equal(classifyPageProbe(makeProbe({
  matchedFields:1,
  fields:{...makeProbe().fields,title:{configured:true,matched:1,nonEmpty:0,invalid:false}}
 }),0),'fields_empty');
});

test('diagnostics contain only bounded metadata, never page text, URLs or CSS selectors',()=>{
 const probe=makeProbe({
  bodyCharacters:150,
  fields:{
   title:{configured:true,matched:0,nonEmpty:0,invalid:false},
   sales:{configured:true,matched:0,nonEmpty:0,invalid:false},
   price:{configured:true,matched:0,nonEmpty:0,invalid:false},
   shop:{configured:true,matched:0,nonEmpty:0,invalid:false},
   shopStats:{configured:true,matched:0,nonEmpty:0,invalid:false},
   shopRating:{configured:true,matched:1,nonEmpty:1,invalid:false}
  },
  matchedFields:0
 });
 const diagnostic=summarizePageProbe(probe,200,3,'selectors_not_matched');
 assert.match(diagnostic,/reason=selectors_not_matched;http=200;dom=complete/);
 assert.match(diagnostic,/bodyChars=150;fields=0;matched=0/);
 assert.match(diagnostic,/hits=title:0\/0,sales:0\/0/);
 assert.match(diagnostic,/blockedSubresources=3$/);
 assert.doesNotMatch(diagnostic,/goods-name|xiaohongshu\.com|已售/);
 assert.ok(diagnostic.length<=320);
});
