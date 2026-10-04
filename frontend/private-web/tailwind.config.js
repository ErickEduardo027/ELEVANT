/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx}', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        'ink-900': '#0B1F3F',
        'accent-600': '#145DC4',
        'signal-500': '#F2661E',
        surface: {
          light: '#F7F9FB',
          'light-card': '#FFFFFF',
          dark: '#0A1220',
          'dark-card': 'rgba(11,31,63,0.55)',
        },
        text: {
          'primary-light': '#0B1F3F',
          'secondary-light': '#6B7684',
          'primary-dark': '#F4F6F9',
          'secondary-dark': '#94A3B8',
        },
        status: {
          info: '#145DC4',
          active: '#F2661E',
          success: '#1E9E6B',
          warning: '#D9A441',
          danger: '#C4453C',
          neutral: '#6B7684',
        },
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'slide-in-right': 'slide-in-right 220ms ease-out',
        'slide-in-left': 'slide-in-left 220ms ease-out',
      },
    },
  },
  plugins: [],
};
