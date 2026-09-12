import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function appendLedger(dir: string, packet: { decision: string }): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const path = join(dir, `${stamp}-${packet.decision}.json`);
  writeFileSync(path, `${JSON.stringify(packet, null, 2)}\n`, { flag: "wx" });
  return path;
}
