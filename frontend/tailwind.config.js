/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
        "./src/**/*.{js,jsx,ts,tsx}",
        "./public/index.html"
    ],
    theme: {
        extend: {
            fontFamily: {
                display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
                sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)',
                '2xl': '1rem',
                '3xl': '1.5rem',
            },
            colors: {
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))'
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover))',
                    foreground: 'hsl(var(--popover-foreground))'
                },
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))'
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))'
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))'
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))'
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive))',
                    foreground: 'hsl(var(--destructive-foreground))'
                },
                border: 'hsl(var(--border))',
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                chart: {
                    '1': 'hsl(var(--chart-1))',
                    '2': 'hsl(var(--chart-2))',
                    '3': 'hsl(var(--chart-3))',
                    '4': 'hsl(var(--chart-4))',
                    '5': 'hsl(var(--chart-5))'
                },
                brand: {
                    blue: '#2C6BFF',
                    'blue-soft': '#EEF3FF',
                    green: '#10B981',
                    'green-mint': '#D1FAE5',
                    violet: '#7C3AED',
                    'violet-soft': '#F5F3FF',
                    amber: '#F59E0B',
                    'amber-soft': '#FEF3C7',
                    red: '#EF4444',
                    'red-soft': '#FEE2E2',
                    bg: '#F8FAFC',
                    border: '#E5E7EB',
                    ink: '#0B1220',
                },
            },
            boxShadow: {
                'card': '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)',
                'card-lg': '0 4px 8px rgba(16,24,40,0.04), 0 24px 48px rgba(16,24,40,0.08)',
                'float': '0 12px 40px rgba(16,24,40,0.10)',
                // v156 — brand-tinted elevations for premium feel on the dark
                // navy + orange theme. Use `shadow-brand-sm/md/lg` where a
                // subtle orange halo elevates a primary CTA or hero card.
                'brand-sm': '0 1px 2px rgba(11,18,32,0.06), 0 4px 12px rgba(249,115,22,0.08)',
                'brand-md': '0 4px 8px rgba(11,18,32,0.06), 0 12px 32px rgba(249,115,22,0.10)',
                'brand-lg': '0 8px 16px rgba(11,18,32,0.08), 0 24px 60px rgba(249,115,22,0.14)',
                'brand-glow': '0 0 0 3px rgba(249,115,22,0.14), 0 0 24px rgba(249,115,22,0.20)',
            },
            keyframes: {
                'accordion-down': {
                    from: { height: '0' },
                    to: { height: 'var(--radix-accordion-content-height)' }
                },
                'accordion-up': {
                    from: { height: 'var(--radix-accordion-content-height)' },
                    to: { height: '0' }
                },
                'float-y': {
                    '0%, 100%': { transform: 'translateY(0px)' },
                    '50%': { transform: 'translateY(-6px)' },
                },
                'fade-up': {
                    '0%': { opacity: '0', transform: 'translateY(8px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'modal-in': {
                    '0%': { opacity: '0', transform: 'scale(0.98)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                'shimmer-x': {
                    '0%':   { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                'logo-sheen': {
                    '0%':   { transform: 'translateX(-120%) skewX(-15deg)', opacity: '0' },
                    '30%':  { opacity: '1' },
                    '100%': { transform: 'translateX(220%) skewX(-15deg)', opacity: '0' },
                },
                'shake-x': {
                    '0%, 100%': { transform: 'translateX(0)' },
                    '20%, 60%': { transform: 'translateX(-4px)' },
                    '40%, 80%': { transform: 'translateX(4px)' },
                },
                'count-in': {
                    '0%':   { opacity: '0', transform: 'translateY(4px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                'typing-dot': {
                    '0%, 60%, 100%': { opacity: '0.25', transform: 'translateY(0)' },
                    '30%':           { opacity: '1', transform: 'translateY(-2px)' },
                },
            },
            animation: {
                'accordion-down': 'accordion-down 0.2s ease-out',
                'accordion-up': 'accordion-up 0.2s ease-out',
                'float-y': 'float-y 6s ease-in-out infinite',
                'fade-up': 'fade-up 300ms ease-out both',
                'modal-in': 'modal-in 180ms ease-out both',
                'shimmer-x': 'shimmer-x 1.4s linear infinite',
                'shake-x': 'shake-x 320ms ease-out',
                'count-in': 'count-in 200ms ease-out both',
            },
            transitionDuration: {
                '150': '150ms',
                '200': '200ms',
                '300': '300ms',
            },
        }
    },
    plugins: [require("tailwindcss-animate")],
};
