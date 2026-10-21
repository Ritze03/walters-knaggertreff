import { test, expect } from '@playwright/test';
import { createMatch, events, state } from './helpers.js';

// Phase-B criterion: a full ?local&bot match on DB Hauptbahnhof triggers "Zug fällt aus" and the Schienenersatzverkehr.
// Seed 7 with a 40-coin start purse (?coins keeps bot decisions independent of minigame results) and 2 stars. Verified in a core simulation
// (forza + ordnungsamt as the round minigames, random minigame outcomes, 6 different lobby rev offsets): 100% of the games contain the
// Schienenersatzverkehr AND a "Zug fällt aus" that actually sends somebody off the tracks, within ~5 rounds.
const QUERY = 'stars=2&seed=7&coins=40';
const TRACKS = ['g1', 'g2', 'g3', 'g4'];

test('3 bots play a full match on DB Hauptbahnhof: Zug fällt aus + Schienenersatzverkehr, no errors', async ({ context }) => {
  const m = await createMatch(context, { clients: 2, query: QUERY, start: false });

  // the host picks the board in the lobby
  await m.host.getByTestId('board-bahnhof').click();
  await expect(m.host.getByTestId('board-bahnhof')).toBeVisible();
  await expect.poll(async () => (await state(m.clients[0])).settings.boardId, { timeout: 10_000 }).toBe('bahnhof');
  await m.host.getByTestId('start').click();
  for (const p of m.pages) await p.getByTestId('hud-coins-0').waitFor();

  await Promise.all(m.pages.map((p) => p.getByTestId('victory').waitFor({ timeout: 10 * 60_000 })));

  const states = await Promise.all(m.pages.map((p) => state(p)));
  for (const s of states) {
    expect(s.phase).toBe('victory');
    expect(s.settings.boardId).toBe('bahnhof');
    expect(s.players[s.winner].stars).toBeGreaterThanOrEqual(2);
  }
  expect(new Set(states.map((s) => s.winner)).size).toBe(1);

  for (const p of m.pages) {
    const ev = await events(p);
    // Zug fällt aus: the event fired and sent somebody standing on the tracks back to the Haupteingang
    const cancelled = ev.filter((e) => e.type === 'eventSpace' && e.eventId === 'zugfaelltaus');
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
    const sentBack = cancelled.flatMap((e) => e.effects).filter((e) => e.type === 'moveTo');
    expect(sentBack.length).toBeGreaterThanOrEqual(1);
    expect(sentBack.every((e) => e.spaceId === 'b00')).toBe(true);
    expect(ev.some((e) => e.type === 'teleported' && TRACKS.includes(e.from) && e.to === 'b00')).toBe(true);
    // Schienenersatzverkehr: the bus dropped the lander somewhere else, never onto the tracks
    const bus = ev.filter((e) => e.type === 'eventSpace' && e.eventId === 'schienenersatz');
    expect(bus.length).toBeGreaterThanOrEqual(1);
    const [ride] = bus[0].effects;
    expect(ride.type).toBe('moveTo');
    expect(TRACKS).not.toContain(ride.spaceId);
    expect(ev.some((e) => e.type === 'teleported' && e.seat === bus[0].seat && e.to === ride.spaceId)).toBe(true);
    expect(ev.some((e) => e.type === 'victory')).toBe(true);
  }
  expect(m.errors).toEqual([]);
});
