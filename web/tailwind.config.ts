import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Space Grotesk", "Segoe UI", "sans-serif"],
        sans: ["Inter", "Segoe UI", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "Cascadia Mono", "Consolas", "monospace"]
      },
      colors: {
        // Layered ink surfaces — the after-hours trading floor
        ink: {
          DEFAULT: "#080B14",
          900: "#0A0E1A",
          800: "#0E1322",
          700: "#121A2E",
          600: "#172138"
        },
        line: {
          DEFAULT: "#1E2A44",
          soft: "#19233A",
          strong: "#2C3C60"
        },
        fg: {
          DEFAULT: "#E7ECF7",
          muted: "#93A1C0",
          faint: "#5C6B89"
        },
        // Brass — the brand: the desk bell, the institution
        brass: {
          DEFAULT: "#F5B642",
          bright: "#FFC95C",
          deep: "#D8932A"
        },
        // Bull / bear — the native language of the tape
        bull: {
          DEFAULT: "#2BD9A4",
          bright: "#42E8B5",
          deep: "#159C73"
        },
        bear: {
          DEFAULT: "#FB6F84",
          bright: "#FF8A9C",
          deep: "#D8425C"
        },
        azure: { DEFAULT: "#56A8FF", deep: "#2E7BD6" },
        iris: { DEFAULT: "#9B8CFF", deep: "#6F5DE0" }
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 18px 40px -24px rgba(0,0,0,0.9)",
        lift: "0 24px 60px -28px rgba(0,0,0,0.95)",
        brass: "0 0 0 1px rgba(245,182,66,0.35), 0 10px 30px -10px rgba(245,182,66,0.35)",
        bull: "0 0 0 1px rgba(43,217,164,0.35), 0 10px 30px -12px rgba(43,217,164,0.4)",
        bear: "0 0 0 1px rgba(251,111,132,0.35), 0 10px 30px -12px rgba(251,111,132,0.4)"
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(86,168,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(86,168,255,0.05) 1px, transparent 1px)",
        "brass-sheen": "linear-gradient(135deg, #FFC95C 0%, #F5B642 45%, #D8932A 100%)",
        "bull-fade": "linear-gradient(180deg, rgba(43,217,164,0.18) 0%, rgba(43,217,164,0) 100%)",
        "bear-fade": "linear-gradient(180deg, rgba(251,111,132,0.18) 0%, rgba(251,111,132,0) 100%)"
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "pulse-dot": {
          "0%,100%": { opacity: "1", boxShadow: "0 0 0 0 rgba(43,217,164,0.5)" },
          "50%": { opacity: "0.65", boxShadow: "0 0 0 6px rgba(43,217,164,0)" }
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" }
        }
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        marquee: "marquee 40s linear infinite",
        shimmer: "shimmer 2.2s linear infinite"
      }
    }
  },
  plugins: []
} satisfies Config;
