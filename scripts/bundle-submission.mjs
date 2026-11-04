import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const distDir = join(root, "dist");
mkdirSync(distDir, { recursive: true });

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createZipArchive(files, outputPath) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const data = readFileSync(file.fullPath);
    const uncompressedSize = data.length;
    const crc = crc32(data);
    const compressedData = deflateRawSync(data);
    const compressedSize = compressedData.length;
    const nameBuf = Buffer.from(file.relPath, "utf-8");
    const unixMode = statSync(file.fullPath).mode & 0o777;

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed (2.0)
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(8, 8); // compression method (8 = deflate)
    localHeader.writeUInt16LE(0, 10); // file time
    localHeader.writeUInt16LE(0, 12); // file date
    localHeader.writeUInt32LE(crc, 14); // crc32
    localHeader.writeUInt32LE(compressedSize, 18); // compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressedData);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // version made by (Unix host, 2.0)
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flag
    centralHeader.writeUInt16LE(8, 10); // method (deflate)
    centralHeader.writeUInt16LE(0, 12); // time
    centralHeader.writeUInt16LE(0, 14); // date
    centralHeader.writeUInt32LE(crc, 16); // crc32
    centralHeader.writeUInt32LE(compressedSize, 20); // compressed size
    centralHeader.writeUInt32LE(uncompressedSize, 24); // uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // name len
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attr
    centralHeader.writeUInt32LE(((0o100000 | unixMode) << 16) >>> 0, 38); // external attr (unix mode)
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    offset += localHeader.length + compressedData.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) {
    centralDirSize += ch.length;
  }

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk start
  eocd.writeUInt16LE(files.length, 8); // entries on disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralDirSize, 12); // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16); // offset of central dir
  eocd.writeUInt16LE(0, 20); // comment len

  const finalZip = Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
  writeFileSync(outputPath, finalZip);
  return finalZip.length;
}

const includePaths = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/icon.png",
  ".claude-plugin/marketplace.json",
  "marketplace.json",
  ".mcp.json",
  "package.json",
  "README.md",
  "LICENSE",
  "agents/byzantine-auditor.md",
  "agents/incident-commander.md",
  "agents/dag-coordinator.md",
  "hooks/hooks.json",
  "output-styles/war-room-terse.md",
  "scripts/acr-mcp-bridge.cjs",
  "scripts/postguard-hook.cjs",
  "scripts/postguard-hook.sh",
  "skills/acr-room-collaboration/SKILL.md",
  "skills/acr-room-collaboration/references/etiquette.md",
  "skills/acr-identity-did/SKILL.md",
  "skills/acr-identity-did/references/did-specs.md",
  "skills/acr-consensus-gate/SKILL.md",
  "skills/acr-consensus-gate/references/bft-math.md",
  "skills/acr-atlas-dag/SKILL.md",
  "skills/acr-atlas-dag/references/dag-schema.md",
  "skills/acr-opsroom-incident/SKILL.md",
  "skills/acr-opsroom-incident/references/playbooks.md",
  "skills/acr-human-governance/SKILL.md",
  "skills/acr-human-governance/references/audit-rules.md",
];

const filesToBundle = includePaths.map((p) => ({
  fullPath: join(root, p),
  relPath: p,
}));

const zipPath = join(distDir, "acr-protocol-claude-plugin-v1.0.0.zip");
const bytesWritten = createZipArchive(filesToBundle, zipPath);

console.log(`Bundled ${filesToBundle.length} files into ${zipPath} (${bytesWritten} bytes)`);
