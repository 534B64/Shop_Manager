import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tests run in the shop's time zone for the whole run (date filters mean the
// shop's local day). Set here, before test workers start.
if (process.env.VITEST) process.env.TZ = 'America/Chicago';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: 'dist',
  },
});
