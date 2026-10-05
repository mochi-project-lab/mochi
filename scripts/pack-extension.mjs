// Packs extension/ into two store zips, pure Node (zlib + own CRC32/ZIP writer, no deps):
//   server/public-dl/mochi-extension.zip          Chrome Web Store + Edge Add-ons (manifest as is)
//   server/public-dl/mochi-extension-firefox.zip  Firefox Add-ons (manifest transformed for Gecko)
// Usage: node scripts/pack-extension.mjs
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'extension');
const OUT = join(here, '..', 'server', 'public-dl');
// Docs stay in the repo, not in the store package.
const SKIP = new Set(['README.md', 'STORE.md', '.DS_Store', 'Thumbs.db']);

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // version needed
    local.writeUInt16LE(0x0800, 6);   // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);         // made by
    cen.writeUInt16LE(20, 6);         // needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32); cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cenBuf, end]);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function firefoxManifest(m) {
  const f = JSON.parse(JSON.stringify(m));
  // Firefox MV3 runs the background as an event page with scripts, not a service worker.
  f.background = { scripts: ['common.js', 'background.js'] };
  // Firefox treats host access as a user-grantable permission; listing it lets the popup ask for it.
  f.host_permissions = ['http://*/*', 'https://*/*'];
  f.browser_specific_settings = {
    gecko: {
      id: 'mochi@mochipet',
      strict_min_version: '128.0',
      // AMO data consent (required for new add-ons): the domain of visited sites is checked for
      // phishing (browsingActivity); chat sends the page title/text you ask about (websiteContent).
      data_collection_permissions: {
        required: ['browsingActivity'],
        optional: ['websiteContent'],
      },
    },
  };
  delete f.minimum_chrome_version; // Chrome-only key, AMO linter warns on it
  return f;
}

mkdirSync(OUT, { recursive: true });
const files = walk(SRC);
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
const entries = (mf) => files.map((full) => {
  const name = relative(SRC, full).split(sep).join('/');
  const data = name === 'manifest.json' ? Buffer.from(JSON.stringify(mf, null, 2) + '\n') : readFileSync(full);
  return { name, data };
});

const chromeZip = zip(entries(manifest));
writeFileSync(join(OUT, 'mochi-extension.zip'), chromeZip);
const ffZip = zip(entries(firefoxManifest(manifest)));
writeFileSync(join(OUT, 'mochi-extension-firefox.zip'), ffZip);
console.log(`mochi-extension.zip ${chromeZip.length} bytes, mochi-extension-firefox.zip ${ffZip.length} bytes, ${files.length} files, v${manifest.version}`);
