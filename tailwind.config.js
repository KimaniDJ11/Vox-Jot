/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        text: "var(--text)",
        background: "var(--bg)",
        "background-ui": "var(--panel-bg)",
        "logo-primary": "var(--accent)",
        "logo-stroke": "var(--accent-hover)",
        "text-stroke": "var(--muted)",
        "mid-gray": "var(--muted)",
      },
    },
  },
  plugins: [],
};
