/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        cyber: {
          bg: "#070a1c",
          surface: "#0d1226",
          line: "rgba(34, 211, 238, 0.18)",
          cyan: "#22d3ee",
          "cyan-bright": "#67e8f9",
          magenta: "#e879f9",
          "magenta-bright": "#f0abfc",
          lime: "#a3e635",
          amber: "#fbbf24",
        },
      },
      boxShadow: {
        "glow-cyan-sm": "0 0 8px rgba(34, 211, 238, 0.5)",
        "glow-cyan": "0 0 18px rgba(34, 211, 238, 0.55), 0 0 2px rgba(34, 211, 238, 0.8)",
        "glow-cyan-lg": "0 0 36px rgba(34, 211, 238, 0.55), 0 0 4px rgba(34, 211, 238, 0.9)",
        "glow-magenta-sm": "0 0 8px rgba(232, 121, 249, 0.5)",
        "glow-magenta": "0 0 18px rgba(232, 121, 249, 0.55), 0 0 2px rgba(232, 121, 249, 0.8)",
        "glow-amber": "0 0 18px rgba(251, 191, 36, 0.45)",
        "inner-line": "inset 0 1px 0 rgba(255,255,255,0.04)",
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out",
        "slide-up": "slideUp 300ms cubic-bezier(0.22, 1, 0.36, 1)",
        "neon-pulse": "neonPulse 2.4s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        neonPulse: {
          "0%, 100%": { opacity: "0.85", filter: "drop-shadow(0 0 6px rgba(34,211,238,0.45))" },
          "50%": { opacity: "1", filter: "drop-shadow(0 0 14px rgba(34,211,238,0.75))" },
        },
      },
    },
  },
  plugins: [],
};
