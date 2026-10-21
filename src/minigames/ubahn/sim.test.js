import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { makeTrack, createRun, step, advance, score, lookahead, KINDS, baseSpeed, DURATION_MS } from './sim.js';
import { createBot } from './bot.js';

const track = (seed = 1) => makeTrack(createRng(seed));

test('same seed = same track, different seed = different track', () => {
  assert.deepEqual(track(7), track(7));
  assert.notDeepEqual(track(7).obstacles, track(8).obstacles);
});

test('track: sorted, long enough, every row leaves a way through, only known kinds', () => {
  for (const seed of [1, 2, 3, 99, 12345]) {
    const t = track(seed);
    assert.ok(t.obstacles.length > 30 && t.bottles.length > 60);
    assert.ok(t.obstacles.every((o, i) => i === 0 || t.obstacles[i - 1].d <= o.d));
    assert.ok(t.obstacles.every((o) => KINDS[o.type] && o.lane >= 0 && o.lane <= 2));
    // never all three lanes blocked at the same distance by something that is neither jumpable nor duckable (trains, controllers, pillars)
    for (const o of t.obstacles) {
      const same = t.obstacles.filter((p) => p.d < o.d + o.len && p.d + p.len > o.d);
      const hard = new Set(same.filter((p) => !KINDS[p.type].jump && !KINDS[p.type].slide).map((p) => p.lane));
      assert.ok(hard.size <= 2, `seed ${seed}: lanes all blocked near ${o.d.toFixed(0)} m`);
    }
  }
});

test('running straight into a pillar stumbles, slows down and the pillar only hits once', () => {
  const t = { obstacles: [{ id: 0, type: 'pillar', lane: 1, d: 30, len: KINDS.pillar.len }], bottles: [], length: 100 };
  const st = createRun(t);
  let hits = 0, minSpeed = Infinity;
  for (let i = 0; i < 60 * 6; i++) { const ev = step(st, 1 / 60); hits += ev.filter((e) => e.k === 'hit').length; if (st.stumble > 0) minSpeed = Math.min(minSpeed, st.speed); }
  assert.equal(hits, 1);
  assert.ok(minSpeed < baseSpeed(st.te) * 0.4);
  assert.equal(st.stumble, 0);
});

test('lane change dodges, jump clears a scooter, slide passes a gate, a train cannot be jumped', () => {
  const mk = (type, d = 20) => ({ obstacles: [{ id: 0, type, lane: 1, d, len: KINDS[type].len }], bottles: [], length: 100 });
  const run = (t, plan) => {
    const st = createRun(t); let hits = 0;
    for (let i = 0; i < 60 * 4; i++) { const ev = step(st, 1 / 60, plan(st)); hits += ev.filter((e) => e.k === 'hit').length; }
    return hits;
  };
  assert.equal(run(mk('controller'), (st) => (st.dist > 10 && st.lane === 1 ? { dx: 1 } : {})), 0);
  const jumpAt = (gap) => (st) => (st.dist > 20 - gap && st.dist < 20 - gap + 0.5 && st.y === 0 ? { jump: true } : {});
  assert.equal(run(mk('scooter'), jumpAt(5)), 0);
  assert.equal(run(mk('scooter'), () => ({})), 1);
  assert.equal(run(mk('gate'), (st) => (st.dist > 14 && st.dist < 15 ? { slide: true } : {})), 0);
  assert.equal(run(mk('gate'), jumpAt(5)), 1);
  assert.equal(run(mk('train'), jumpAt(5)), 1);
});

test('bottles add the bonus to the score', () => {
  const t = { obstacles: [], bottles: [{ id: 0, lane: 1, d: 10, y: 0.9 }, { id: 1, lane: 0, d: 12, y: 0.9 }], length: 100 };
  const st = createRun(t);
  for (let i = 0; i < 60 * 2; i++) step(st, 1 / 60);
  assert.equal(st.bottles, 1);
  assert.equal(score(st), Math.round(st.dist) + 3);
});

test('advance() subdivides long frames and ends the run at the duration', () => {
  const st = createRun(track());
  let n = 0;
  while (!st.done && n++ < 1000) advance(st, 0.2);
  assert.ok(st.done);
  assert.ok(Math.abs(st.t - DURATION_MS / 1000) < 0.02);
  assert.ok(st.dist > 300 && st.dist < 1100, `dist ${st.dist}`);
});

function playBot(seed, fps = 60, botSeed = seed) {
  const st = createRun(makeTrack(createRng(seed)));
  const bot = createBot(createRng(botSeed * 7 + 3));
  const dt = 1 / fps;
  const pending = [];
  let hits = 0;
  while (!st.done) {
    pending.push(bot.act(st, dt, dt * 2));
    const inp = pending.length > 2 ? pending.shift() : null;   // two frames of input latency
    hits += advance(st, dt, inp ?? {}).filter((e) => e.k === 'hit').length;
  }
  return { score: score(st), dist: st.dist, hits, bottles: st.bottles };
}

test('bot: finishes, mostly dodges, but not perfectly, and scores differ between bots', () => {
  const rs = [];
  for (let s = 1; s <= 12; s++) rs.push(playBot(s));
  const hits = rs.map((r) => r.hits);
  const scores = rs.map((r) => r.score);
  console.log('bot scores', scores.join(' '), '| hits', hits.join(' '), '| bottles', rs.map((r) => r.bottles).join(' '));
  assert.ok(scores.every((s) => s > 150));
  assert.ok(new Set(scores).size >= 10);
  assert.ok(hits.reduce((a, b) => a + b, 0) >= 6, 'the bot should make mistakes');
  assert.ok(hits.reduce((a, b) => a + b, 0) / hits.length < 6, 'the bot should not crash constantly');
  // the same track with different bots also spreads the field
  const sameTrack = [1, 2, 3, 4, 5, 6].map((b) => playBot(5, 60, b).score);
  assert.ok(new Set(sameTrack).size >= 4, sameTrack.join(','));
});

test('lookahead reports the nearest obstacle per lane', () => {
  const t = { obstacles: [{ id: 0, type: 'train', lane: 0, d: 30, len: 14 }, { id: 1, type: 'scooter', lane: 2, d: 12, len: 0.7 }], bottles: [{ id: 0, lane: 1, d: 5, y: 0.9 }], length: 100 };
  const la = lookahead(createRun(t), 60);
  assert.equal(la[0].type, 'train'); assert.equal(la[0].gap, 30);
  assert.equal(la[1].clear, true); assert.equal(la[1].bottles, 1);
  assert.equal(la[2].jump, true);
  assert.ok(DURATION_MS > 20000);
});
