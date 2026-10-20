// Board screen (contracts section 11): mountBoard({k, session, input, audio, debug}) -> Screen{onState, destroy}, plus BOARDS.
// Renders purely from onState(state, events): events are queued and animated in order, then the scene settles to the snapshot.
import { seatIndexOf } from '../contracts.js';
import { createAnim } from './anim.js';
import { createScene } from './scene.js';
import { createFx } from './fx.js';
import { createPrompts } from './prompts.js';
import { createPlayback } from './playback.js';

// Adding a board = adding boards/<id>.js (+ optionally decor/<id>.js). Tests live next to the boards and are excluded.
export const BOARDS = Object.values(import.meta.glob(['./boards/*.js', '!./boards/*.test.js'], { eager: true })).map((m) => m.default);
const DECORS = import.meta.glob('./decor/*.js', { eager: true });
const decorFor = (id) => (DECORS[`./decor/${id}.js`] ?? DECORS['./decor/generic.js']).default;

/** after a (re)mount only these are replayed; everything else is already reflected in the snapshot */
const REPLAY_ON_MOUNT = new Set(['roundStarted', 'turnStarted', 'turnSkipped']);

export function mountBoard({ k, session, input, audio, trace = null }) {
  const root = k.add([k.pos(0, 0)]);
  let ctx = null;
  let dead = false;
  let busy = false;
  let latest = null;
  let selfSeat = -1;
  const queue = [];
  const idleWaiters = [];   // resolvers of whenIdle()
  const flushIdle = () => { if (!busy && !queue.length) idleWaiters.splice(0).forEach((r) => r()); };
  const offNav = input.onNav((n) => { if (!dead) ctx?.prompts.nav(n); });

  function init(state) {
    const board = BOARDS.find((b) => b.id === state.settings.boardId) ?? BOARDS[0];
    const anim = createAnim(k, root);
    const scene = createScene({ k, root, board, anim, decorBuild: decorFor(board.id) });
    const ui = root.add([k.pos(0, 0)]);
    const fx = createFx({ k, ui, scene, anim, audio });
    const prompts = createPrompts({ k, ui, scene, anim, audio, session, fx });
    const playback = createPlayback({ k, scene, fx, anim, audio });
    ctx = { board, anim, scene, ui, fx, prompts, playback };
    try { audio.music?.('board'); } catch { /* audio is best effort */ }
  }

  /** snap everything to the snapshot (idempotent) */
  function settle(st, snapCamera = false) {
    const { scene, playback } = ctx;
    scene.ensureTokens(st.seats);
    st.players.forEach((p, i) => {
      const t = scene.tokens[i];
      if (!t) return;
      scene.placeToken(i, p.spaceId ?? ctx.board.startSpaceId);
      t.lift = 0; t.pop = 1; t.spin = 0; t.front = false;
    });
    scene.layoutTokens();
    scene.setStar(st.starSpaceId);
    scene.setTraps(st.traps, (seat) => st.seats[seat]?.profile.color ?? '#ffffff');
    scene.setEndspurt(st.endspurt);
    const turn = st.phase === 'boardTurn' ? st.turn : null;
    scene.setTurn(turn ? turn.seat : null);
    const left = turn && turn.stepsLeft > 0 ? turn.stepsLeft : 0;
    playback.resetBadge(left);
    scene.setBadge(left || null);
    scene.setMarkers([]);
    if (turn) scene.cam.follow(turn.seat);
    else if (st.winner != null) scene.cam.follow(st.winner, 1);
    else scene.cam.overview();
    if (snapCamera) scene.cam.snap();
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length && !dead) {
        const item = queue.shift();
        const lag = queue.length;   // states still waiting behind this one
        ctx.anim.instant = lag >= 2;
        ctx.anim.speed = lag === 1 ? 2.2 : 1;
        for (const ev of item.events) {
          if (dead) return;
          trace?.(`+${ev.type}`);
          try { await ctx.playback.play(ev, item.state); } catch (e) { console.error('board playback', ev.type, e); }
          trace?.(`-${ev.type}`);
        }
        if (dead) return;
        settle(item.state);
      }
    } finally {
      busy = false;
    }
    flushIdle();
    if (dead) return;
    ctx.anim.instant = false;
    ctx.anim.speed = 1;
    ctx.prompts.sync(latest, selfSeat);
  }

  return {
    onState(state, events = []) {
      if (dead) return;
      latest = state;
      selfSeat = seatIndexOf(state, session.selfPlayerId);
      if (!ctx) {
        init(state);
        settle(state, true);
        events = events.filter((e) => REPLAY_ON_MOUNT.has(e.type));
      }
      if (events.length) ctx.prompts.close();   // the old prompt is outdated the moment something happens
      queue.push({ state, events });
      pump();
    },

    /** states/events still waiting or playing (0 = the board has nothing left to show) */
    pending: () => queue.length + (busy ? 1 : 0),

    /** resolves once the event queue has fully played out (also if the board is destroyed meanwhile) */
    whenIdle() {
      if (dead || (!busy && !queue.length)) return Promise.resolve();
      return new Promise((r) => idleWaiters.push(r));
    },

    destroy() {
      if (dead) return;
      dead = true;
      idleWaiters.splice(0).forEach((r) => r());
      offNav?.();
      queue.length = 0;
      if (ctx) ctx.anim.kill();
      root.destroy();
    },
  };
}
