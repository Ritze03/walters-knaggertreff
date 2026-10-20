// GameEvent -> animation. Each handler returns a promise that resolves when its show is over. index.js plays them strictly in order.
// In "instant" mode (playback lags behind the state stream) tweens finish at once and sfx/voice are skipped.
import { ITEM, ITEM_INFO } from '../contracts.js';
import { getMinigame } from '../minigames/index.js';

/** how long the full-screen "minigame time" / duel announcements stay up */
const ANNOUNCE_HOLD_S = 2.2;
const mgName = (mg) => (mg ? getMinigame(mg.id)?.name ?? mg.id : '');

const GREEN = '#8ce99a', RED = '#ff6b6b', GOLD = '#ffd43b';

export function createPlayback({ k, scene: S, fx, anim: A, audio }) {
  let badge = 0;
  const sfx = (n, o) => { if (!A.instant) audio.sfx(n, o); };
  const say = (id) => { if (!A.instant && id) audio.say(id); };
  const lerp = (a, b, t) => a + (b - a) * t;

  const name = (st, seat) => st.seats[seat]?.profile.name ?? '?';
  const color = (st, seat) => st.seats[seat]?.profile.color ?? '#ffffff';
  const tok = (seat) => S.tokens[seat];
  const setBadge = (n) => { badge = Math.max(0, n); S.setBadge(badge || null); };

  async function walk(seat, path) {
    const t = tok(seat);
    if (!t) return;
    t.front = true;
    S.cam.follow(seat);
    const hop = path.length > 8 ? 0.17 : 0.24;
    for (let i = 0; i < path.length; i++) {
      const from = { ...t.pos }, to = S.spacePos(path[i]);
      t.av.setFacing(to.x - from.x);
      t.av.bounce();
      sfx('step', { rate: 1 + Math.min(i, 8) * 0.04 });
      await A.tween(hop, (p) => {
        t.pos = { x: lerp(from.x, to.x, p), y: lerp(from.y, to.y, p) };
        t.lift = Math.sin(p * Math.PI) * 44;
      });
      t.lift = 0;
      t.spaceId = path[i];
      S.layoutTokens();
      setBadge(badge - 1);
    }
    t.front = false;
  }

  const handlers = {
    async roundStarted(ev, st) {
      if (ev.round === 1) say('yallah');
      S.cam.overview();
      await fx.banner(`Runde ${ev.round}`, { color: '#4dabf7', size: 76, hold: 0.8, y: 0.45, tilt: 2 });
      if (st.turn) S.cam.follow(st.turn.seat);
    },

    async turnStarted(ev, st) {
      S.setTurn(ev.seat);
      S.cam.follow(ev.seat);
      tok(ev.seat)?.av.bounce();
      fx.chip(`${name(st, ev.seat)} ist dran`, color(st, ev.seat), 0.7);
      await A.wait(0.5);
    },

    async turnSkipped(ev, st) {
      S.cam.follow(ev.seat);
      S.popup(ev.seat, '💤', { size: 56 });
      say('zugFaelltAus');
      fx.chip(`${name(st, ev.seat)} setzt aus`, color(st, ev.seat), 0.9);
      await A.wait(1.0);
    },

    async diceRolled(ev, st) {
      S.setTurn(ev.seat);
      S.cam.follow(ev.seat);
      badge = 0;
      await fx.dice(ev.dice, color(st, ev.seat));
      setBadge(ev.value);
    },

    async moved(ev) {
      await walk(ev.seat, ev.path);
    },

    async teleported(ev) {
      const t = tok(ev.seat);
      if (!t) return;
      S.cam.follow(ev.seat);
      sfx('whoosh');
      S.burst(S.tokenTop(ev.seat), '💨', 6, { spread: 90 });
      await A.tween(0.3, (p) => { t.pop = 1 - p; t.spin = p * 540; }, A.ease.easeInBack);
      S.placeToken(ev.seat, ev.to);
      S.layoutTokens();
      S.cam.follow(ev.seat);
      await A.wait(0.2);
      sfx('boing');
      await A.tween(0.4, (p) => { t.pop = p; t.spin = (1 - p) * -360; }, A.ease.easeOutBack);
      t.spin = 0; t.pop = 1;
    },

    async coinsChanged(ev) {
      const gain = ev.delta > 0;
      S.popup(ev.seat, `${gain ? '+' : '−'}${Math.abs(ev.delta)} 🍾`, { color: gain ? GREEN : RED, size: 46 });
      sfx(gain ? 'coinGain' : 'coinLoss');
      if (gain && ev.delta >= 3) S.burst(S.tokenTop(ev.seat), '🍾', 5, { spread: 100, size: 24 });
      if (!gain) tok(ev.seat)?.av.bounce();
      await A.wait(ev.reason === 'minigame' || ev.reason === 'duel' ? 0.2 : 0.5);
    },

    async starBought(ev, st) {
      const t = tok(ev.seat);
      sfx('star');
      say(Math.random() < 0.4 ? 'monteYes' : 'starBought');
      t?.av.bounce();
      S.cam.shake(10, 0.4);
      S.burst(S.tokenTop(ev.seat), '⭐', 10, { spread: 170, size: 34 });
      const show = fx.banner(`⭐ ${name(st, ev.seat)} hat einen Stern!`, { color: '#ffb400', size: 58, hold: 1.1 });
      // the old star pops away, the new one drops in somewhere else
      await A.tween(0.45, (p) => { S.star.scale = 1 - p; S.star.spin = p * 540; S.star.lift = p * 80; }, A.ease.easeInBack);
      S.setStar(ev.newStarSpaceId);
      const np = S.spacePos(ev.newStarSpaceId);
      S.cam.look(np.x, np.y, 0.6);
      await A.wait(0.4);
      sfx('whoosh');
      await A.tween(0.6, (p) => { S.star.scale = p; S.star.spin = (1 - p) * -360; S.star.lift = (1 - p) * 260; }, A.ease.easeOutBounce);
      S.star.scale = 1; S.star.spin = 0; S.star.lift = 0;
      await show;
      S.cam.follow(ev.seat);
    },

    async itemBought(ev) {
      sfx('buy');
      const inf = ITEM_INFO[ev.item];
      S.popup(ev.seat, `${inf.emoji} ${inf.name}`, { color: GOLD, size: 40, hold: 1.2 });
      S.burst(S.tokenTop(ev.seat), inf.emoji, 6, { spread: 110, size: 28 });
      tok(ev.seat)?.av.bounce();
      await A.wait(0.8);
    },

    async itemUsed(ev, st) {
      sfx('item');
      const inf = ITEM_INFO[ev.item];
      const who = name(st, ev.seat);
      if (ev.item === ITEM.doubleDice) {
        await fx.banner('🎲🎲 Doppelwürfel!', { color: '#4dabf7', size: 52, hold: 0.8, y: 0.25 });
      } else if (ev.item === ITEM.goldenDoener) {
        S.burst(S.tokenTop(ev.seat), '🥙', 8, { spread: 120 });
        await fx.banner('🥙 Goldener Döner: noch ein Wurf!', { color: '#e0a800', size: 48, hold: 0.9, y: 0.25 });
      } else if (ev.item === ITEM.steal) {
        S.cam.fit([S.tokenTop(ev.seat), S.tokenTop(ev.targetSeat)], 260, 0.9);
        say('sybau');
        S.burst(S.tokenTop(ev.targetSeat), '🪙', 8, { to: S.tokenTop(ev.seat), dur: 0.7 });
        tok(ev.targetSeat)?.av.bounce();
        await fx.banner(`🪙 ${who} beklaut ${name(st, ev.targetSeat)}!`, { color: '#9b5de5', size: 48, hold: 1.0, y: 0.25 });
        S.cam.follow(ev.seat);
      } else if (ev.item === ITEM.trap) {
        const p = S.spacePos(ev.spaceId);
        S.cam.look(p.x, p.y, 0.8);
        const tr = { owner: ev.seat, color: color(st, ev.seat), dy: 420 };
        S.traps.set(ev.spaceId, tr);
        await A.wait(0.3);
        await A.tween(0.6, (q) => { tr.dy = 420 * (1 - q); }, A.ease.easeOutBounce);
        sfx('trap');
        S.popup({ x: p.x, y: p.y - 70 }, 'Falle!', { color: GOLD, size: 40 });
        await A.wait(0.7);
        S.cam.follow(ev.seat);
      } else {
        S.popup(ev.seat, `${inf.emoji} ${inf.name}`, { size: 36 });
        await A.wait(0.5);
      }
    },

    async trapTriggered(ev, st) {
      const p = S.spacePos(ev.spaceId);
      S.cam.look(p.x, p.y, 0.9);
      S.traps.delete(ev.spaceId);
      sfx('trap');
      say('trapTriggered');
      S.cam.shake(16, 0.5);
      S.popup({ x: p.x, y: p.y - 60 }, 'SCHNAPP!', { color: RED, size: 56, hold: 1.1 });
      const t = tok(ev.victimSeat);
      if (t) await A.tween(0.4, (q) => { t.pop = 1 - Math.sin(q * Math.PI) * 0.35; t.spin = Math.sin(q * Math.PI * 4) * 14; });
      if (t) { t.pop = 1; t.spin = 0; }
      await A.wait(0.4);
    },

    async eventSpace(ev, st) {
      const at = tok(ev.seat)?.spaceId;
      const delta = ev.effects.filter((e) => e.type === 'coins' && e.seat === ev.seat).reduce((a, e) => a + e.delta, 0);
      const warp = ev.effects.some((e) => e.type === 'moveTo');
      const c = warp ? '#9b5de5' : delta < 0 ? '#e8505b' : '#ffb400';
      if (ev.sfx) sfx(ev.sfx);
      say(ev.lineId);
      S.cam.follow(ev.seat);
      tok(ev.seat)?.av.bounce();
      if (!A.instant) S.cam.shake(delta < 0 || warp ? 9 : 4, 0.3);
      const show = at ? S.decor.event(ev.eventId, at) : null;
      await Promise.all([fx.banner(ev.banner, { color: c, size: 46, y: 0.28 }), show]);
    },

    async duelStart(ev, st) {
      sfx('duel');
      say('duel');
      S.cam.fit(ev.seats.map((s) => S.tokenTop(s)), 240, 0.9);
      ev.seats.forEach((s) => tok(s)?.av.bounce());
      fx.flash('#ff3b3b', 0.35, 0.5);
      const mg = st.minigame?.purpose === 'duel' ? st.minigame : null;
      await fx.announce({
        emoji: '⚔️', title: 'DUELL!', sub: `${name(st, ev.seats[0])} gegen ${name(st, ev.seats[1])}`, pill: mg ? mgName(mg) : undefined,
        color: '#e8505b', hold: ANNOUNCE_HOLD_S,
      });
    },

    /** the round minigame is about to start: the board has played out the last move, now the unmissable announcement */
    async minigameStart(ev) {
      if (ev.minigame.purpose !== 'round') return;   // a duel already announced itself with duelStart
      sfx('fanfare');
      say(ev.minigame.id === 'forza' ? 'forza' : 'minigameGo');
      S.cam.overview();
      await fx.announce({
        emoji: '🎉', title: 'MINISPIEL-ZEIT!', sub: 'Alle haben gewürfelt — jetzt wird gezockt!', pill: mgName(ev.minigame),
        color: '#9b5de5', hold: ANNOUNCE_HOLD_S,
      });
    },

    async endspurtStarted() {
      sfx('endspurt');
      say('endspurt');
      S.setEndspurt(true);
      S.cam.overview();
      S.cam.shake(26, 0.9);
      fx.flash('#ff8a1f', 0.55, 0.7);
      await fx.banner('🔥 ENDSPURT! 🔥', { sub: 'Münzfelder zählen jetzt doppelt!', color: '#ff5a1f', size: 88, hold: 2.2, y: 0.4, tilt: -3 });
    },

    async victory(ev, st) {
      S.setTurn(null);
      S.cam.follow(ev.seat, 1);
      sfx('fanfare');
      say('winner');
      const t = tok(ev.seat);
      fx.confetti(S.tokenTop(ev.seat), 60);
      for (let i = 0; i < 4; i++) { t?.av.bounce(); await A.wait(0.5); }
    },
  };

  return {
    play: (ev, st) => (handlers[ev.type] ? handlers[ev.type](ev, st) : Promise.resolve()),
    resetBadge: (n) => { badge = n || 0; },
  };
}
