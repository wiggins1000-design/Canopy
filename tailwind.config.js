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
          50:  '#e8eeeb',
          100: '#c5d5cc',
          200: '#8aac99',
          400: '#1b4332',
          600: '#163629',
          700: '#112b20',
          900: '#091810',
        },
        'pb': {
          50:  '#f0faf5',
          100: '#d8f3dc',
          200: '#b5e6c8',
          400: '#74c69d',
          600: '#52b788',
          700: '#3a9a70',
          900: '#1b4332',
        },
      },
    },
  },
  plugins: [],
}
