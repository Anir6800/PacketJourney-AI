import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  // One worker: every page drives SwiftShader WebGL on the CPU, and parallel pages starve wall-clock-timed tests.
  workers: 1,
  reporter: 'list',
  use: {
    // Own port for e2e: never reuse whatever happens to listen on the dev port (another local project once did).
    baseURL: 'http://127.0.0.1:5179',
    ...devices['Desktop Chrome'],
    // Headless Chromium needs SwiftShader for WebGL.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: [
    { command: 'npm run start -w server', url: 'http://127.0.0.1:8787/api/health', reuseExistingServer: true },
    { command: 'npm run dev -w web -- --port 5179 --strictPort', url: 'http://127.0.0.1:5179', reuseExistingServer: false },
  ],
});
