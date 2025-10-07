/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        'custom-blue': '#00D9FF',
        'custom-purple': '#B026FF',
        'custom-green': '#00FF94',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'Arial', 'Helvetica', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'JetBrains Mono', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-custom': 'linear-gradient(135deg, #0A0A0F 0%, #1A0B2E 25%, #16213E 50%, #0F1B3C 75%, #0A0A0F 100%)',
      },
    },
  },
  plugins: [],
}
