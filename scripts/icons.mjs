import sharp from "sharp";
import { mkdir } from "node:fs/promises";
await mkdir("public/icons", { recursive: true });
// Navy tile, white "r", neon dot. The maskable icon keeps the mark inside the
// 80% safe zone so launchers can crop it to any shape.
const mark = (scale) => {
  const offset = (512 - 512 * scale) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})"><text x="150" y="362" font-family="Arial" font-size="340" font-weight="bold" fill="#ffffff">r</text><circle cx="332" cy="340" r="32" fill="#c6f432"/></g>`;
};
const svg = (scale) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#13235b"/>${mark(scale)}</svg>`,
  );
for (const [name, size, scale] of [
  ["icon-192", 192, 1],
  ["icon-512", 512, 1],
  ["maskable-512", 512, 0.8],
])
  await sharp(svg(scale))
    .resize(size, size)
    .png()
    .toFile(`public/icons/${name}.png`);
