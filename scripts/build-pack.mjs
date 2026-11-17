#!/usr/bin/env node
/**
 * Builds a Kinora content pack (`*.kinorapack`) from a folder of JSON files.
 *
 *   node scripts/build-pack.mjs <folder> [output.kinorapack]
 *
 * The folder contains:
 *   pack.json                 id, name, packVersion, author, description (required)
 *   palettes.json             arrays of items, one file per kind — or a sub-folder per kind with
 *   fontPairs.json            one JSON file per item (e.g. templates/spotlight.json)
 *   filters.json
 *   textPresets.json
 *   transitions.json          shader items may use "glslFile": "name.glsl" (relative to the folder)
 *   effects.json              instead of an inline "glsl" string
 *   generators.json
 *   templates.json
 *
 * The output is a single JSON document (see docs/PACKS.md). This script checks the structure
 * (format, ids, duplicates, shader files); the app validates everything else — fonts, library
 * references, value ranges — and compiles every shader when the pack is installed. Run
 * `npm run check` to validate the bundled sample pack the same way.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const KINDS = ['palettes', 'fontPairs', 'filters', 'textPresets', 'transitions', 'effects', 'generators', 'templates'];
const SHADER_KINDS = new Set(['transitions', 'effects', 'generators']);
const PACK_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const ITEM_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MAX_BYTES = 8 * 1024 * 1024;

const [folderArg, outArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!folderArg) {
  console.error('Usage: node scripts/build-pack.mjs <folder> [output.kinorapack]');
  process.exit(2);
}
const folder = path.resolve(folderArg);
const errors = [];
const fail = (msg) => errors.push(msg);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`${path.relative(folder, file)}: ${err.message}`);
    return undefined;
  }
}

if (!existsSync(path.join(folder, 'pack.json'))) {
  console.error(`✖ ${folder} has no pack.json`);
  process.exit(1);
}
const meta = readJson(path.join(folder, 'pack.json')) ?? {};
const pack = { format: 'kinora-pack', version: 1 };
for (const key of ['id', 'name', 'packVersion', 'author', 'description']) if (meta[key] !== undefined) pack[key] = meta[key];
if (!PACK_ID.test(pack.id ?? '')) fail('pack.json: "id" must be 2..48 lower-case letters, digits or dashes');
if (typeof pack.name !== 'string' || !pack.name.trim()) fail('pack.json: "name" is required');

for (const kind of KINDS) {
  const items = [];
  const file = path.join(folder, `${kind}.json`);
  const dir = path.join(folder, kind);
  if (existsSync(file)) {
    const data = readJson(file);
    if (data !== undefined && !Array.isArray(data)) fail(`${kind}.json must contain an array`);
    else if (data) items.push(...data);
  }
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      const data = readJson(path.join(dir, name));
      if (Array.isArray(data)) items.push(...data);
      else if (data && typeof data === 'object') items.push(data);
    }
  }
  if (!items.length) continue;
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      fail(`${kind}: every item must be an object`);
      continue;
    }
    if (!ITEM_ID.test(item.id ?? '')) fail(`${kind}: id "${item.id}" must be 2..64 lower-case letters, digits or dashes`);
    if (seen.has(item.id)) fail(`${kind}: id "${item.id}" is used twice`);
    seen.add(item.id);
    if (SHADER_KINDS.has(kind) && item.glslFile !== undefined) {
      const src = path.resolve(folder, String(item.glslFile));
      if (!src.startsWith(folder + path.sep) || !existsSync(src)) fail(`${kind}/${item.id}: glslFile "${item.glslFile}" not found in the pack folder`);
      else item.glsl = readFileSync(src, 'utf8');
      delete item.glslFile;
    }
    if (SHADER_KINDS.has(kind) && typeof item.glsl !== 'string') fail(`${kind}/${item.id}: needs "glsl" or "glslFile"`);
  }
  pack[kind] = items;
}

if (!KINDS.some((k) => pack[k]?.length)) fail('the pack contains no items');

const text = JSON.stringify(pack, null, 2) + '\n';
if (Buffer.byteLength(text) > MAX_BYTES) fail(`the pack is larger than ${MAX_BYTES / 1024 / 1024} MB`);

if (errors.length) {
  console.error(`✖ ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const out = path.resolve(outArg ?? `${folder.replace(/[\\/]+$/, '')}.kinorapack`);
writeFileSync(out, text);
const counts = KINDS.filter((k) => pack[k]?.length).map((k) => `${pack[k].length} ${k}`).join(', ');
console.log(`✔ ${path.relative(process.cwd(), out)} — "${pack.name}" (${counts}), ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`);
