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
          50:  '#f4fbf4',
          100: '#d8f3dc',
          200: '#d8f3dc',
          300: '#b5e6c8',
          400: '#d8f3dc',
          600: '#74c69d',
          700: '#2d6a4f',
          800: '#2d6a4f',
          900: '#1b4332',
        },
        'pb': {
          50:  '#f9fafb',
          100: '#e5e7eb',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#e5e7eb',
          600: '#9ca3af',
          700: '#9ca3af',
          800: '#6b7280',
          900: '#374151',
        },
      },
    },
  },
  plugins: [],
}
