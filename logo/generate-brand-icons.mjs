import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const output = new URL("public/icons/", root);
await mkdir(output, { recursive: true });

const logo = await sharp(await readFile(new URL("logo/logo.png", root)))
  .resize(128, 128, { fit: "contain" })
  .png()
  .toBuffer();
await writeFile(new URL("logo-128.png", output), logo);

const source = await readFile(new URL("logo/logo2.png", root));
const sizes = [16, 32, 48, 180, 192, 512];
const images = new Map();
for (const size of sizes) {
  const image = await sharp(source).resize(size, size, { fit: "contain" }).png().toBuffer();
  images.set(size, image);
  const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
  await writeFile(new URL(name, output), image);
}

// ICO directory entries wrap the PNG images encoded by sharp.
const icoSizes = [16, 32, 48];
const directory = Buffer.alloc(6 + icoSizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(icoSizes.length, 4);
let offset = directory.length;
for (const [index, size] of icoSizes.entries()) {
  const entry = 6 + index * 16;
  const image = images.get(size);
  directory[entry] = size;
  directory[entry + 1] = size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.length;
}
await writeFile(new URL("public/favicon.ico", root), Buffer.concat([
  directory, ...icoSizes.map((size) => images.get(size)),
]));

await writeFile(new URL("public/site.webmanifest", root), JSON.stringify({
  name: "最终幻想14 自动配装器",
  short_name: "自动配装器",
  icons: [192, 512].map((size) => ({
    src: `/icons/icon-${size}.png`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose: "any",
  })),
  theme_color: "#101820",
  background_color: "#ffffff",
  display: "browser",
}, null, 2) + "\n");
