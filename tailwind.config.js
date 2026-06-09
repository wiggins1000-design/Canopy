/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'canopy': {
          'deep':  '#1b4332',
          'mid':   '#2d6a4f',
          'green': '#52b788',
          'light': '#74c69d',
          'mist':  '#d8f3dc',
          'frost': '#f4fbf4',
        },
        'pa': {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          400: '#60a5fa',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        'pb': {
          50:  '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          400: '#fb923c',
          600: '#ea580c',
          700: '#c2410c',
          900: '#7c2d12',
        },
      },
    },
  },
  plugins: [],
}
