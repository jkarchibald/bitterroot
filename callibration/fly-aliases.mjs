// Fly-name alias layer (Phase 8, build-step 1).
// canon(name) -> canonical string, or null if unknown.
// Match is punctuation/case/whitespace-insensitive so "Adam's" == "Adams",
// "Hare's Ear" == "hares ear", "Pheasant Tail Jig" stays distinct (only exact
// alias strings map). Compound rig strings ("Chubby + Prince") are NOT split
// here -- callers split on [/+] first, then canon() each atom.

import { readFileSync } from "node:fs";

export function normKey(s) {
  return String(s)
    .toLowerCase()
    .replace(/['’`.]/g, "")      // drop apostrophes / periods
    .replace(/[^a-z0-9]+/g, " ") // collapse punctuation to space
    .trim()
    .replace(/\s+/g, " ");
}

export function buildIndex(aliasJson) {
  const idx = new Map();
  for (const [canonical, rec] of Object.entries(aliasJson.canonical)) {
    for (const a of rec.aliases) {
      const k = normKey(a);
      if (idx.has(k) && idx.get(k) !== canonical) {
        throw new Error(`alias collision: "${a}" -> ${idx.get(k)} AND ${canonical}`);
      }
      idx.set(k, canonical);
    }
  }
  return idx;
}

export function loadAliases(path = new URL("./fly-aliases.json", import.meta.url)) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  const idx = buildIndex(json);
  const canon = (name) => idx.get(normKey(name)) ?? null;
  const inRig = new Set(
    Object.entries(json.canonical).filter(([, r]) => r.inRig).map(([c]) => c)
  );
  return { json, idx, canon, inRig };
}
