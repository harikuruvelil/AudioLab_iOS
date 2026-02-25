import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Base path is set to the repo name when deploying to GitHub Pages.
// Locally (or when GITHUB_PAGES is not set) it defaults to "/" so dev server works as normal.
const base = process.env.GITHUB_PAGES === "true" ? "/AudioLab_iOS/" : "/";

export default defineConfig({
  base,
  plugins: [react()]
});
