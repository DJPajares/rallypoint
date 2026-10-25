import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
// Run from apps/web. When the mark changes, bump the ?v= on the manifest's
// icon URLs too: installed apps and browsers otherwise keep the old picture.
await mkdir("public/icons", { recursive: true });
// Graphite tile, white "r", orange dot. The maskable icon keeps the mark inside
// the 80% safe zone so launchers can crop it to any shape.
const mark = (scale) => {
  const offset = (512 - 512 * scale) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})"><text x="150" y="362" font-family="Arial" font-size="340" font-weight="bold" fill="#ffffff">r</text><circle cx="332" cy="340" r="32" fill="#ff6b1a"/></g>`;
};
const svg = (scale) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#25282d"/>${mark(scale)}</svg>`,
  );
const png = (size, scale = 1) =>
  sharp(svg(scale)).resize(size, size).png().toBuffer();
// Manifest icons for installed apps.
for (const [name, size, scale] of [
  ["icon-192", 192, 1],
  ["icon-512", 512, 1],
  ["maskable-512", 512, 0.8],
])
  await writeFile(`public/icons/${name}.png`, await png(size, scale));
// Next.js app icons: the browser tab, the home-screen bookmark on iOS, and the
// /favicon.ico that crawlers and dashboards ask for. Next adds a content hash
// to icon and apple-icon links, so a new mark is never served from cache.
await writeFile("app/icon.png", await png(192));
await writeFile("app/apple-icon.png", await png(180));
// An .ico is a small directory of PNG images, one per size.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((size) => png(size)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + 16 * index;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
});
await writeFile("app/favicon.ico", Buffer.concat([header, ...images]));
