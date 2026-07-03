import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        accent: 'var(--accent)',
        'accent-contrast': 'var(--accent-contrast)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        ok: 'var(--ok)',
      },
      borderRadius: {
        token: 'var(--radius)',
      },
    },
  },
  plugins: [],
} satisfies Config;
