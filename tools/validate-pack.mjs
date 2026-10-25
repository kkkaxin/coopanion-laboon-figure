#!/usr/bin/env node
// Validates a Coopanion figure pack the way Coopanion 0.2.8 reads it:
//   `src/packs.ts` (readManifest: manifest/api/id/axes/presets/vocab/sounds/can/moves/needs) and
//   `src/pack-import.ts` (zip import: thumb <= 1 MiB, whole import <= 128 MiB, images only).
// Plus this pack's own rule: the artwork referenced by figure.js must be 1269 x 1240 (ART_W x ART_H).
//
//   node tools/validate-pack.mjs "C:\path\to\pack"
//
// Prints every problem found; exits 1 when there is one.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const OPTION_ID = /^[a-z0-9]{1,24}$/;
const WORD_KINDS = new Set(['expression', 'motion']);
const NAME_BREAK = /[,，、\s【】<>＜＞]/;
const INLINE_TAG_MAX = 32;
const THUMB_MAX = 1024 * 1024;
const IMPORT_MAX = 128 * 1024 * 1024;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const PACK_SOUND_KINDS = ['move', 'touch', 'face', 'snore'];
const AUDIO_EXT = new Set(['.ogg', '.mp3', '.wav']);
const MOVES_MAX = 8;
const MOVE_PARAMS_MAX = 2;

const tools = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ? process.argv[2] : dirname(tools);
const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const inside = (p) => typeof p === 'string' && p !== '' && !p.startsWith('/') &&
  !p.split(/[\\/]/).includes('..') && !/^[a-z]+:/i.test(p) && !/[<>"\x00-\x1f]/.test(p);
const namesOf = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const [k, s] of Object.entries(v)) if (typeof s === 'string' && s.trim()) out[k] = s.trim();
  return Object.keys(out).length ? out : null;
};
const full = (p) => join(dir, ...p.split('/'));
const within = (p) => { const root = normalize(dir).replace(/[\\/]+$/, '') + sep; return normalize(full(p)).startsWith(root); };

// --- manifest ---------------------------------------------------------------------------------
const file = join(dir, 'figure.json');
if (!existsSync(file)) { console.error(`manifest not found: ${file}`); process.exit(1); }
let m;
try { m = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`bad JSON: ${e.message}`); process.exit(1); }

for (const key of ['manifest', 'api']) {
  const v = m[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v !== 2) fail(`${key} must be the integer 2, got ${JSON.stringify(v)}`);
}
if (typeof m.id !== 'string' || !ID.test(m.id)) fail(`id must match ${ID}, got ${JSON.stringify(m.id)}`);
if (m.id === 'coo') fail('id "coo" is reserved by the built-in body');
if (!namesOf(m.name)) fail('name needs at least one non-empty string, e.g. {"zh":"…","en":"…"}');
if (!namesOf(m.about)) fail('about needs at least one non-empty string (the bot reads it)');
if (!inside(m.entry)) fail(`entry must be a relative path inside the pack, got ${JSON.stringify(m.entry)}`);
else if (!existsSync(full(m.entry))) fail(`entry file is missing: ${m.entry}`);
if (typeof m.export !== 'string' || !m.export) fail('export must name the factory the entry module exports');
if (m.thumb !== undefined) {
  if (!inside(m.thumb)) fail(`thumb must be a relative path inside the pack, got ${JSON.stringify(m.thumb)}`);
  else if (!existsSync(full(m.thumb))) fail(`thumb file is missing: ${m.thumb}`);
  else {
    const ext = extname(m.thumb).toLowerCase();
    if (!IMAGE_EXT.has(ext)) fail(`thumb type ${ext} is not one the importer shows (png/jpg/jpeg/webp)`);
    const size = statSync(full(m.thumb)).size;
    if (size > THUMB_MAX) fail(`thumb is ${size} bytes; the importer drops one over ${THUMB_MAX}`);
    else notes.push(`thumb ${m.thumb}: ${(size / 1024).toFixed(0)} KiB (limit 1024 KiB)`);
  }
}

// axes
const axes = Array.isArray(m.axes) ? m.axes : [];
if (m.axes !== undefined && !Array.isArray(m.axes)) fail('axes must be an array');
for (const a of axes) {
  if (!namesOf(a?.name)) fail(`axis ${JSON.stringify(a?.id)} needs a name`);
  if (typeof a?.id !== 'string' || !ID.test(a.id)) fail(`axis id must match ${ID}, got ${JSON.stringify(a?.id)}`);
  if (!Array.isArray(a?.options) || !a.options.length) fail(`axis ${a?.id} needs at least one option`);
  for (const o of a?.options ?? []) {
    if (typeof o?.id !== 'string' || !OPTION_ID.test(o.id)) fail(`option id of axis ${a?.id} must match ${OPTION_ID}, got ${JSON.stringify(o?.id)}`);
    if (!namesOf(o?.name)) fail(`option ${JSON.stringify(o?.id)} of axis ${a?.id} needs a name`);
    if (o?.thumb !== undefined) {
      if (!inside(o.thumb)) fail(`option thumb must be inside the pack: ${JSON.stringify(o.thumb)}`);
      else if (!existsSync(full(o.thumb))) fail(`option thumb file is missing: ${o.thumb}`);
      else if (statSync(full(o.thumb)).size > THUMB_MAX) fail(`option thumb over 1024 KiB: ${o.thumb}`);
    }
  }
}
// presets
if (m.presets !== undefined && !Array.isArray(m.presets)) fail('presets must be an array');
for (const p of Array.isArray(m.presets) ? m.presets : []) {
  if (typeof p?.id !== 'string' || !ID.test(p.id)) fail(`preset id must match ${ID}, got ${JSON.stringify(p?.id)}`);
  if (!p?.pick || typeof p.pick !== 'object') fail(`preset ${JSON.stringify(p?.id)} needs a pick object`);
  for (const a of axes) {
    if (!a.options.some((o) => o.id === p.pick?.[a.id])) fail(`preset ${p.id} does not pick an option of axis ${a.id}`);
  }
}
// vocab
const vocab = m.vocab;
if (!Array.isArray(vocab)) fail('vocab must be an array');
const taken = new Set();
for (const w of Array.isArray(vocab) ? vocab : []) {
  const id = w?.id;
  if (typeof id !== 'string' || !ID.test(id)) { fail(`vocab id must match ${ID}, got ${JSON.stringify(id)}`); continue; }
  if (!WORD_KINDS.has(w.kind)) fail(`vocab ${id}: kind must be expression or motion, got ${JSON.stringify(w.kind)}`);
  for (const [lang, list] of Object.entries(w.names ?? {})) {
    if (!Array.isArray(list)) { fail(`vocab ${id}: names.${lang} must be an array`); continue; }
    for (const n of list) {
      if (typeof n !== 'string' || !n.trim()) fail(`vocab ${id}: empty name in ${lang}`);
      else if (n.length > INLINE_TAG_MAX) fail(`vocab ${id}: name "${n}" longer than ${INLINE_TAG_MAX}`);
      else if (NAME_BREAK.test(n)) fail(`vocab ${id}: name "${n}" holds a character that ends a word marker`);
    }
  }
  for (const n of [id, ...Object.values(w.names ?? {}).flat()]) {
    if (taken.has(n)) fail(`vocab name/id taken twice: ${n}`);
    taken.add(n);
  }
  if (!namesOf(w.about)) fail(`vocab ${id}: about needs at least one non-empty string`);
  if (typeof w.seconds !== 'number' || !(w.seconds > 0) || !Number.isFinite(w.seconds)) fail(`vocab ${id}: seconds must be a positive number`);
}
const count = (k) => Array.isArray(vocab) ? vocab.filter((w) => w.kind === k).length : 0;
notes.push(`vocab: ${Array.isArray(vocab) ? vocab.length : 0} words (${count('expression')} expressions, ${count('motion')} motions)`);

// sounds
if (m.sounds !== undefined) {
  if (!m.sounds || typeof m.sounds !== 'object' || Array.isArray(m.sounds)) fail('sounds must be an object');
  for (const [name, s] of Object.entries(m.sounds ?? {})) {
    if (!/^[a-z][a-zA-Z0-9-]{0,31}$/.test(name)) fail(`sound name ${JSON.stringify(name)} must be lowercase-camel`);
    if (!inside(s?.file)) fail(`sound ${name}: file must be inside the pack`);
    else if (!AUDIO_EXT.has(extname(s.file).toLowerCase())) fail(`sound ${name}: not an ogg/mp3/wav`);
    else if (!existsSync(full(s.file))) fail(`sound ${name}: file is missing: ${s.file}`);
    if (s?.kind !== undefined && !PACK_SOUND_KINDS.includes(s.kind)) fail(`sound ${name}: kind must be one of ${PACK_SOUND_KINDS.join(', ')}`);
    if (s?.volume !== undefined && (typeof s.volume !== 'number' || !(s.volume >= 0 && s.volume <= 1))) fail(`sound ${name}: volume must be 0–1`);
  }
}
if (m.can !== undefined && typeof m.can.walk !== 'boolean' && m.can.walk !== undefined) fail('can.walk must be a boolean');
if (m.moves !== undefined) {
  if (!Array.isArray(m.moves) || m.moves.length > MOVES_MAX) fail(`moves must be an array of at most ${MOVES_MAX}`);
  for (const mv of Array.isArray(m.moves) ? m.moves : []) {
    if (typeof mv?.id !== 'string' || !ID.test(mv.id)) fail(`move id must match ${ID}, got ${JSON.stringify(mv?.id)}`);
    if (!namesOf(mv?.name) || !namesOf(mv?.about)) fail(`move ${JSON.stringify(mv?.id)} needs name and about`);
    const ps = mv?.params ?? [];
    if (!Array.isArray(ps) || ps.length > MOVE_PARAMS_MAX) fail(`move ${mv?.id}: params must be an array of at most ${MOVE_PARAMS_MAX}`);
    for (const p of ps) {
      if (typeof p?.id !== 'string' || !/^[a-z][a-zA-Z0-9]{0,23}$/.test(p.id)) fail(`move ${mv?.id}: bad param id ${JSON.stringify(p?.id)}`);
      if (!namesOf(p?.about)) fail(`move ${mv?.id}: param ${p?.id} needs about`);
      if (typeof p?.min !== 'number' || typeof p?.max !== 'number' || !(p.min < p.max)) fail(`move ${mv?.id}: param ${p?.id} needs min < max`);
    }
  }
}
if (m.needs !== undefined && (!Array.isArray(m.needs) || m.needs.some((n) => n !== 'windows'))) fail('needs may only hold "windows"');

// total size the importer accepts
let total = 0;
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else total += statSync(p).size;
  }
};
walk(dir);
notes.push(`pack size: ${(total / 1048576).toFixed(2)} MiB (import limit 128 MiB)`);
if (total > IMPORT_MAX) fail(`pack is ${(total / 1048576).toFixed(1)} MiB; the importer accepts ${IMPORT_MAX / 1048576} MiB`);

// --- artwork referenced by the entry module ---------------------------------------------------
const entryText = existsSync(full(m.entry)) ? readFileSync(full(m.entry), 'utf8') : '';
if (entryText && !new RegExp(`export\\s+(async\\s+)?function\\s+${m.export}\\b`).test(entryText)) {
  fail(`entry ${m.entry} does not export function ${m.export}`);
}
const dims = (p) => {
  const b = readFileSync(p);
  if (b.length < 24 || b[0] !== 0x89 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const artW = /const ART_W = (\d+)/.exec(entryText);
const artH = /const ART_H = (\d+)/.exec(entryText);
if (!artW || !artH) notes.push('entry has no ART_W/ART_H constants; artwork size not checked');
for (const png of [...entryText.matchAll(/['"]([^'"]+\.png)['"]/g)].map((x) => x[1])) {
  if (!within(png)) { fail(`entry loads ${png}, which is not inside the pack`); continue; }
  if (!existsSync(full(png))) { fail(`entry loads missing file: ${png}`); continue; }
  const d = dims(full(png));
  if (!d) { fail(`entry loads ${png}, which is not a PNG`); continue; }
  if (artW && artH && (d.w !== Number(artW[1]) || d.h !== Number(artH[1]))) {
    fail(`artwork ${png} is ${d.w}x${d.h}; entry's ART_W x ART_H is ${artW[1]} x ${artH[1]}`);
  } else notes.push(`artwork ${png}: ${d.w}x${d.h}`);
}

// --- report -----------------------------------------------------------------------------------
console.log(`pack: ${dir}`);
console.log(`id: ${m.id}  version: ${m.version}  manifest/api: ${m.manifest}/${m.api}`);
for (const n of notes) console.log(`  ok  ${n}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nall checks passed');
