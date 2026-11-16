import { build } from "esbuild";
await build({
  entryPoints: ["apps/dashboard/App.tsx"],
  bundle: true,
  minify: true,
  legalComments: "eof",
  outfile: "docs/history/app.js",
  define: { "process.env.NODE_ENV": '"production"' },
});
