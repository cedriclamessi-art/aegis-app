const { aegis } = require('./color-preset');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          950: '#0f172a',
        },
        indigo: {
          500: '#6366f1',
        },
        emerald: {
          500: '#10b981',
        },
        rose: {
          500: '#f43f5e',
        },
        // Preset AEGIS : bg-aegis-bg-base, text-aegis-brand-500, etc.
        aegis: {
          bg: aegis.bg,
          text: aegis.text,
          border: aegis.border,
          brand: aegis.brand,
          accent: aegis.accent,
          success: aegis.success,
          warning: aegis.warning,
          danger: aegis.danger,
          info: aegis.info,
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
