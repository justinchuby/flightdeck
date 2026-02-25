/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0d1117',
          raised: '#161b22',
          overlay: '#1c2128',
        },
        accent: {
          DEFAULT: '#58a6ff',
          muted: '#388bfd',
        },
        role: {
          architect: '#f0883e',
          reviewer: '#a371f7',
          developer: '#3fb950',
          pm: '#d29922',
          advocate: '#f778ba',
          qa: '#79c0ff',
        },
      },
    },
  },
  plugins: [],
};
