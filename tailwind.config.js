/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'] },
      colors: {
        // Roxo açaí extraído do logo original
        acai: {
          50: '#F8F0FA', 100: '#F0DDF4', 200: '#E0BAE8', 300: '#C98AD6', 400: '#AD54BF',
          500: '#91219F', 600: '#7A1A87', 700: '#6A0E7B', 800: '#4E0B5B', 900: '#350D40', 950: '#22072A',
        },
        leaf: { 50: '#F3F8EA', 100: '#E4F0CF', 300: '#CADF69', 500: '#6A9E38', 600: '#55822B', 700: '#426621' },
        mango: { 50: '#FEF8E7', 100: '#FDEFC4', 400: '#F6C94C', 600: '#C99A14', 700: '#946F0B' },
        turq: { 50: '#E8FAF9', 100: '#C6F2EF', 400: '#16C5BD', 500: '#21A99A', 700: '#14705F' },
        surface: '#F7F8F5',
        ink: { DEFAULT: '#1F2430', muted: '#5B6170', soft: '#8A90A0' },
        line: '#E7E8EC',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      boxShadow: {
        card: '0 1px 2px rgba(31,36,48,0.04), 0 1px 3px rgba(31,36,48,0.06)',
        pop: '0 10px 30px -10px rgba(53,13,64,0.25)',
      },
    },
  },
  plugins: [],
};
