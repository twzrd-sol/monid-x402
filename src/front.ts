import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

/** Resolve a URL path under `root`. Null if it escapes the root. */
export function resolvePage(root: string, urlPath: string): string | null {
  const rel =
    (urlPath.split("?")[0] ?? "/") === "/"
      ? "index.html"
      : (urlPath.split("?")[0] ?? "/").replace(/^\/+/, "");
  if (!rel || rel.includes("\0")) return null;
  const rootResolved = resolve(root);
  const full = resolve(rootResolved, rel);
  const extra = relative(rootResolved, full);
  if (extra.startsWith("..") || extra.split(sep).includes("..")) return null;
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) return null;
  return full;
}

export const safePagePath = resolvePage;

export async function startFront(
  port: number,
  root: string
): Promise<{ port: number; close: () => Promise<void> }> {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid front port: ${port}`);
  }
  const server: Server = createServer(async (req, res) => {
    const urlPath = req.url ?? "/";
    const file = resolvePage(root, urlPath);
    if (!file) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ code: 404, message: `no page ${urlPath.split("?")[0] ?? "/"}` }));
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ code: 404, message: `no page ${urlPath.split("?")[0] ?? "/"}` }));
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  const bound = address && typeof address === "object" ? address.port : port;
  return {
    port: bound,
    close: () =>
      new Promise((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      })
  };
}

export function pagesRoot(cwd = process.cwd()): string {
  return join(cwd, "pages");
}
