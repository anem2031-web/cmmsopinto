import http from "node:http";
import fs from "node:fs";
const cssDirectory = "dist/public/assets";
const cssFile = fs
  .readdirSync(cssDirectory)
  .find(name => /^index-.*\.css$/.test(name));
if (!cssFile) throw Error("Build the local styles first");
http
  .createServer((request, response) => {
    const file =
      request.url === "/"
        ? "tools/inventory-books/artifacts/preview.html"
        : request.url === "/styles.css"
          ? `${cssDirectory}/${cssFile}`
          : null;
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": file.endsWith("css")
        ? "text/css; charset=utf-8"
        : "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
    });
    response.end(fs.readFileSync(file));
  })
  .listen(0, "127.0.0.1", function () {
    console.log(`ISOLATED_PREVIEW=http://127.0.0.1:${this.address().port}/`);
  });
