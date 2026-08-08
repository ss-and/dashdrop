import type { Config } from "tailwindcss";

/**
 * DashDrop design system.
 *
 * Direction: earthy, calm, trustworthy. Khaki base, low saturation,
 * warm off-white paper. Deliberately NOT "AI-flashy": no neon, no purple
 * gradients, no oversized radii. Corners are gently softened (max ~8px),
 * type is a clean grotesque, contrast is honest.
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
        // Warm paper background scale
        paper: {
          DEFAULT: "#f7f5ef", // app background (生成り)
          raised: "#fdfcf8", // cards / surfaces
          sunken: "#efece2", // wells, table stripes
        },
        // Khaki — the brand core
        khaki: {
          50: "#f6f5ee",
          100: "#e9e7d6",
          200: "#d5d1b4",
          300: "#bdb78d",
          400: "#a49c68",
          500: "#8a8250", // primary
          600: "#6f683f", // primary hover / text-on-light
          700: "#585234",
          800: "#43402a",
          900: "#332f20",
        },
        // Neutral ink — warm-tinted grays for text & borders
        ink: {
          DEFAULT: "#2c2a24",
          soft: "#57544b",
          muted: "#84806f",
          faint: "#a8a493",
          line: "#e2ded1",
        },
        // Functional, muted (not candy) status colors
        success: { DEFAULT: "#4f7a53", soft: "#e7efe4" },
        warning: { DEFAULT: "#b07d38", soft: "#f6ecd8" },
        danger: { DEFAULT: "#a24b3f", soft: "#f4e2de" },
        info: { DEFAULT: "#4a6d80", soft: "#e2ebef" },
      },
      borderRadius: {
        // Restrained. Nothing pill-shaped or bubbly.
        none: "0",
        sm: "3px",
        DEFAULT: "5px",
        md: "6px",
        lg: "8px",
        xl: "10px",
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
        // Soft, low, single-direction shadows — paper on a desk.
        card: "0 1px 2px rgba(44, 42, 36, 0.05), 0 1px 3px rgba(44, 42, 36, 0.04)",
        raised:
          "0 2px 4px rgba(44, 42, 36, 0.06), 0 4px 12px rgba(44, 42, 36, 0.06)",
        focus: "0 0 0 3px rgba(138, 130, 80, 0.28)",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
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
