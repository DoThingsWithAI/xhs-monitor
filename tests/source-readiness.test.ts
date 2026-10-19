import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceBlockingReason,type SourceReadiness} from '../packages/core/source-readiness';

const base:SourceReadiness={
 enabled:1,automated_access_allowed:1,storage_allowed:1,analysis_allowed:1,
 permission_basis:'Real documented permission for authorized collection',
 permission_expires_at:null,
 selectors_json:JSON.stringify({title:'.goods-name',sales:'.price-container .spu-text'})
};
test('disabled sources explain waiting without toggling any permission',()=>{
 assert.match(sourceBlockingReason({...base,enabled:0})||'',/未启用/);
 assert.equal(sourceBlockingReason({...base,automated_access_allowed:0})?.includes('允许自动访问'),true);
 assert.match(sourceBlockingReason({...base,permission_basis:''})||'',/授权依据/);
 assert.match(sourceBlockingReason({...base,permission_expires_at:1})||'',/已过期/);
 assert.match(sourceBlockingReason({...base,selectors_json:'not json'})||'',/无法解析/);
 assert.match(sourceBlockingReason({...base,selectors_json:'{}'})||'',/选择器/);
 assert.equal(sourceBlockingReason(base),null);
 assert.equal(base.enabled,1);
});
