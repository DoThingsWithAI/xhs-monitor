import test from 'node:test';
import assert from 'node:assert/strict';
import {sortProducts,sortProductsByValue} from '../packages/core/product-ranking';

type Row={id:string;hot_score:{productValueCents:number|null;rate:number|null;todaySales:number|null}|null;price_minor?:number|null;observed_at?:number|null;last_success_at?:number|null;trend_points?:{t:number;sales:number}[]};
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


test('selected daily-sales sort uses the selected metric first and default ranking for ties',()=>{
 const rows=[
  {...row('sales-5',1000,0.1,5),trend_points:[{t:1,sales:150}]},
  {...row('sales-12-low-value',500,0.9,12),trend_points:[{t:2,sales:180}]},
  {...row('sales-12-high-value',900,0.2,12),trend_points:[{t:3,sales:170}]},
  {...row('sales-missing',null,null,null),trend_points:[]}
 ];
 assert.deepEqual(sortProducts(rows,'todaySales').map(p=>p.id),['sales-12-high-value','sales-12-low-value','sales-5','sales-missing']);
});

test('total sales, price and collection time can be selected independently',()=>{
 const rows=[
  {...row('older-high-sales',100,0.1,1),price_minor:300,observed_at:100,trend_points:[{t:100,sales:250}]},
  {...row('newer-low-sales',200,0.2,2),price_minor:100,observed_at:300,trend_points:[{t:300,sales:150}]},
  {...row('missing',null,null,null),price_minor:null,observed_at:null,trend_points:[]}
 ];
 assert.deepEqual(sortProducts(rows,'totalSales').map(p=>p.id),['older-high-sales','newer-low-sales','missing']);
 assert.deepEqual(sortProducts(rows,'price').map(p=>p.id),['older-high-sales','newer-low-sales','missing']);
 assert.deepEqual(sortProducts(rows,'lastCollected').map(p=>p.id),['newer-low-sales','older-high-sales','missing']);
});

test('recommended selection preserves the existing three-level default ranking',()=>{
 const rows=[row('value-1',100,0.1,5),row('value-2',200,0.01,1),row('rate-1',100,0.2,1)];
 assert.deepEqual(sortProducts(rows,'recommended').map(p=>p.id),sortProductsByValue(rows).map(p=>p.id));
});
