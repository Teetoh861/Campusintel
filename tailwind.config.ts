// Tailwind config — design tokens mirror the CSS custom properties defined
// in styles/campusintel.css. The CSS variables remain the source of truth;
// Tailwind utilities just reference them so anything written in Tailwind
// stays consistent with the design.
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    '*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Variant B — "continuous blue" tokens (source: _design/variant-b-handoff).
        // Drive new markup off these (bg-ci-navy, text-ci-paper, border-ci-border…).
        ci: {
          paper: '#FBFAF7',
          'paper-2': '#F4F1EA',
          white: '#FFFFFF',
          ink: '#262320',
          'gray-700': '#565047',
          'gray-600': '#6B6459',
          'gray-500': '#938B7D',
          'gray-400': '#B4AC9E',
          border: '#E7E2D8',
          'border-2': '#DAD3C6',
          'blue-50': '#E9EFF6',
          'blue-100': '#D2E0EC',
          'blue-150': '#C9D6EE',
          'blue-200': '#A6C0DA',
          'blue-400': '#5285B4',
          'blue-600': '#14568F',
          navy: '#003E7E',
          'navy-700': '#00346A',
          'navy-900': '#002850',
          accent: '#E0A33E',
          'accent-600': '#C6862A',
          'accent-100': '#F7E8CC',
          'accent-50': '#FBF3E2',
        },
        // Cobalt-indigo (primary)
        p: {
          50: 'var(--p-50)',
          100: 'var(--p-100)',
          300: 'var(--p-300)',
          500: 'var(--p-500)',
          600: 'var(--p-600)',
          700: 'var(--p-700)',
          900: 'var(--p-900)',
        },
        // Teal (the signal)
        t: {
          50: 'var(--t-50)',
          500: 'var(--t-500)',
          600: 'var(--t-600)',
          700: 'var(--t-700)',
        },
        // Green (completed / mastered)
        g: {
          50: 'var(--g-50)',
          600: 'var(--g-600)',
          700: 'var(--g-700)',
        },
        // Red (wrong / urgency)
        r: {
          50: 'var(--r-50)',
          300: 'var(--r-300)',
          600: 'var(--r-600)',
          700: 'var(--r-700)',
        },
        // Warm neutrals
        n: {
          0: 'var(--n-0)',
          50: 'var(--n-50)',
          100: 'var(--n-100)',
          200: 'var(--n-200)',
          300: 'var(--n-300)',
          400: 'var(--n-400)',
          500: 'var(--n-500)',
          600: 'var(--n-600)',
          700: 'var(--n-700)',
          800: 'var(--n-800)',
          900: 'var(--n-900)',
        },
        // shadcn aliases — retained so legacy ui/* primitives still compile
        // while the redesign is in flight. CSS variables aren't defined right
        // now, so do not author new code against these tokens.
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      fontFamily: {
        // Hanken Grotesk is the default sans (Variant B). The --font-hanken var
        // is set by next/font in app/layout.tsx.
        sans: ['var(--font-hanken)', 'Hanken Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['var(--serif)'],
        mono: ['var(--mono)'],
      },
      maxWidth: {
        wrap: 'var(--maxw)',
        'ci-content': '1200px',
      },
      boxShadow: {
        'ci-card': '0 1px 2px rgba(38,35,32,.04), 0 12px 28px -10px rgba(38,35,32,.14)',
        'ci-soft': '0 1px 2px rgba(38,35,32,.03), 0 18px 50px -22px rgba(27,35,84,.22)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        'ci-btn': '11px',
        'ci-btn-sm': '9px',
        'ci-card': '16px',
        'ci-card-lg': '18px',
        'ci-panel': '24px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
export default config
