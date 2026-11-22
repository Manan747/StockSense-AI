/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Premium Fintech Light-Theme Palette
        bgDark: "#f8f9fb",      // Light page background tint
        bgCard: "#ffffff",      // White panel/card bg
        bgHeader: "#ffffff",    // Navigation bar bg
        borderDark: "#e8eaed",  // Muted border color (0.5px)
        textLight: "#111111",   // Dark text for titles and values
        textMuted: "#888888",   // Muted gray for description text
        accentBlue: "#1a56db",  // Primary brand blue
        accentGreen: "#2e7d32", // Success green
        accentRed: "#c62828",   // Danger/Error red
        accentYellow: "#b45309",// Warning amber

        // Explicit Design System Names
        pageBg: "#f8f9fb",
        panelBg: "#ffffff",
        primaryBlue: "#1a56db",
        textHeading: "#111111",
        textBody: "#444444",
        textLabel: "#9aa0aa",
        borderColor: "#e8eaed",
        successGreen: "#2e7d32",
        warningAmber: "#b45309",
        dangerRed: "#c62828",
        infoCalloutBg: "#eff4ff",
        infoCalloutBorder: "#b3c8f8",
        
        // RSI Pill Pastel Colors
        rsiNeutralBg: "#f0f2f5",
        rsiNeutralText: "#555555",
        rsiHighBg: "#fff3e0",
        rsiHighText: "#b45309",
        rsiLowBg: "#e8f5e9",
        rsiLowText: "#2e7d32"
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"]
      }
    },
  },
  plugins: [],
}
