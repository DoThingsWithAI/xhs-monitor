import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSourceForm} from '../packages/core/source-form-validation';

const complete={
 enabled:true,automated_access_allowed:true,storage_allowed:true,analysis_allowed:true,
 permission_basis:'Documented provider authorization scope and validity',
 titleSelector:'.goods-name',salesSelector:'.price-container .spu-text'
};
test('short 6-character "已经核实许可" is not silently accepted',()=>{
 const issues=validateSourceForm({...complete,permission_basis:'已经核实许可'});
 assert.equal(issues.length,1);
 assert.match(issues[0],/12 个字符/);
});
test('disabled drafts are allowed; enabling requires actual selected fields',()=>{
 assert.deepEqual(validateSourceForm({...complete,enabled:false,permission_basis:'',titleSelector:''}),[]);
 assert.deepEqual(validateSourceForm(complete),[]);
 const issues=validateSourceForm({...complete,storage_allowed:false,titleSelector:''});
 assert.ok(issues.some(x=>x.includes('存储')));
 assert.ok(issues.some(x=>x.includes('标题')));
});
