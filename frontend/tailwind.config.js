/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0E1A14',
        bolivar: {
          50: '#e9fbf1',
          100: '#c7f4dc',
          200: '#93e9bd',
          300: '#5cd999',
          400: '#2ec478',
          500: '#00A94F',
          600: '#008C42',
          700: '#006E35',
          800: '#00532A',
          900: '#03361D',
          950: '#021c10',
        },
        oro: {
          300: '#FFEFA8',
          400: '#FFE16B',
          500: '#FFD100',
          600: '#E5B800',
          700: '#B38F00',
        },
      },
    },
  },
  plugins: [],
};
