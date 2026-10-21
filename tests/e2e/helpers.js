// Shared helpers for the e2e specs. Everything runs against `vite preview` (see playwright.config.js).
//
// ?local uses BroadcastChannel, which does not cross browser contexts, so every local game lives in ONE context with one page per player,
// and each page gets its own ?pid= (otherwise all tabs would share one playerId).
import { expect } from '@playwright/test';

export const BASE = '/walters-knaggertreff/';

/** Init script: records every game event the page receives (MSG.state payloads) in window.__events, plus a coarse phase trail. */
export const TRACK_EVENTS = () => {
  window.__events = [];
  window.__trail = [];
  window.__revs = {};   // rev -> { phase, round, players } of every state the page saw, to compare pages at the same rev
  const hook = setInterval(() => {
    const s = window.__wk?.session;
    if (!s || window.__hooked === s) return;
    window.__hooked = s;
    window.__prog = [];   // solo minigame progress of the other players: { from: playerId, t, p }
    s.on('mgProgress', (m, from) => window.__prog.push({ from, t: m.t, p: m.p }));
    s.on('state', (m) => {
      for (const e of m.events ?? []) window.__events.push(e);
      window.__revs[m.rev] = { phase: m.state.phase, round: m.state.round, players: m.state.players };
      const mg = m.state.minigame;
      const key = `${m.state.phase}|${mg ? `${mg.id}/${mg.purpose}` : ''}`;
      if (window.__trail.at(-1)?.split('@')[0] !== key) window.__trail.push(`${key}@${Math.round(performance.now() / 1000)}`);
    });
  }, 10);
  window.__stopHook = () => clearInterval(hook);
};

/** Collects pageerror + console.error of a page into `bucket` (an array of strings). Known-harmless noise is filtered here. */
const HARMLESS = [/AudioContext/i, /autoplay/i];
export function collectErrors(page, bucket, label) {
  const keep = (text) => !HARMLESS.some((re) => re.test(text));
  page.on('pageerror', (e) => { if (keep(e.message)) bucket.push(`${label} pageerror: ${e.message}`); });
  page.on('console', (m) => { if (m.type() === 'error' && keep(m.text())) bucket.push(`${label} console.error: ${m.text()}`); });
}

/** WK_SLOW=<rate> (or 1 = 4x) throttles the CPU of every page via CDP, to stress timing-sensitive specs the way a slow headed run does. */
const SLOW = process.env.WK_SLOW ? (Number(process.env.WK_SLOW) > 1 ? Number(process.env.WK_SLOW) : 4) : 0;

/** Opens a page in `context`, wired for event tracking and error collection. */
export async function openPage(context, errors, label) {
  const page = await context.newPage();
  if (SLOW) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
  }
  await page.addInitScript(TRACK_EVENTS);
  collectErrors(page, errors, label);
  return page;
}

/**
 * Host creates a game, `clients` bot pages join through the invite link, host starts it.
 * `query` is extra URL params for the host (e.g. 'stars=2&seed=1&mg=forza'); `hostBot` false leaves the host seat to a human (the test).
 * Returns { host, clients, pages, link, errors }.
 */
export async function createMatch(context, { clients = 2, query = 'stars=2&seed=1', hostBot = true, clientBots = true, start = true } = {}) {
  const errors = [];
  const host = await openPage(context, errors, 'host');
  await host.goto(`${BASE}?local&pid=h${hostBot ? '&bot' : ''}&${query}`);
  await host.getByTestId('create').click();
  const link = await host.getByTestId('invite-link').inputValue();
  expect(link).toContain('?local#');
  const pages = [host];
  for (let i = 1; i <= clients; i++) {
    const p = await openPage(context, errors, `client${i}`);
    await p.goto(link.replace('?local', `?local&pid=c${i}${clientBots ? '&bot' : ''}`));
    pages.push(p);
  }
  await host.getByTestId(`player-${clients}`).waitFor();
  if (start) {
    await host.getByTestId('start').click();
    for (const p of pages) await p.getByTestId('hud-coins-0').waitFor();
  }
  return { host, clients: pages.slice(1), pages, link, errors };
}

export const state = (page) => page.evaluate(() => window.__wk.getState());
export const events = (page) => page.evaluate(() => window.__events);
export const waitPhase = (page, phase, timeout = 120_000) =>
  page.waitForFunction((p) => window.__wk?.getState()?.phase === p, phase, { timeout, polling: 100 });
/** Waits until predicate source `fn(state)` is truthy on the page's current state. */
export const waitState = (page, fn, arg, timeout = 120_000) =>
  page.waitForFunction(([f, a]) => { const s = window.__wk?.getState(); return !!s && new Function('s', 'a', `return (${f})(s, a)`)(s, a); },
    [fn.toString(), arg], { timeout, polling: 100 });

/**
 * THE per-minigame smoke helper (phase-B criterion: "starts, runs and awards placements when forced via ?mg=<id>&bot with 4 pages in one ?local context").
 * Opens `players` pages (host + players-1 bot clients) in `context` on a `?local&mg=<id>&bot` match, starts it, and waits until EVERY page shows that minigame's
 * results (phase minigameResults, state.minigame.id === id, results set). Asserts the basics itself: the minigame did not break (results.void falsy), every
 * participant appears exactly once in placements, coinDelta exists. Everything else (page errors, game-specific checks) is up to the spec.
 *
 * Usage (a whole spec):
 *   import { test, expect } from '@playwright/test';
 *   import { runMinigame } from './helpers.js';
 *   test('ubahn: runs with 4 bots and awards placements', async ({ context }) => {
 *     const r = await runMinigame(context, 'ubahn');
 *     expect(r.placements.flat().length).toBe(4);
 *     expect(r.errors).toEqual([]);
 *   });
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} id minigame id (a key of MINIGAMES)
 * @param {{ players?:number, seed?:number, query?:string, timeout?:number }} [o] players 2..6 (team games need an even count >= 4); `query` is extra host URL params
 * @returns {Promise<{ placements:number[][], results:object, minigame:object, state:object, errors:string[], host:any, clients:any[], pages:any[], match:object }>}
 *   placements = state.minigame.results.placements (seat groups, best first); minigame = the final state.minigame descriptor (seats, mode, teams, coinDelta, ...);
 *   state = the host's whole GameState at that moment; errors = page errors + console.errors of ALL pages so far (the live array, later errors are appended).
 *   The pages stay open (they keep running the board afterwards), so a spec can inspect the DOM, e.g. that no 3D canvas leaked.
 */
export async function runMinigame(context, id, { players = 4, seed = 1, query = '', timeout = 5 * 60_000 } = {}) {
  const match = await createMatch(context, { clients: players - 1, query: `stars=2&seed=${seed}&mg=${id}${query ? `&${query}` : ''}` });
  const done = (s, want) => s.phase === 'minigameResults' && s.minigame?.id === want && !!s.minigame.results;
  await Promise.all(match.pages.map((p) => waitState(p, done, id, timeout)));
  const st = await state(match.host);
  const mg = st.minigame, results = mg.results;
  expect(results.void, `${id} broke (results.void): see errors`).toBeFalsy();
  expect([...results.placements.flat()].sort((a, b) => a - b), `${id}: every participant exactly once`).toEqual([...mg.seats].sort((a, b) => a - b));
  expect(mg.seats.length).toBe(players);
  expect(mg.coinDelta).toBeTruthy();
  return { placements: results.placements, results, minigame: mg, state: st, errors: match.errors, host: match.host, clients: match.clients, pages: match.pages, match };
}
