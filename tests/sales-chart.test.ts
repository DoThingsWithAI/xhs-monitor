import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSalesChart} from '../packages/core/sales-chart';
test('chart renders zero, one, and no valid observations without fabricated points',()=>{
 assert.deepEqual(buildSalesChart([]),{coords:[],min:0,max:0});
 const one=buildSalesChart([{t:10,sales:0}]);
 assert.deepEqual(one,{coords:[{x:343,y:81}],min:0,max:0});
 const flat=buildSalesChart([{t:10,sales:431},{t:20,sales:431}]);
 assert.deepEqual(flat.coords,[{x:60,y:81},{x:626,y:81}]);
});
test('chart plots true time intervals and respects min/max labels',()=>{
 const chart=buildSalesChart([{t:100,sales:100},{t:110,sales:200},{t:200,sales:300}]);
 assert.deepEqual(chart.coords,[{x:60,y:137},{x:117,y:81},{x:626,y:25}]);
 assert.equal(chart.min,100);
 assert.equal(chart.max,300);
});
test('duplicate timestamps are placed safely and do not produce NaN',()=>{
 const chart=buildSalesChart([{t:5,sales:1},{t:5,sales:2}]);
 assert.deepEqual(chart.coords,[{x:60,y:137},{x:626,y:25}]);
});
