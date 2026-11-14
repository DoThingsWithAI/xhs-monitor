import test from 'node:test';
import assert from 'node:assert/strict';
import {sortProductsByValue} from '../packages/core/product-ranking';

type Row={id:string;hot_score:{productValueCents:number|null;rate:number|null;todaySales:number|null}|null};
const row=(id:string,value:number|null,rate:number|null,increment:number|null):Row=>({
 id,hot_score:{productValueCents:value,rate,todaySales:increment}
});
test('default ranking sorts value, then hot rate, then daily sales in descending order',()=>{
 const input=[
  row('same-all-old',1000,0.1,30),
  row('low',500,0.9,100),
  row('value-high',2000,0.01,1),
  row('rate-high',1000,0.2,3),
  row('increment-high',1000,0.1,40),
  row('same-all-new',1000,0.1,30)
 ];
 assert.deepEqual(sortProductsByValue(input).map(p=>p.id),
  ['value-high','rate-high','increment-high','same-all-old','same-all-new','low']);
 // Sorting does not mutate a caller's array (used by state handlers).
 assert.equal(input[0].id,'same-all-old');
});

test('null values come last, zero and negative values remain real sortable numbers',()=>{
 const input=[
  row('missing-all',null,null,null),
  row('negative',-20,-0.2,10),
  row('missing-price',null,0.4,12),
  row('zero',0,0,0),
  row('missing-rate',null,null,30),
  row('nonfinite',Number.NaN,Number.NaN,Number.NaN),
  row('positive',100,0.1,2),
  row('lower-rate',null,-0.3,3)
 ];
 assert.deepEqual(sortProductsByValue(input).map(p=>p.id),
  ['positive','zero','negative','missing-price','lower-rate','missing-rate','missing-all','nonfinite']);
});

test('third tie breaker uses the increment when product value and hot rate match',()=>{
 const rows=[row('sale-5',500,0.1,5),row('sale-12',500,0.1,12),row('sale-0',500,0.1,0)];
 assert.deepEqual(sortProductsByValue(rows).map(p=>p.id),['sale-12','sale-5','sale-0']);
});
