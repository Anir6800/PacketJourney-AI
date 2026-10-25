import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    ...devices['Desktop Chrome'],
    // Headless Chromium needs SwiftShader for WebGL.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: [
    { command: 'npm run start -w server', url: 'http://127.0.0.1:8787/api/health', reuseExistingServer: true },
    { command: 'npm run dev -w web', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
  ],
});
