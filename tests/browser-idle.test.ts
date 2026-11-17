import test from 'node:test';
import assert from 'node:assert/strict';
import {browserIdleCloseDue} from '../packages/collectors/browser';

test('Chromium idle close waits five minutes and never closes with an active context',()=>{
 const lastActivity=1_000_000;
 assert.equal(browserIdleCloseDue(lastActivity,lastActivity+299_999,0),false);
 assert.equal(browserIdleCloseDue(lastActivity,lastActivity+300_000,0),true);
 assert.equal(browserIdleCloseDue(lastActivity,lastActivity+600_000,1),false);
 assert.equal(browserIdleCloseDue(0,lastActivity+600_000,0),false);
});
