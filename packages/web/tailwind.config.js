/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      zIndex: {
        dropdown: '30',
        overlay: '40',
        modal: '50',
        tooltip: '60',
        tour: '70',
      },
      colors: {
        surface: {
          DEFAULT: 'rgb(var(--th-bg) / <alpha-value>)',
          raised: 'rgb(var(--th-bg-alt) / <alpha-value>)',
          overlay: 'rgb(var(--th-bg-muted) / <alpha-value>)',
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
        th: {
          bg: 'rgb(var(--th-bg) / <alpha-value>)',
          'bg-alt': 'rgb(var(--th-bg-alt) / <alpha-value>)',
          'bg-muted': 'rgb(var(--th-bg-muted) / <alpha-value>)',
          'bg-hover': 'rgb(var(--th-bg-hover) / <alpha-value>)',
          text: 'rgb(var(--th-text) / <alpha-value>)',
          'text-alt': 'rgb(var(--th-text-alt) / <alpha-value>)',
          'text-muted': 'rgb(var(--th-text-muted) / <alpha-value>)',
          border: 'rgb(var(--th-border) / <alpha-value>)',
          'border-hover': 'rgb(var(--th-border-hover) / <alpha-value>)',
          'border-muted': 'rgb(var(--th-border-muted) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
