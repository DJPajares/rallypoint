import sharp from "sharp";
import { mkdir } from "node:fs/promises";
await mkdir("public/icons", { recursive: true });
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#234dc4"/><text x="146" y="355" font-family="Arial" font-size="330" font-weight="bold" fill="white">r</text><circle cx="340" cy="350" r="26" fill="#d6ed7d"/></svg>',
);
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["maskable-512", 512],
])
  await sharp(svg).resize(size, size).png().toFile(`public/icons/${name}.png`);
