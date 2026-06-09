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
          50:  '#ecf2ee',
          100: '#d1e4d9',
          200: '#a3c9b3',
          400: '#2d6a4f',
          600: '#1b4332',
          700: '#163629',
          900: '#0c2118',
        },
        'pb': {
          50:  '#edfbf3',
          100: '#d8f3dc',
          200: '#aadec0',
          400: '#52b788',
          600: '#3a9a70',
          700: '#2d7a59',
          900: '#1a4835',
        },
      },
    },
  },
  plugins: [],
}
