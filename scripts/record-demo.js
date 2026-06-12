const { chromium } = require('playwright');

const OUT_DIR = '/tmp/ghosted-demo';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function injectZoomEffect(page) {
  await page.evaluate(() => {
    if (document.getElementById('__zoom_injected')) return;
    const marker = document.createElement('div');
    marker.id = '__zoom_injected';
    document.body.appendChild(marker);

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:hidden;';
    document.body.appendChild(overlay);

    let zoomTimeout;
    document.addEventListener('click', function(e) {
      // Ripple
      const dot = document.createElement('div');
      dot.style.cssText = `
        position:fixed;
        left:${e.clientX - 20}px;top:${e.clientY - 20}px;
        width:40px;height:40px;border-radius:50%;
        background:rgba(59,130,246,0.45);
        pointer-events:none;z-index:99999;
        transform:scale(0);opacity:1;
        transition:transform 0.3s ease-out,opacity 0.4s ease-out;
      `;
      overlay.appendChild(dot);
      requestAnimationFrame(() => { dot.style.transform = 'scale(1.8)'; dot.style.opacity = '0'; });
      setTimeout(() => dot.remove(), 500);

      // Zoom
      clearTimeout(zoomTimeout);
      const xp = (e.clientX / window.innerWidth  * 100).toFixed(1);
      const yp = (e.clientY / window.innerHeight * 100).toFixed(1);
      document.documentElement.style.cssText += `
        transition:transform 0.3s cubic-bezier(0.22,1,0.36,1);
        transform-origin:${xp}% ${yp}%;
        transform:scale(1.6);
      `;
      zoomTimeout = setTimeout(() => {
        document.documentElement.style.cssText += `
          transition:transform 0.5s cubic-bezier(0.22,1,0.36,1);
          transform:scale(1);
        `;
      }, 950);
    }, true);
  });
}

async function closeAnyModal(page) {
  try { await page.keyboard.press('Escape'); await sleep(300); } catch {}
}

async function navTo(page, href, waitFor) {
  await closeAnyModal(page);
  await page.goto(`http://localhost:5174${href}`, { waitUntil: 'networkidle', timeout: 15000 });
  if (waitFor) { try { await page.waitForSelector(waitFor, { timeout: 5000 }); } catch {} }
  await injectZoomEffect(page);
  await sleep(800);
}

async function clickEl(page, selector, waitMs = 1200) {
  try {
    await page.waitForSelector(selector, { timeout: 3000 });
    await page.click(selector, { timeout: 5000 });
    await sleep(waitMs);
  } catch { console.warn('skip click:', selector); }
}

async function hoverEl(page, selector, waitMs = 350) {
  try { await page.hover(selector, { timeout: 1500 }); await sleep(waitMs); } catch {}
}

async function scrollBy(page, dy) {
  await page.evaluate(y => window.scrollBy({ top: y, behavior: 'smooth' }), dy);
  await sleep(900);
}

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();

  await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => sessionStorage.removeItem('bypass-signed-out'));

  // ── Dashboard ──────────────────────────────────────────────────────────────
  await navTo(page, '/dashboard', 'h1, h2');
  await sleep(1000);
  await hoverEl(page, '[class*=card]:nth-child(1)', 500);
  await hoverEl(page, '[class*=card]:nth-child(2)', 500);
  await hoverEl(page, '[class*=card]:nth-child(3)', 500);
  await hoverEl(page, '[class*=card]:nth-child(4)', 500);
  await sleep(600);
  await scrollBy(page, 350);
  await scrollBy(page, 350);
  await scrollBy(page, -700);

  // ── Applications ──────────────────────────────────────────────────────────
  await navTo(page, '/applications', 'table tbody tr');
  await sleep(500);
  await clickEl(page, 'button:has-text("Screening")', 800);
  await clickEl(page, 'button:has-text("Phone Interview")', 800);
  await clickEl(page, 'button:has-text("Rejected")', 800);
  await clickEl(page, 'button:has-text("Active")', 800);
  const rows = page.locator('table tbody tr');
  const rowCount = Math.min(await rows.count(), 5);
  for (let i = 0; i < rowCount; i++) {
    try { await rows.nth(i).hover(); await sleep(300); } catch {}
  }
  await sleep(500);

  // ── Pipeline ──────────────────────────────────────────────────────────────
  await navTo(page, '/pipeline', '[class*=col], [class*=column]');
  await sleep(600);
  const cards = page.locator('[class*=card]');
  const cardCount = Math.min(await cards.count(), 8);
  for (let i = 0; i < cardCount; i++) {
    try { await cards.nth(i).hover(); await sleep(300); } catch {}
  }
  await page.evaluate(() => {
    const scroller = document.querySelector('main > div > div, [class*=board], [class*=columns]');
    if (scroller) scroller.scrollBy({ left: 600, behavior: 'smooth' });
  });
  await sleep(1200);

  // ── Analytics ─────────────────────────────────────────────────────────────
  await navTo(page, '/analytics', 'svg, canvas');
  await sleep(600);
  await scrollBy(page, 400);
  await scrollBy(page, 400);
  await scrollBy(page, -800);

  // ── Resumes ───────────────────────────────────────────────────────────────
  await navTo(page, '/resumes', 'table tbody tr');
  await sleep(500);
  const resumeRows = page.locator('table tbody tr');
  const rCount = Math.min(await resumeRows.count(), 3);
  for (let i = 0; i < rCount; i++) {
    try { await resumeRows.nth(i).hover(); await sleep(400); } catch {}
  }
  await sleep(600);

  // ── Email review ──────────────────────────────────────────────────────────
  await navTo(page, '/email-review', 'h1, h2');
  await sleep(2000);

  // ── Back to dashboard ─────────────────────────────────────────────────────
  await navTo(page, '/dashboard', 'h1, h2');
  await sleep(2500);

  await ctx.close();
  await browser.close();

  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.webm'));
  if (!files.length) { console.error('No webm found'); process.exit(1); }
  const webm = `${OUT_DIR}/${files[0]}`;
  const mp4  = '/var/home/macsa/dev/ghosted/screenshots/demo.mp4';

  const { execSync } = require('child_process');
  console.log('Converting to mp4…');
  execSync(`ffmpeg -y -i "${webm}" -c:v libx264 -crf 22 -preset fast -pix_fmt yuv420p "${mp4}"`, { stdio: 'inherit' });
  console.log('Done:', mp4);
})().catch(e => { console.error(e); process.exit(1); });
