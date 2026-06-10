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
          50:  '#f0faf5',
          100: '#b5e6c8',
          200: '#85d4a9',
          400: '#52b788',
          600: '#3a9a70',
          700: '#2d7a59',
          900: '#1b4332',
        },
        'pb': {
          50:  '#f4fbf4',
          100: '#d8f3dc',
          200: '#c2eccc',
          400: '#d8f3dc',
          600: '#74c69d',
          700: '#52b788',
          900: '#2d6a4f',
        },
      },
    },
  },
  plugins: [],
}
