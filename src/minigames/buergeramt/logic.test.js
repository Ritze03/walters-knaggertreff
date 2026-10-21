import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { makeTurns, judge, windowMs, gapMs, scoreOf, speedBonus } from './logic.js';

test('buergeramt: the turn list depends only on the seed, not on access order', () => {
  const a = makeTurns(createRng(7)), b = makeTurns(createRng(7));
  const fwd = Array.from({ length: 40 }, (_, i) => a.at(i));
  b.at(39);
  assert.deepEqual(fwd, Array.from({ length: 40 }, (_, i) => b.at(i)));
  const other = makeTurns(createRng(8));
  assert.notDeepEqual(fwd, Array.from({ length: 40 }, (_, i) => other.at(i)));
});

test('buergeramt: rules - Bitte means obey, no Bitte means nothing, decoys differ from the spoken word', () => {
  let traps = 0, decoys = 0;
  for (let s = 1; s <= 30; s++) {
    const t = makeTurns(createRng(s));
    let run = 0;
    for (let i = 0; i < 40; i++) {
      const x = t.at(i);
      assert.equal(x.expect, x.polite ? x.cmd : -1);
      if (x.polite) assert.equal(x.opener, 'Bitte'); else assert.notEqual(x.opener, 'Bitte');
      assert.ok(x.sign >= 0 && x.sign <= 3);
      if (x.expect < 0) { traps++; run++; assert.ok(run <= 2); } else run = 0;
      if (x.cmd >= 0 && x.sign !== x.cmd) decoys++;
      if (i < 2) assert.ok(x.expect >= 0, 'first turns are real orders');
    }
  }
  assert.ok(traps > 100 && traps < 500, `traps ${traps}`);
  assert.ok(decoys > 100, `decoys ${decoys}`);
});

test('buergeramt: judge, tempo and score', () => {
  const real = { expect: 2 }, trap = { expect: -1 };
  assert.equal(judge(real, 2), 'ok');
  assert.equal(judge(real, 1), 'wrong');
  assert.equal(judge(real, -1), 'late');
  assert.equal(judge(trap, -1), 'safe');
  assert.equal(judge(trap, 0), 'wrong');
  assert.ok(windowMs(0) > windowMs(10) && windowMs(10) > windowMs(17) && windowMs(100) === 850);
  assert.ok(gapMs(0) > gapMs(10) && gapMs(100) === 240);
  assert.ok(scoreOf(12, 900) < scoreOf(13, 0) && scoreOf(12, 5) > scoreOf(12, 4));
  assert.equal(speedBonus(0, 1000), 20);
  assert.equal(speedBonus(1000, 1000), 0);
});
