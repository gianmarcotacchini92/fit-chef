import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../site/out", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "engine-manifest.json"), "utf8"));
const basePath = manifest.basePath;
const portIndex = process.argv.indexOf("--port");
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT ?? "4173");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid static preview port.");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const server = createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method ?? "")) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    if (pathname === basePath && basePath) {
      response.writeHead(308, { Location: `${basePath}/` }).end();
      return;
    }
    if (!pathname.startsWith(`${basePath}/`)) {
      response.writeHead(404).end("Not found");
      return;
    }
    const relative = pathname.slice(basePath.length).replace(/^\/+/, "");
    let filename = path.resolve(root, relative);
    if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, "index.html");
    const content = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": mime[path.extname(filename)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    const missing = error && typeof error === "object" && "code" in error &&
      ["ENOENT", "ENOTDIR"].includes(error.code);
    response.writeHead(missing ? 404 : error instanceof URIError ? 400 : 500).end(missing ? "Not found" : "Request failed");
    if (!missing && !(error instanceof URIError)) console.error(error);
  }
});

server.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`FIT Chef static preview: http://127.0.0.1:${port}${basePath}/`);
});
