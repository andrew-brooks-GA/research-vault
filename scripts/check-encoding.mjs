import { readFileSync } from "node:fs";
import { runGit } from "../bin/lib/git.mjs";

const files = runGit(["ls-files", "*.md", "*.mjs", "*.json"], { timeout: 0, stderr: "inherit" }).split(/\r?\n/).filter(Boolean);
let bad = 0;
for (const f of files) {
  let b;
  try { b = readFileSync(f); } catch { continue; }
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) { console.error("BOM: " + f); bad++; }
  if (b.includes(0x0d)) { console.error("CRLF: " + f); bad++; }
  if (/\u00C3\u00A2\u00E2\u201A\u00AC/.test(b.toString("utf8"))) { console.error("MOJIBAKE: " + f); bad++; }
}
if (bad) { console.error(`encoding gate: ${bad} issue(s)`); process.exit(1); }
console.log("encoding ok");
