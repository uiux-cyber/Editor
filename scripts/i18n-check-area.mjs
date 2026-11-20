/**
 * Check translations for UI folders that are not in TRANSLATED yet.
 *
 *   node scripts/i18n-check-area.mjs <translations.json> <folder> [folder…]
 *
 * Folders are relative to src/renderer/src (e.g. ui/timeline). The JSON file holds the new
 * entries per language: { "es": { "English": "Español" }, "fr": {…}, "de": {…}, "pt-BR": {…}, "hi": {…} }.
 * Reports strings that no language file or the JSON translates, placeholder mismatches, empty
 * values, and JSON entries that the folders do not use. Exits 1 when anything is wrong.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractFile, loadLocale, localeCodes, SRC } from './i18n.mjs';

const [jsonPath, ...folders] = process.argv.slice(2);
if (!jsonPath || folders.length === 0) {
  console.error('usage: node scripts/i18n-check-area.mjs <translations.json> <folder> [folder…]');
  process.exit(2);
}
const { createJiti } = await import('jiti');
const { messageArguments } = await createJiti(import.meta.url).import(join(SRC, 'ui/i18n/format.ts'));

function walk(full) {
  if (statSync(full).isDirectory()) return readdirSync(full).flatMap((f) => walk(join(full, f)));
  return /\.(ts|tsx)$/.test(full) ? [full] : [];
}

const keys = new Set();
for (const f of folders) for (const file of walk(resolve(SRC, f))) extractFile(file).forEach((k) => keys.add(k));
const extra = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')) : {};

let problems = 0;
console.log(`${keys.size} source strings in ${folders.join(', ')}`);
for (const code of localeCodes()) {
  const base = loadLocale(code);
  const add = extra[code] ?? {};
  const missing = [...keys].filter((k) => !(k in base) && !(k in add));
  const bad = [];
  for (const [k, v] of Object.entries(add)) {
    const source = /^[a-z]+\|/.test(k) ? k.slice(k.indexOf('|') + 1) : k;
    if (typeof v !== 'string' || v.trim() === '') bad.push(`${k}: empty`);
    else if (messageArguments(source).join() !== messageArguments(v).join()) bad.push(`${k}: placeholders differ (${messageArguments(source)} vs ${messageArguments(v)})`);
  }
  const unused = Object.keys(add).filter((k) => !keys.has(k));
  problems += missing.length + bad.length + unused.length;
  console.log(`${code}: ${Object.keys(add).length} new, ${missing.length} missing, ${bad.length} invalid, ${unused.length} unused`);
  for (const k of missing) console.log(`  missing: ${k}`);
  for (const k of bad) console.log(`  invalid: ${k}`);
  for (const k of unused) console.log(`  unused:  ${k}`);
}
process.exit(problems ? 1 : 0);
