// Screenshots the header so the design can be judged by eye.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nope'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(5195, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: '.browser/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: path.resolve('.browser/lib') },
});
const page = await browser.newPage({ deviceScaleFactor: 2 });
fs.mkdirSync('shots', { recursive: true });

// Desktop, scrolled: the active destination should carry the marker.
await page.setViewportSize({ width: 1440, height: 760 });
await page.goto('http://127.0.0.1:5195/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('.nav-links-in a[href="#smartprice"]').click();
await page.waitForTimeout(1400);
await page.screenshot({ path: 'shots/nav-scrolled.png' });
console.log('✓ shots/nav-scrolled.png');

// The auth modal: the tab ink must sit under the active tab.
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto('http://127.0.0.1:5195/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.click('#signInBtn');
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/auth-signin.png' });
await page.click('[data-authtab="signup"]');
await page.waitForTimeout(600);
await page.screenshot({ path: 'shots/auth-signup.png' });
console.log('✓ shots/auth-signin.png, shots/auth-signup.png');

// The phone drawer, with the actions that used to overflow.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto('http://127.0.0.1:5195/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.click('#menuBtn');
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/drawer.png' });
console.log('✓ shots/drawer.png');

await browser.close();
server.close();
