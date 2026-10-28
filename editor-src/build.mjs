// Bundles the editor (React + Remotion Player + composition) into web/editor.bundle.js.
import { build } from "esbuild";

await build({
  entryPoints: ["editor-src/editor.jsx"],
  outfile: "web/editor.bundle.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  sourcemap: false,
  jsx: "automatic",
  loader: { ".js": "jsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "eof",
  logLevel: "info",
});
