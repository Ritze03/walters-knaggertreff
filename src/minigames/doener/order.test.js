import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../contracts.js';
import { makeOrders, emptyWrap, addIngredient, matches, firstMistake, speedBonus, scoreOf, KEYS, ORDER_COUNT } from './order.js';

test('orders are deterministic per seed and differ between seeds', () => {
  const a = makeOrders(createRng(7)), b = makeOrders(createRng(7)), c = makeOrders(createRng(8));
  assert.equal(a.length, ORDER_COUNT);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('every order is non-empty, within limits and has a German text and colour', () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const o of makeOrders(createRng(seed))) {
      assert.match(o.color, /^#[0-9a-f]{6}$/);
      assert.match(o.text, /^(Döner|Dürüm)/);
      assert.ok(o.text.length <= 70, o.text);
      assert.ok(KEYS.some((k) => o.items[k] > 0), o.text);
      assert.ok(o.items.fleisch >= 0 && o.items.fleisch <= 2);
      for (const k of KEYS.slice(1)) assert.ok(o.items[k] === 0 || o.items[k] === 1);
    }
  }
});

test('the text agrees with the items', () => {
  for (let seed = 1; seed <= 30; seed++) {
    for (const o of makeOrders(createRng(seed))) {
      assert.equal(/scharf/.test(o.text), o.items.scharf === 1, o.text);
      assert.equal(/extra Fleisch/.test(o.text), o.items.fleisch === 2, o.text);
      assert.equal(/ohne Fleisch/.test(o.text), o.items.fleisch === 0, o.text);
      const ohne = /ohne (?!Fleisch)([^,]+)/.exec(o.text)?.[1];
      if (ohne) for (const n of ['Salat', 'Tomate', 'Zwiebel', 'Soße']) assert.equal(ohne.includes(n), o.items[n === 'Soße' ? 'sosse' : n.toLowerCase()] === 0, o.text);
      if (/mit alles/.test(o.text)) assert.ok(o.items.salat + o.items.tomate + o.items.zwiebel + o.items.sosse >= 2, o.text);
    }
  }
});

test('addIngredient cycles Fleisch and toggles the rest; matches/firstMistake', () => {
  const w = emptyWrap();
  addIngredient(w, 'fleisch'); addIngredient(w, 'fleisch');
  assert.equal(w.fleisch, 2);
  addIngredient(w, 'fleisch');
  assert.equal(w.fleisch, 0);
  addIngredient(w, 'zwiebel'); addIngredient(w, 'zwiebel');
  assert.equal(w.zwiebel, 0);
  const order = { items: { ...emptyWrap(), fleisch: 1, sosse: 1 } };
  assert.equal(firstMistake(w, order).over, false);
  Object.assign(w, { fleisch: 1, sosse: 1, zwiebel: 1 });
  assert.deepEqual(firstMistake(w, order), { key: 'zwiebel', over: true });
  w.zwiebel = 0;
  assert.ok(matches(w, order));
  assert.equal(firstMistake(w, order), null);
});

test('scoring: count dominates, bonus is bounded and integral', () => {
  assert.equal(speedBonus(0), 40);
  assert.equal(speedBonus(2000), 30);
  assert.equal(speedBonus(20000), 0);
  assert.ok(scoreOf(5, 999) < scoreOf(6, 0));
  assert.ok(Number.isInteger(scoreOf(3, speedBonus(2345))));
});
