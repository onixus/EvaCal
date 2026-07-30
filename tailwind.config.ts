import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          500: "#3f6fdb",
          600: "#3159c2",
          700: "#28479a",
        },
        // Neon-pink accent used sparingly in the light theme (focus rings, logo glow, active tab).
        neon: {
          400: "#ff6fc4",
          500: "#ff3ea5",
          600: "#e8177f",
        },
        // Nord (https://www.nordtheme.com/) — used for the dark theme.
        // Surfaces are pitched one step lighter than the stock palette (cards/inputs sit
        // on nord2 rather than nord1) — verified against WCAG contrast math, see below.
        nord: {
          0: "#2e3440", // polar night — app background
          1: "#3b4252", // polar night — recessed surfaces (inputs, Gantt track)
          2: "#434c5e", // polar night — cards/panels/headers
          3: "#4c566a", // polar night — borders/dividers only, NOT text (fails contrast as foreground, ~1.2:1 on nord0-2)
          4: "#d8dee9", // snow storm — primary/secondary text
          5: "#e5e9f0",
          6: "#eceff4",
          // Custom, not in the stock Nord palette: nord3 is too close in luminance to nord0-2
          // to work as readable muted text (measured ~1.2-1.7:1). This tone keeps >=4.5:1
          // against nord0/nord1/nord2 alike.
          muted: "#b6c0ce",
          frost1: "#8fbcbb",
          frost2: "#88c0d0",
          frost3: "#81a1c1",
          frost4: "#5e81ac",
          red: "#bf616a",
          // Lighter tint of `red`, for text/foreground use only (the stock red measures
          // ~2.1-2.5:1 against nord0-2 as text — fine as a background accent, too low as text).
          redText: "#e5a0a8",
          orange: "#d08770",
          yellow: "#ebcb8b",
          green: "#a3be8c",
          purple: "#b48ead",
        },
      },
    },
  },
  plugins: [],
};
export default config;
