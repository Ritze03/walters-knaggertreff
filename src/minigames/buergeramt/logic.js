// Bürgeramt-Stempel: pure rules (no Kaplay, no DOM). The official's turns come from the shared seed, so every client sees the same forms.
// Rule of the game: only obey when the official says "Bitte", and obey his WORD, not the sign he holds up.

export const CMD_TEXT = ['Stempel GRÜN', 'Stempel ROT', 'Abheften', 'Wegwerfen'];
export const NOTHING_TEXT = 'Nicht stempeln!';
export const SIGN_TEXT = ['GRÜN', 'ROT', 'ABHEFTEN', 'WEG DAMIT'];
export const FORMS = ['Antrag A38', 'Formular 0815', 'Passierschein A38', 'Wohnsitz-Anmeldung', 'Antrag auf Antrag', 'Formular 4711', 'Kfz-Ummeldung', 'Beiblatt 2b', 'Fristverlängerung'];
export const RUDE = ['Hey!', 'Zack zack!', 'Na los!', 'Nummer 47!', 'Nächster!'];
export const LIVES = 3;
export const PLAY_MS = 30000;      // the official closes the counter after this much play time
export const DURATION_MS = 32000;  // module durationMs (hard cap incl. slack)

export const windowMs = (i) => Math.max(850, 1900 - i * 60);   // time to react in turn i
export const gapMs = (i) => Math.max(240, 430 - i * 12);       // pause between turns
export const speedBonus = (reactMs, win) => Math.round(Math.max(0, 1 - reactMs / win) * 20);   // 0..20 per stamp, only a tie-breaker
export const scoreOf = (stamps, bonus) => stamps * 1000 + Math.min(999, bonus);

/**
 * Lazy turn list from a seeded rng: at(i) is the same for everyone. Each turn consumes exactly 7 rng draws, so the sequence never depends on
 * how the previous turn ended. Turn: { i, form, cmd (0..3, or -1 = "Nicht stempeln!"), polite, opener, sign (0..3, the held-up board),
 * expect (what to press: 0..3, or -1 = nothing) }.
 */
export function makeTurns(rng) {
  const list = [];
  let trapRun = 0;
  const gen = () => {
    const i = list.length;
    const [rKind, rCmd, rDecoy, rSign, rForm, rOpen, rPick] = [rng.next(), rng.next(), rng.next(), rng.next(), rng.next(), rng.next(), rng.next()];
    const trapP = i < 2 ? 0 : Math.min(0.38, 0.2 + i * 0.01);
    const isTrap = rKind < trapP && trapRun < 2;
    trapRun = isTrap ? trapRun + 1 : 0;
    let cmd = Math.floor(rCmd * 4), polite = true;
    if (isTrap) { if (rPick < 0.3) cmd = -1; else polite = false; }   // trap: "Bitte nicht stempeln!" or a command without "Bitte"
    const decoy = rDecoy < Math.min(0.5, 0.08 + i * 0.03);
    let sign = cmd < 0 ? Math.floor(rSign * 4) : cmd;
    if (decoy && cmd >= 0) sign = (cmd + 1 + Math.floor(rSign * 3)) % 4;   // always a different board than he says
    return {
      i, cmd, polite, sign,
      form: FORMS[Math.floor(rForm * FORMS.length)],
      opener: polite ? 'Bitte' : RUDE[Math.floor(rOpen * RUDE.length)],
      expect: polite ? cmd : -1,
    };
  };
  return { at(i) { while (list.length <= i) list.push(gen()); return list[i]; } };
}

/** What happens when `action` (0..3, or -1 = nothing before the window closed) meets `turn`: 'ok' | 'wrong' | 'late' | 'safe'. */
export function judge(turn, action) {
  if (action < 0) return turn.expect < 0 ? 'safe' : 'late';
  return action === turn.expect ? 'ok' : 'wrong';
}
