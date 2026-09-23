// Copies each prefetch file of the static export to the name the browser asks
// for. Next writes /help/__next.help/__PAGE__.txt but requests
// /help/__next.help.__PAGE__.txt; the k8n binary maps one to the other as it
// serves (segmentFile in apps/api/prefetch.go), a static host cannot.
import { copyFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const out = new URL("../out", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, visit);
    else visit(full);
  }
}

let copied = 0;
walk(out, file => {
  const parts = relative(out, file).split(sep);
  const at = parts.findIndex(p => p.startsWith("__next."));
  if (at === -1 || at === parts.length - 1 || !file.endsWith(".txt")) return;
  const flat = parts.slice(at).join(".");
  copyFileSync(file, join(out, ...parts.slice(0, at), flat));
  copied++;
});
console.log(`flat-segments: ${copied} prefetch files copied`);
