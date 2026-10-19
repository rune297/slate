const assert = require('node:assert/strict');
const { test } = require('node:test');
const { threshold, releaseOpens, offsetFor } = require('../renderer/pull-gesture.js');
test('pull threshold stays reachable on compact windows and bounded on large displays', () => {
  assert.equal(threshold(300), 96);
  assert.equal(threshold(560), 145.6);
  assert.equal(threshold(1200), 160);
});
test('distance decides release, tapping opens, cancellation always closes', () => {
  assert.equal(releaseOpens(60, 560), false);
  assert.equal(releaseOpens(145, 560), false);
  assert.equal(releaseOpens(146, 560), true);
  assert.equal(releaseOpens(600, 560), true);
  assert.equal(releaseOpens(0, 560), true);
  assert.equal(releaseOpens(0, 560, false, true), false);
  assert.equal(releaseOpens(600, 560, true), false);
  assert.equal(releaseOpens(0, 560, true), false);
});
test('expanded grip mirrors the release threshold and cancellation restores the open state', () => {
  assert.equal(releaseOpens(60, 560, false, true, true), true);
  assert.equal(releaseOpens(180, 560, false, true, true), false);
  assert.equal(releaseOpens(180, 560, true, true, true), true);
  assert.equal(releaseOpens(0, 560, false, true, true), true);
  assert.equal(releaseOpens(0, 560, false, false, true), false);
});

test('overpull keeps the whole sheet moving with bounded resistance covered by its top surface', () => {
  for(const expanded of [false,true]){
    const full=expanded?0:560;
    assert.equal(offsetFor(full,560,expanded),0);
    const light=offsetFor(full+96,560,expanded),heavy=offsetFor(full+384,560,expanded);
    assert.ok(light>0&&heavy>light&&heavy<32);
    assert.ok(offsetFor(full+100000,560,expanded)<32);
  }
});
