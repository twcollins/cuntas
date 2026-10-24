/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Dark mode follows the .dark class on <html>, set from the user's choice or the system setting.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: { 50: "#effaf7", 100: "#d7f2ea", 500: "#14917f", 600: "#0f766e", 700: "#115e57", 900: "#0b3b37" },
      },
      fontFamily: { sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"] },
    },
  },
  plugins: [],
};
