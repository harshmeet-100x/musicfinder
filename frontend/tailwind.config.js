/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Inter',
          'sans-serif',
        ],
      },
      colors: {
        accent: {
          DEFAULT: '#22d3ee',
          fade: '#0e7490',
        },
      },
    },
  },
  plugins: [],
};
