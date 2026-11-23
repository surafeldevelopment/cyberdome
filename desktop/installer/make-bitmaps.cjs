// Renders the installer side panel (164x314) and header (150x57) from HTML, saved as PNG.
// Converted to 24-bit BMP (the format NSIS needs) by the Python step in build docs.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const svg = fs.readFileSync(path.join(__dirname, '..', 'icon.svg'), 'utf8');
const mark = (s) => svg.replace('width="256" height="256"', `width="${s}" height="${s}"`);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 164, height: 314 }, deviceScaleFactor: 1 });
  await p.setContent(`<html><body style="margin:0;width:164px;height:314px;background:#050605;font-family:Segoe UI,Arial,sans-serif;position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.035),transparent 40%)"></div>
    <div style="position:absolute;left:0;right:0;top:0;height:1px;background:#1b201c"></div>
    <div style="position:absolute;left:22px;top:30px">${mark(46)}</div>
    <div style="position:absolute;left:22px;top:92px;color:#e6ebe7;font-size:19px;font-weight:600;letter-spacing:.2px">CyberDome</div>
    <div style="position:absolute;left:22px;top:118px;color:#9ba59e;font-size:11px">Command Center</div>
    <div style="position:absolute;left:22px;bottom:26px;right:18px;color:#5f6a63;font-size:10px;line-height:1.45">Evidence-driven assessment workspace. Runs locally on this computer.</div>
    <div style="position:absolute;left:22px;bottom:14px;width:26px;height:2px;background:#3dcc7e"></div>
  </body></html>`);
  await p.screenshot({ path: path.join(__dirname, 'welcome.png') });
  const h = await b.newPage({ viewport: { width: 150, height: 57 }, deviceScaleFactor: 1 });
  await h.setContent(`<html><body style="margin:0;width:150px;height:57px;background:#ffffff;display:flex;align-items:center;justify-content:flex-end;padding-right:14px;box-sizing:border-box">${mark(34)}</body></html>`);
  await h.screenshot({ path: path.join(__dirname, 'header.png') });
  await b.close();
})();
