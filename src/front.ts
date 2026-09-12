import { relative, resolve, sep } from "node:path";

export function safePagePath(root: string, urlPath: string): string | null {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  if (!rel || rel.includes("\0")) return null;
  const rootResolved = resolve(root);
  const candidate = resolve(rootResolved, rel);
  const extra = relative(rootResolved, candidate);
  if (extra.startsWith("..") || extra.split(sep).includes("..")) return null;
  if (!candidate.startsWith(`${rootResolved}${sep}`)) return null;
  return candidate;
}
