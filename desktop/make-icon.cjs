// Renders icon.svg to PNGs with the preinstalled Chromium, then writes a multi-size .ico.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const b = await chromium.launch();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="256" height="256"', `width="${s}" height="${s}"`)}</body></html>`);
    pngs.push(await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } }));
    await p.close();
  }
  await b.close();
  fs.mkdirSync(path.join(__dirname, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'assets', 'icon.png'), pngs[pngs.length - 1]);
  // ICO container with embedded PNGs (supported since Windows Vista).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((png, i) => {
    const s = sizes[i];
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16); dir.writeUInt8(s >= 256 ? 0 : s, i * 16 + 1);
    dir.writeUInt8(0, i * 16 + 2); dir.writeUInt8(0, i * 16 + 3);
    dir.writeUInt16LE(1, i * 16 + 4); dir.writeUInt16LE(32, i * 16 + 6);
    dir.writeUInt32LE(png.length, i * 16 + 8); dir.writeUInt32LE(offset, i * 16 + 12);
    offset += png.length;
  });
  fs.writeFileSync(path.join(__dirname, 'assets', 'icon.ico'), Buffer.concat([header, dir, ...pngs]));
  console.log('icons written');
})();
