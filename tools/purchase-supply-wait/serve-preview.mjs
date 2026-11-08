// Isolated UI fixture only; no application server, .env, database, or network backend.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
const root = process.cwd(), output = process.argv[2] || path.join(root, "tools/purchase-supply-wait/artifacts");
fs.mkdirSync(output, { recursive: true });
const mocks = path.join(root, "tools/purchase-supply-wait/preview-mocks.tsx");
await build({ entryPoints: [path.join(root, "tools/purchase-supply-wait/preview.tsx")], outfile: path.join(output, "preview.js"), bundle: true, format: "iife", platform: "browser", jsx: "automatic",
  alias: { "@/lib/trpc": mocks, "@/lib/read-transport": mocks, "@/_core/hooks/useAuth": mocks, "@/contexts/LanguageContext": mocks, "@/i18n/apiError": mocks,
    "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
});
const css = fs.readdirSync("dist/public/assets").find(name => name.endsWith(".css"));
if (!css) throw Error("Build the app CSS first");
fs.copyFileSync(path.join("dist/public/assets", css), path.join(output, "app.css"));
const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>معاينة توضيح انتظار التوريد</title><link rel="stylesheet" href="/app.css"></head><body style="background:#f5f7fa"><div id="root"></div><script src="/preview.js"></script></body></html>`;
fs.writeFileSync(path.join(output, "preview.html"), html);
http.createServer((request, response) => {
  const file = request.url === "/preview.js" ? "preview.js" : request.url === "/app.css" ? "app.css" : request.url === "/" ? "preview.html" : null;
  if (!file) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
  response.end(fs.readFileSync(path.join(output, file)));
}).listen(4189, "127.0.0.1", () => console.log("Isolated supply-wait UI: http://localhost:4189/"));
