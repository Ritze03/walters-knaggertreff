/**
 * Core rules engine: pure, DOM-free, deterministic (all randomness from state.rng). Exports exactly the contracts CoreApi.
 * Tunable numbers: ./rules.js.
 */
export { isTeamGameAllowed } from '../contracts.js';
export { createGame, applyIntent, serialize, deserialize, resumeGame } from './engine.js';
export { botIntent } from './bot.js';
export { pickMinigame } from './minigames.js';
export { registerBoard, getBoard } from './boards.js';
export { previewPath, previewLanding } from './preview.js';
