import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The single-file build is only used for the shareable preview page.
// Netlify can build the normal bundle (set SINGLE_FILE to anything else).
// SAMPLE_H2H=1 fills the head-to-head pages with made-up games while there is no real matchup data.
export default defineConfig({
  plugins: [react(), ...(process.env.SINGLE_FILE ? [viteSingleFile()] : [])],
  define: { __SAMPLE_H2H__: JSON.stringify(!!process.env.SAMPLE_H2H) },
});
