import type { Config } from "tailwindcss";

/**
 * DashDrop design system.
 *
 * Direction: a business system, not a landing page. Reference points are
 * Salesforce / Workday for data density and Apple / Figma for quietness.
 *
 * Three rules hold the look together:
 *   1. Surfaces are neutral. White panels on a near-grey canvas. Khaki is an
 *      ACCENT — it marks what you can act on (primary button, active tab,
 *      link, focus ring) and never tints a whole panel. Large pale-khaki
 *      rectangles were the single biggest source of the "AI-made" look.
 *   2. Structure comes from rules and type, not from floating rounded cards.
 *      Radii stay small (≤6px) and shadows are nearly invisible; a 1px rule
 *      does the work instead.
 *   3. Type is honest sized. The scale below is shifted up one notch from
 *      Tailwind's default (sm = 15px, not 14px) because this app is read all
 *      day, in Japanese, by people who are not looking for small print.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces. Near-neutral with the faintest warm cast, so the khaki
        // accent still looks at home without the panels themselves being tinted.
        paper: {
          DEFAULT: "#f4f4f2", // app canvas
          raised: "#ffffff", // panels / cards / table body
          sunken: "#eeedea", // wells, hover, table stripes
        },
        // Khaki — accent only. 500 is dark enough to carry white text (~5.2:1).
        khaki: {
          50: "#f5f4ee",
          100: "#e8e6d8",
          200: "#d2ceb4",
          300: "#b5af8b",
          400: "#948d64",
          500: "#6f683f", // primary action
          600: "#5b552f", // hover
          700: "#464123", // active / link text on light
          800: "#34301b",
          900: "#242116",
        },
        // Ink — text and rules. Darker than before: the old #2c2a24 body text
        // on a tinted panel is what read as "washed out".
        ink: {
          DEFAULT: "#1c1b17",
          soft: "#4d4a42",
          muted: "#78756b",
          faint: "#9b988e",
          line: "#e4e2dc", // hairline between sections
          rule: "#d3d0c8", // stronger rule: table verticals, headers
        },
        // Functional status colors. Text-weight versions are darkened so a
        // status word is readable on its own, not just as a colored pill.
        success: { DEFAULT: "#3f6a45", soft: "#e6efe6" },
        warning: { DEFAULT: "#8f6222", soft: "#f6ecd6" },
        danger: { DEFAULT: "#93392e", soft: "#f5e0dc" },
        info: { DEFAULT: "#38596b", soft: "#e2ebef" },
      },
      borderRadius: {
        // Crisp. A business system, not a toy — nothing reads as a pill.
        none: "0",
        sm: "2px",
        DEFAULT: "4px",
        md: "4px",
        lg: "6px",
        xl: "8px",
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Hiragino Kaku Gothic ProN",
          "Meiryo",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        // Panels are held by their 1px rule, not by a shadow. Only things that
        // genuinely float above the page (menus, dialogs) get a real shadow.
        card: "none",
        raised:
          "0 1px 3px rgba(28, 27, 23, 0.08), 0 8px 24px rgba(28, 27, 23, 0.10)",
        focus: "0 0 0 3px rgba(111, 104, 63, 0.30)",
      },
      /**
       * Type scale, shifted up one notch from Tailwind's default so `text-sm`
       * (the app's de-facto body size) lands at 15px instead of 14px. Doing it
       * here rather than editing every call site means the whole product gets
       * legible in one move — and stays consistent.
       */
      fontSize: {
        "2xs": ["0.75rem", { lineHeight: "1.125rem" }], // 12px — was 11
        xs: ["0.8125rem", { lineHeight: "1.25rem" }], // 13px — was 12
        sm: ["0.9375rem", { lineHeight: "1.5rem" }], // 15px — was 14
        base: ["1rem", { lineHeight: "1.65rem" }], // 16px
        lg: ["1.125rem", { lineHeight: "1.7rem" }], // 18px
        xl: ["1.375rem", { lineHeight: "1.85rem" }], // 22px — was 20
        "2xl": ["1.75rem", { lineHeight: "2.15rem" }], // 28px — was 24
        "3xl": ["2.125rem", { lineHeight: "2.5rem" }], // 34px — was 30
        "4xl": ["2.5rem", { lineHeight: "2.85rem" }], // 40px — was 36
      },
      transitionDuration: {
        // Press feedback must feel instant. 150ms on a click reads as lag.
        DEFAULT: "120ms",
        fast: "80ms",
      },
      maxWidth: {
        content: "1200px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
