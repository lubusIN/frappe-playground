import frappeUIPreset from 'frappe-ui/tailwind'

export default {
  presets: [frappeUIPreset],
  content: [
    './src/**/*.{html,js,vue}',
    './node_modules/frappe-ui/src/**/*.{js,ts,vue}',
  ],
  theme: {
    extend: {
      keyframes: {
        'progress-sweep': {
          '0%': { transform: 'translateX(-120%)' },
          '55%': { transform: 'translateX(95%)' },
          '100%': { transform: 'translateX(240%)' },
        },
      },
      animation: {
        'progress-sweep': 'progress-sweep 1.25s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
