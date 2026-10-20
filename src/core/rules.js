/**
 * Every tunable number of the rules engine lives here (balance work edits ONLY this file).
 * RULES_FOR_STATE is copied into state.rules at createGame so ui/board can show prices without importing core internals.
 * No imports, pure data.
 */

/** die faces; each roll is rng.int(DIE.min, DIE.max) (twice with doubleDice) */
export const DIE = Object.freeze({ min: 1, max: 10 });

export const STAR_PRICE = 10;
export const START_COINS = 5;
export const BLUE_COINS = 3;
export const RED_COINS = 3;
export const ENDSPURT_MULTIPLIER = 2;

/** coins by minigame placement (index 0 = rank 1). Missing rank => 0. Ties share the better rank's reward. */
export const MINIGAME_COINS = Object.freeze([10, 5, 2]);

/** duel: the loser pays the winner (at most what the loser has). A tie pays nothing. */
export const DUEL_STAKE = 8;

export const ITEM_PRICES = Object.freeze({ doubleDice: 6, goldenDoener: 7, steal: 8, trap: 6 });
/** order in which the shop lists items */
export const SHOP_ITEMS = Object.freeze(['doubleDice', 'goldenDoener', 'steal', 'trap']);
export const STEAL_COINS = 5;   // steal takes up to this many coins from the target
export const TRAP_COINS = 5;    // a trap takes up to this many coins from the victim and gives them to the owner

export const MG_HISTORY_LEN = 6;   // state.mgHistory is capped to this
export const LOG_LEN = 30;

/** bot tuning (botIntent only) */
export const BOT = Object.freeze({
  useItemChance: 0.6,      // per decision at step 'roll' with a usable item
  buyItemChance: 0.7,      // chance to buy something when in the shop with comfortable money
  itemComfort: STAR_PRICE, // buy an item only if coins left after buying >= this
});

/** the object stored in state.rules (matches contracts Rules + a few extras the UI may show) */
export const RULES_FOR_STATE = Object.freeze({
  starPrice: STAR_PRICE,
  blueCoins: BLUE_COINS,
  redCoins: RED_COINS,
  endspurtMultiplier: ENDSPURT_MULTIPLIER,
  itemPrices: ITEM_PRICES,
  minigameCoins: MINIGAME_COINS,
  duelStake: DUEL_STAKE,
  // extras beyond the contract's Rules typedef
  startCoins: START_COINS,
  stealCoins: STEAL_COINS,
  trapCoins: TRAP_COINS,
  dieMin: DIE.min,
  dieMax: DIE.max,
});
