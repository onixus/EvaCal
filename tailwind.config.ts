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
        nord: {
          0: "#2e3440", // polar night — app background
          1: "#3b4252", // polar night — surfaces/cards
          2: "#434c5e", // polar night — borders/hover
          3: "#4c566a", // polar night — muted text/disabled
          4: "#d8dee9", // snow storm — body text
          5: "#e5e9f0",
          6: "#eceff4",
          frost1: "#8fbcbb",
          frost2: "#88c0d0",
          frost3: "#81a1c1",
          frost4: "#5e81ac",
          red: "#bf616a",
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
