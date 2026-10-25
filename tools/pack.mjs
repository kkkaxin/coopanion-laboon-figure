#!/usr/bin/env node
// Builds the importable Coopanion zip of this pack: `<packdir>-v<version>.zip`.
//
//   node tools/pack.mjs ["C:\path\to\out.zip"]
//
// Layout: one folder at the zip root (`dafayou/…`). The host's importer finds `figure.json` at
// most three levels down (`src/pack-import.ts`: PACK_DEPTH = 3), so the folder wrapper is safe and
// keeps a person's unzip tidy.
//
// Entries are stored, not deflated: the PNGs are already compressed and the text files are tiny.
// No third-party dependency; UTF-8 names are flagged (0x0800) like Windows' own zips.
//
// Prints the zip's size, entry count and sha256. Exit code 1 when the pack holds no figure.json.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packDir = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestFile = join(packDir, 'figure.json');
let manifest;
try { manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); } catch (e) {
  console.error(`cannot read ${manifestFile}: ${e.message}`);
  process.exit(1);
}
const out = resolve(process.argv[2] ?? join(dirname(packDir), `${basename(packDir)}-v${manifest.version ?? '0.0.0'}.zip`));

/* eslint-disable no-bitwise */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
// MS-DOS date/time, what a zip entry carries (local time, 2-second resolution).
const dos = (d) => ({
  date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
});

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === '.git') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.isFile()) files.push(full);
  }
};
walk(packDir);

const root = basename(packDir);
const locals = [];
const centrals = [];
let offset = 0;
for (const full of files) {
  const name = `${root}/${relative(packDir, full).split(sep).join('/')}`;
  const data = readFileSync(full);
  const { date, time } = dos(statSync(full).mtime);
  const crc = crc32(data);
  const utf8 = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);   // local file header
  local.writeUInt16LE(20, 4);           // version needed
  local.writeUInt16LE(0x0800, 6);       // UTF-8 names
  local.writeUInt16LE(0, 8);            // method 0 = store
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); // compressed
  local.writeUInt32LE(data.length, 22); // uncompressed
  local.writeUInt16LE(utf8.length, 26);
  local.writeUInt16LE(0, 28);           // extra

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // central directory header
  central.writeUInt16LE(20, 4);         // version made by
  central.writeUInt16LE(20, 6);         // version needed
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(utf8.length, 28);
  central.writeUInt16LE(0, 30);         // extra
  central.writeUInt16LE(0, 32);         // comment
  central.writeUInt16LE(0, 34);         // disk start
  central.writeUInt16LE(0, 36);         // internal attrs
  central.writeUInt32LE(0, 38);         // external attrs
  central.writeUInt32LE(offset, 42);    // local header offset

  locals.push(local, utf8, data);
  centrals.push(central, utf8);
  offset += local.length + utf8.length + data.length;
}

const cd = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const zip = Buffer.concat([...locals, cd, eocd]);
writeFileSync(out, zip);
console.log(`wrote ${out}`);
console.log(`  ${files.length} files, ${(zip.length / 1024).toFixed(0)} KiB`);
for (const f of files) console.log(`  + ${root}/${relative(packDir, f).split(sep).join('/')}`);
console.log(`  sha256 ${createHash('sha256').update(zip).digest('hex')}`);
