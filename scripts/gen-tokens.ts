// Writes src/styles/tokens.css from the M3 token generator (ADR 0009).
// Usage: npm run tokens
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../src/lib/m3/tokens.js";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "tokens.css");
fs.writeFileSync(out, renderTokensCss());
console.log("wrote", out);
