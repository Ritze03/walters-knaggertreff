import { defineConfig, devices } from '@playwright/test';

// The board draws ~900 draw calls per frame: with software GL (SwiftShader, Chromium's headless default) it runs at 8-12 fps, with a real GPU
// through ANGLE-GL at ~55 fps. These flags pick the GPU; where there is none Chromium falls back to software rendering and the specs still pass, slower.
// WK_ARGS (space separated) replaces them, WK_HEADED=1 runs headed (needs a display).
// WK_PORT picks the preview port (default 4173); needed when several worktrees run e2e in parallel.
const port = Number(process.env.WK_PORT) || 4173;
const GPU = '--ignore-gpu-blocklist --use-angle=gl --use-gl=angle';
const args = (process.env.WK_ARGS ?? GPU).split(' ').filter(Boolean);
const viewport = { width: 960, height: 540 };

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    headless: !process.env.WK_HEADED,
    launchOptions: { args },
    trace: 'off',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}/walters-knaggertreff/`,
    reuseExistingServer: false,   // always rebuild: a stale dist/ would silently test old code
    timeout: 180 * 1000,
  },
  projects: [
    { name: 'local', testIgnore: /online\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport } },
    { name: 'online', testMatch: /online\.spec\.js/, use: { ...devices['Desktop Chrome'], viewport } },
  ],
});
