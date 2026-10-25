import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';

chromium.use(stealth());

/**
 * Helper: Sleep utility to replace deprecated Playwright waitForTimeout
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Helper: Normalize URLs to prevent duplicate crawls
 */
const normalizeUrl = (u) => {
  try {
    const parsed = new URL(u);
    return `${parsed.origin}${parsed.pathname.replace(/\/$/, '')}`;
  } catch (e) {
    return u;
  }
};

/**
 * Mode 1: Design System Token Extractor
 */
export async function extractDesignSystem(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await sleep(2000);

    const data = await page.evaluate(() => {
      const rgbToHex = (rgb) => {
        if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return null;
        const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
        if (!m) return rgb.startsWith('#') ? rgb : null;
        if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
        return '#' + [m[1], m[2], m[3]].map((x) => parseInt(x, 10).toString(16).padStart(2, '0')).join('').toUpperCase();
      };

      const cssVariables = {};
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule.style) {
              for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith('--') && !prop.startsWith('--tw-') && !prop.startsWith('--media-') && !prop.startsWith('--cue-')) {
                  cssVariables[prop] = rule.style.getPropertyValue(prop).trim();
                }
              }
            }
          }
        } catch (e) {}
      }

      const bgCounts = new Map();
      const textCounts = new Map();
      const fontFamilies = new Set();
      const borderRadii = new Set();
      const boxShadows = new Set();
      const backdropFilters = new Set();
      const transitions = new Set();
      const scale = {};

      for (const el of Array.from(document.querySelectorAll('*')).slice(0, 1500)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = window.getComputedStyle(el);

        const bg = rgbToHex(cs.backgroundColor);
        if (bg) bgCounts.set(bg, (bgCounts.get(bg) || 0) + 1);
        const txt = rgbToHex(cs.color);
        if (txt) textCounts.set(txt, (textCounts.get(txt) || 0) + 1);

        if (cs.fontFamily) fontFamilies.add(cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
        if (cs.borderRadius && cs.borderRadius !== '0px') borderRadii.add(cs.borderRadius);
        if (cs.boxShadow && cs.boxShadow !== 'none') boxShadows.add(cs.boxShadow);
        if (cs.backdropFilter && cs.backdropFilter !== 'none') backdropFilters.add(cs.backdropFilter);
        if (cs.transition && cs.transition !== 'all 0s ease 0s' && cs.transition !== 'none 0s ease 0s' && !cs.transition.startsWith('all 0s')) {
          transitions.add(cs.transition);
        }

        const tag = el.tagName.toLowerCase();
        if (['h1', 'h2', 'h3', 'p'].includes(tag) && !scale[tag]) {
          scale[tag] = { fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing };
        }
      }

      const svgs = Array.from(document.querySelectorAll('svg'))
        .filter((s) => { const r = s.getBoundingClientRect(); return r.width > 8 && r.width < 120 && r.height > 8 && r.height < 120; })
        .slice(0, 15)
        .map((s, idx) => ({ id: s.id || `icon-${idx + 1}`, html: s.outerHTML }));

      const topKeys = (map, n = 8) => Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

      return {
        meta: { url: window.location.href, title: document.title, extractedAt: new Date().toISOString() },
        colors: {
          bodyBackground: rgbToHex(window.getComputedStyle(document.body).backgroundColor) || '#090A0F',
          bodyText: rgbToHex(window.getComputedStyle(document.body).color) || '#F8FAFC',
          palette: Array.from(new Set([...topKeys(bgCounts), ...topKeys(textCounts)]))
        },
        typography: { fontFamilies: Array.from(fontFamilies).slice(0, 6), scale },
        tokens: {
          cssVariables,
          borderRadii: Array.from(borderRadii).slice(0, 8),
          boxShadows: Array.from(boxShadows).slice(0, 6),
          backdropFilters: Array.from(backdropFilters).slice(0, 4)
        },
        animations: { transitions: Array.from(transitions).slice(0, 12) },
        svgs
      };
    });

    await browser.close();
    return data;
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

/**
 * Mode 2: 9.5/10 High-Precision UI Replication Studio (--pick & --crawl)
 */
export async function interactivePickElement(url, outputDir, maxPages = 1) {
  await fs.mkdir(outputDir, { recursive: true });
  const assetsDir = path.join(outputDir, 'assets');
  const assets3dDir = path.join(assetsDir, '3d');
  await fs.mkdir(assets3dDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars',
      '--disable-features=Translate',
      '--window-size=1440,900'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  });

  const visited = new Set();
  const queue = [normalizeUrl(url)];
  const allPagesResults = [];
  let targetMaxPages = maxPages;

  while (queue.length > 0 && allPagesResults.length < targetMaxPages) {
    const currentUrl = queue.shift();
    const cleanUrl = normalizeUrl(currentUrl);

    if (visited.has(cleanUrl)) continue;
    visited.add(cleanUrl);

    const pageIndex = allPagesResults.length + 1;
    const isFirstPage = pageIndex === 1;

    const page = await context.newPage();

    await page.addInitScript(() => {
      window.__STEAL_SHADERS__ = [];
      const hookWebGL = (proto) => {
        if (!proto || !proto.shaderSource) return;
        const orig = proto.shaderSource;
        proto.shaderSource = function (shader, source) {
          try {
            if (typeof source === 'string' && source.length > 30 && window.__STEAL_SHADERS__.length < 10) {
              window.__STEAL_SHADERS__.push({ type: shader && shader._shaderType === 35632 ? 'fragment' : 'vertex', source: source.slice(0, 3000) });
            }
          } catch (e) {}
          return orig.apply(this, arguments);
        };
      };
      if (window.WebGLRenderingContext) hookWebGL(window.WebGLRenderingContext.prototype);
      if (window.WebGL2RenderingContext) hookWebGL(window.WebGL2RenderingContext.prototype);
    });

    const capturedAssets = { fonts: [], models3d: [], externalCssTexts: [] };

    page.on('response', async (response) => {
      try {
        const reqUrl = response.url();
        const status = response.status();
        if (status < 200 || status >= 300) return;

        const cleanPath = reqUrl.split('?')[0].toLowerCase();
        const contentType = (response.headers()['content-type'] || '').toLowerCase();

        if (cleanPath.endsWith('.css') || contentType.includes('text/css')) {
          try {
            const txt = await response.text();
            if (txt && capturedAssets.externalCssTexts.length < 30) capturedAssets.externalCssTexts.push(txt);
          } catch (e) {}
        }

        if (['.glb', '.gltf', '.hdr', '.exr', '.obj', '.riv', '.splinecode'].some((ext) => cleanPath.endsWith(ext))) {
          const fileName = path.basename(cleanPath);
          const buf = await response.body();
          await fs.writeFile(path.join(assets3dDir, fileName), buf);
          capturedAssets.models3d.push({ fileName, originalUrl: reqUrl, localPath: './assets/3d/' + fileName });
        }

        if (cleanPath.endsWith('.woff2') && capturedAssets.fonts.length < 12) {
          const fileName = path.basename(cleanPath);
          const buf = await response.body();
          await fs.writeFile(path.join(assetsDir, fileName), buf);
          capturedAssets.fonts.push({ fileName, originalUrl: reqUrl, localPath: './assets/' + fileName });
        }
      } catch (e) {}
    });

    try {
      console.log(`🌐 [${pageIndex}/${targetMaxPages}] Navigating to ${currentUrl}...`);
      await page.goto(currentUrl, { waitUntil: 'load', timeout: 60000 });
      await sleep(3000);
    } catch (err) {
      console.log('⚠️ Navigation failed: ' + err.message);
      await page.close().catch(()=>{});
      continue;
    }

    let selectionInfo = { isFullPage: true, crawlCount: targetMaxPages, tagName: 'full-webpage' };

    // Interactive picker UI for the first page if manually picking
    if (isFirstPage && maxPages === 1) {
      let resolvePick;
      const pickPromise = new Promise((resolve) => { resolvePick = resolve; });
      await page.exposeFunction('__onStealElementPicked', (payload) => { resolvePick(payload); });

      await page.evaluate(() => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #A855F7;background:rgba(168,85,247,0.12);border-radius:8px;transition:all 0.05s ease-out;box-shadow:0 0 24px rgba(168,85,247,0.55);';
        document.body.appendChild(overlay);

        const topBar = document.createElement('div');
        topBar.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#090A0F;color:#F8FAFC;padding:8px 16px;border-radius:9999px;font-family:system-ui;font-size:13px;border:1px solid #A855F7;display:flex;align-items:center;gap:14px;white-space:nowrap;box-shadow:0 10px 30px rgba(0,0,0,0.85);';
        
        const badgeText = document.createElement('span');
        badgeText.innerText = '⚡ Hover UI & Click | Press ↑/↓ to adjust parent';

        const fullPageBtn = document.createElement('button');
        fullPageBtn.innerText = '🌐 Steal Entire Webpage (9.5/10)';
        fullPageBtn.style.cssText = 'background:linear-gradient(135deg,#7C3AED,#EC4899);color:white;border:none;padding:6px 14px;border-radius:9999px;font-weight:700;font-size:12px;cursor:pointer;';

        const crawlSiteBtn = document.createElement('button');
        crawlSiteBtn.innerText = '🕸️ Crawl 5 Pages (Full-Site)';
        crawlSiteBtn.style.cssText = 'background:linear-gradient(135deg,#059669,#10B981);color:white;border:none;padding:6px 14px;border-radius:9999px;font-weight:700;font-size:12px;cursor:pointer;';

        topBar.appendChild(badgeText);
        topBar.appendChild(fullPageBtn);
        topBar.appendChild(crawlSiteBtn);
        document.body.appendChild(topBar);

        let currentTarget = null;
        const getSmartContainer = (el) => {
          if (!el) return null;
          let curr = el;
          const rawMediaTags = ['VIDEO', 'SOURCE', 'SVG', 'PATH', 'G', 'IMG', 'CANVAS', 'SPAN', 'I'];
          while (curr && rawMediaTags.includes(curr.tagName) && curr.parentElement && curr.parentElement !== document.body) {
            curr = curr.parentElement;
          }
          return curr;
        };

        const updateHighlight = (el) => {
          if (!el || el === overlay || topBar.contains(el) || el === document.body || el === document.documentElement) return;
          currentTarget = el;
          const r = el.getBoundingClientRect();
          overlay.style.top = r.top + 'px';
          overlay.style.left = r.left + 'px';
          overlay.style.width = r.width + 'px';
          overlay.style.height = r.height + 'px';
          badgeText.innerText = `⚡ <${el.tagName.toLowerCase()}> (${Math.round(r.width)}×${Math.round(r.height)}px) | ↑/↓ Resize`;
        };

        window.addEventListener('mousemove', (e) => {
          const rawEl = document.elementFromPoint(e.clientX, e.clientY);
          if (rawEl && topBar.contains(rawEl)) return;
          updateHighlight(getSmartContainer(rawEl));
        }, true);

        window.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowUp' && currentTarget && currentTarget.parentElement && currentTarget.parentElement !== document.documentElement) {
            e.preventDefault(); updateHighlight(currentTarget.parentElement);
          } else if (e.key === 'ArrowDown' && currentTarget && currentTarget.firstElementChild) {
            e.preventDefault(); updateHighlight(currentTarget.firstElementChild);
          }
        }, true);

        const finalizeSelection = (target, isFullPage, crawlCount = 1) => {
          overlay.remove(); topBar.remove();
          document.querySelectorAll('[data-steal-picked]').forEach((el) => el.removeAttribute('data-steal-picked'));
          target.setAttribute('data-steal-picked', 'true');
          window.__onStealElementPicked({ isFullPage, crawlCount, tagName: isFullPage ? 'full-webpage' : target.tagName.toLowerCase() });
        };

        fullPageBtn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          fullPageBtn.innerText = '⏳ Hydrating Sections...';
          finalizeSelection(document.body, true, 1);
        }, true);

        crawlSiteBtn.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          crawlSiteBtn.innerText = '⏳ Starting Multi-Page Crawl...';
          finalizeSelection(document.body, true, 5);
        }, true);

        window.addEventListener('click', (e) => {
          if (topBar.contains(e.target)) return;
          e.preventDefault(); e.stopPropagation();
          const target = currentTarget || getSmartContainer(document.elementFromPoint(e.clientX, e.clientY));
          if (!target) return;
          finalizeSelection(target, false, 1);
        }, true);
      });

      selectionInfo = await pickPromise;
      if (selectionInfo.crawlCount && selectionInfo.crawlCount > 1) {
        targetMaxPages = selectionInfo.crawlCount;
      }
    } else {
      await page.evaluate(() => document.body.setAttribute('data-steal-picked', 'true'));
    }

    // Scroll Hydration for lazy-loaded content
    if (selectionInfo.isFullPage) {
      console.log(`🔄 Hydrating page ${pageIndex} (Hardware Wheel + Inner Scroll Containers)...`);
      await page.mouse.move(720, 450);

      for (let step = 0; step < 18; step++) {
        await page.mouse.wheel(0, 750);
        await page.evaluate((idx) => {
          window.scrollBy(0, 750);
          document.querySelectorAll('main, [data-scroll-container], [class*="scroll"], div').forEach((el) => {
            if (el.scrollHeight > el.clientHeight + 200) el.scrollTop += 750;
          });
          const sections = document.querySelectorAll('section, footer, main > div, body > div > div');
          if (sections[idx]) {
            try { sections[idx].scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) {}
          }
        }, step);
        await sleep(180);
      }

      await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.querySelectorAll('main, [data-scroll-container], div').forEach((el) => {
          if (el.scrollTop > 0) el.scrollTop = 0;
        });
      });
      await sleep(600);
    }

    if (isFirstPage) {
      const referenceCropPath = path.join(outputDir, 'reference-crop.png');
      try {
        const pickedLocator = page.locator('[data-steal-picked="true"]').first();
        await pickedLocator.scrollIntoViewIfNeeded({ timeout: 2000 });
        if (!selectionInfo.isFullPage) {
          await pickedLocator.screenshot({ path: referenceCropPath });
        } else {
          await page.screenshot({ path: referenceCropPath, fullPage: true });
        }
      } catch (e) {}
    }

    const pickedData = await page.evaluate(
      ({ isFullPage, externalCssList }) => {
        const target = document.querySelector('[data-steal-picked="true"]') || document.body;
        const targetRect = target.getBoundingClientRect();

        const canvasExports = [];
        document.querySelectorAll('canvas').forEach((canvas, idx) => {
          try {
            if (canvas.width < 10 || canvas.height < 10) return;
            const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
            if (dataUrl === 'data:,') return;
            const filename = `canvas-export-${idx + 1}.jpg`;
            canvasExports.push({ filename, dataUrl });
            canvas.setAttribute('data-stealth-canvas-export', filename);
          } catch (err) {}
        });

        const toAbs = (relUrl) => {
          if (!relUrl || relUrl.startsWith('data:') || relUrl.startsWith('blob:')) return relUrl;
          try { return new URL(relUrl, window.location.href).href; } catch (e) { return relUrl; }
        };

        const internalLinks = [];
        document.querySelectorAll('a[href]').forEach((a) => {
          const rawHref = a.getAttribute('href');
          if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) return;
          try {
            const parsed = new URL(rawHref, window.location.href);
            if (parsed.hostname === window.location.hostname && !/\.(pdf|zip|png|jpg|svg|mp4)$/i.test(parsed.pathname)) {
              internalLinks.push(parsed.href.split('#')[0]);
            }
          } catch (e) {}
        });

        document.querySelectorAll('img, video, audio, source, iframe, a').forEach((node) => {
          const dataSrc = node.getAttribute('data-src') || node.getAttribute('data-lazy-src');
          if (dataSrc && !node.getAttribute('src')) node.setAttribute('src', toAbs(dataSrc));
          if (node.src) node.setAttribute('src', toAbs(node.getAttribute('src')));
          if (node.currentSrc && (node.tagName === 'IMG' || node.tagName === 'VIDEO')) node.setAttribute('src', toAbs(node.currentSrc));
          if (node.href && node.tagName === 'A') node.setAttribute('href', toAbs(node.getAttribute('href')));
          node.removeAttribute('loading'); node.removeAttribute('srcset');
        });

        const mediaSeen = new Set();
        const visibleMediaAssets = [];
        target.querySelectorAll('img, video, picture source').forEach((el) => {
          const r = el.getBoundingClientRect();
          let src = el.currentSrc || el.src || el.getAttribute('src');
          if (!src && el.tagName === 'VIDEO') {
            const sourceChild = el.querySelector('source');
            if (sourceChild) src = sourceChild.src || sourceChild.getAttribute('src');
          }
          if (src) {
            const absSrc = toAbs(src);
            if (!mediaSeen.has(absSrc) && !absSrc.startsWith('data:') && !absSrc.includes('analytics.twitter.com') && !absSrc.includes('t.co/')) {
              mediaSeen.add(absSrc);
              visibleMediaAssets.push({
                tag: el.tagName.toLowerCase() === 'source' ? 'video/picture' : el.tagName.toLowerCase(),
                src: absSrc,
                alt: el.alt || el.getAttribute('aria-label') || '',
                dimensions: r.width > 0 ? `${Math.round(r.width)}x${Math.round(r.height)}px` : 'responsive'
              });
            }
          }
        });

        const resolvedVars = {};
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            for (const rule of Array.from(sheet.cssRules || [])) {
              if (rule.style) {
                for (let i = 0; i < rule.style.length; i++) {
                  const prop = rule.style[i];
                  if (prop.startsWith('--') && !resolvedVars[prop] && !['--tw-', '--media-', '--vp-'].some(p => prop.startsWith(p))) {
                    const val = rule.style.getPropertyValue(prop).trim();
                    if (val) resolvedVars[prop] = val;
                  }
                }
              }
            }
          } catch (e) {}
        }

        const keyframesMap = new Map();
        const fluidRules = new Set();
        const cssomRules = [];

        for (const sheet of Array.from(document.styleSheets)) {
          try {
            for (const rule of Array.from(sheet.cssRules || [])) {
              const text = rule.cssText || '';
              // Strip generic tailwind libraries so prompts don't hit max tokens
              const isTailwindDump = text.includes('@layer utilities') || text.includes('@layer theme') || text.length > 800;

              if (!sheet.href && !isTailwindDump) cssomRules.push(text);
              if (rule.type === CSSRule.KEYFRAMES_RULE && !rule.name.startsWith('vds-')) keyframesMap.set(rule.name, text);
              if (!isTailwindDump && /(clamp|grid-cols|aspect-)/.test(text) && fluidRules.size < 35) fluidRules.add(text.trim());
            }
          } catch (e) {}
        }

        for (const raw of externalCssList || []) {
          const matches = raw.matchAll(/@(?:-webkit-)?keyframes\s+([a-zA-Z0-9_-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g);
          for (const m of matches) if (!m[1].startsWith('vds-')) keyframesMap.set(m[1], m[0]);
        }

        const cssVarsArray = Object.entries(resolvedVars).map(([k, v]) => `${k}: ${v};`);
        cssomRules.unshift(`:root {\n  ${cssVarsArray.join('\n  ')}\n}`);

        // Get realistic body background for isolated component previews
        const bodyCs = window.getComputedStyle(document.body);
        const bodyBg = bodyCs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? bodyCs.backgroundColor : '#ffffff';

        const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'TEMPLATE', 'IFRAME']);
        let nodeCount = 0;
        const MAX_TOTAL_NODES = isFullPage ? 6500 : 1800;

        const serializeNode = (el, parentCs = null, depth = 0) => {
          if (!el || nodeCount > MAX_TOTAL_NODES || depth > 28) return '';
          if (el.nodeType === Node.TEXT_NODE) {
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            if (text.includes('mmMwWLliI0fiflO') || /^(word\s+){5,}/i.test(text)) return '';
            return text ? '  '.repeat(depth) + text : '';
          }
          if (el.nodeType !== Node.ELEMENT_NODE) return '';
          if (SKIP_TAGS.has(el.tagName)) return '';

          const tag = el.tagName.toLowerCase();
          const r = el.getBoundingClientRect();
          const cs = window.getComputedStyle(el);

          if (el.id && el.id.startsWith('uw-')) return '';
          if (cs.display === 'none' && !['SECTION', 'FOOTER', 'MAIN', 'ARTICLE'].includes(el.tagName)) return '';

          if (tag === 'svg') {
            nodeCount++;
            if (r.width <= 80 && el.innerHTML.length < 1800) return '  '.repeat(depth) + el.outerHTML.replace(/\s+/g, ' ').trim();
            return '  '.repeat(depth) + `<svg width="${Math.round(r.width || 24)}" height="${Math.round(r.height || 24)}" viewBox="${el.getAttribute('viewBox') || '0 0 24 24'}"></svg>`;
          }

          let semanticAttrs = '';
          if (el.id && !el.id.startsWith('radix-')) semanticAttrs += ` id="${el.id}"`;
          if (tag === 'a' && el.getAttribute('href')) semanticAttrs += ` href="${toAbs(el.getAttribute('href'))}"`;
          if (tag === 'video') {
            const vSrc = el.currentSrc || el.src || (el.querySelector('source') ? el.querySelector('source').src : '');
            if (vSrc) semanticAttrs += ` src="${toAbs(vSrc)}" autoplay loop muted playsinline`;
          }

          const keyStyles = [];
          const inheritableProps = ['font-family', 'font-weight', 'color'];
          const layoutProps = ['padding', 'margin', 'gap', 'border-radius', 'display', 'flex-direction', 'justify-content', 'align-items', 'grid-template-columns', 'position', 'box-shadow'];

          layoutProps.forEach((prop) => {
            let val = cs.getPropertyValue(prop);
            if (val && val !== '0px' && val !== 'none' && val !== 'normal' && val !== 'auto' && val !== 'block' && !val.startsWith('0px none')) {
              if (prop === 'margin') {
                const mMatch = val.match(/^([\d.]+px)\s+([\d.]+)px(?:\s+([\d.]+px)\s+([\d.]+)px)?$/);
                if (mMatch && parseFloat(mMatch[2]) > 180) val = `${mMatch[1]} auto`;
              }
              if (prop === 'grid-template-columns' && val.includes('px')) {
                const colCount = val.trim().split(/\s+/).length;
                if (colCount > 1) val = `repeat(${colCount}, minmax(0, 1fr))`;
              }
              keyStyles.push(`${prop}:${val}`);
            }
          });

          inheritableProps.forEach((prop) => {
            let val = cs.getPropertyValue(prop);
            const parentVal = parentCs ? parentCs.getPropertyValue(prop) : null;
            if (val && val !== parentVal && val !== 'normal') {
              if (prop === 'font-family') val = val.split(',')[0].replace(/['"]/g, '').trim();
              keyStyles.push(`${prop}:${val}`);
            }
          });

          const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null;
          if (bg) keyStyles.push('bg:' + bg);

          let attrs = semanticAttrs + (keyStyles.length ? ` data-computed="${keyStyles.join('; ')}"` : '');

          if (tag === 'img') {
            nodeCount++;
            return '  '.repeat(depth) + `<img src="${toAbs(el.currentSrc || el.src)}" alt="${el.alt || ''}" width="${Math.round(r.width)}" height="${Math.round(r.height)}"${attrs} />`;
          }

          const childrenList = Array.from(el.childNodes).map((c) => serializeNode(c, cs, depth + 1)).filter(Boolean);
          if (childrenList.length === 0 && !['video', 'canvas', 'input'].includes(tag) && !bg) return '';

          nodeCount++;
          return '  '.repeat(depth) + `<${tag}${attrs}>\n${childrenList.join('\n')}\n` + '  '.repeat(depth) + `</${tag}>`;
        };

        const pageSectionsSummary = Array.from(target.querySelectorAll('header, main > *, section, footer'))
          .map((sec, idx) => {
            const h = sec.querySelector('h1, h2, h3');
            const r = sec.getBoundingClientRect();
            if (r.height < 20) return null;
            return `${idx + 1}. <${sec.tagName.toLowerCase()}${sec.id ? '#' + sec.id : ''}> (${Math.round(r.width)}x${Math.round(r.height)}px) — Heading: "${h ? h.innerText.replace(/\s+/g, ' ').trim().slice(0, 70) : 'Content'}"`;
          }).filter(Boolean);

        const headLinksHtml = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((el) => el.outerHTML).join('\n');
        const globalSvgDefs = Array.from(document.querySelectorAll('svg defs')).map((d) => `<svg style="width:0;height:0;position:absolute;overflow:hidden;" aria-hidden="true">${d.outerHTML}</svg>`).join('\n');

        return {
          url: window.location.href,
          title: document.title || window.location.pathname,
          internalLinks: Array.from(new Set(internalLinks)),
          isFullPage,
          bodyBg,
          tagName: isFullPage ? 'full-webpage' : target.tagName.toLowerCase(),
          htmlAttrs: Array.from(document.documentElement.attributes).map((a) => `${a.name}="${a.value}"`).join(' '),
          bodyAttrs: Array.from(document.body.attributes).map((a) => `${a.name}="${a.value}"`).join(' '),
          headLinksHtml,
          cssomDump: cssomRules.join('\n'),
          preservedBodyHtml: globalSvgDefs + '\n' + (isFullPage ? document.body.innerHTML : target.outerHTML),
          pageSectionsSummary,
          visibleMediaAssets: visibleMediaAssets.slice(0, 60),
          resolvedVars,
          keyframes: Array.from(keyframesMap.values()).slice(0, 25),
          fluidRules: Array.from(fluidRules).slice(0, 25),
          annotatedDomBlueprint: serializeNode(target, null, 0),
          canvasExports
        };
      },
      { isFullPage: selectionInfo.isFullPage, externalCssList: capturedAssets.externalCssTexts }
    );

    pickedData.capturedAssets = capturedAssets;
    await page.close().catch(() => {});

    // Enqueue discovered internal links if multi-page crawl is active
    if (targetMaxPages > 1) {
      for (const link of pickedData.internalLinks) {
        const cleanCandidate = normalizeUrl(link);
        if (!visited.has(cleanCandidate) && !queue.includes(cleanCandidate)) queue.push(cleanCandidate);
      }
    }

    for (const canvasData of pickedData.canvasExports) {
      if (canvasData.dataUrl) {
        const base64Data = canvasData.dataUrl.replace(/^data:image\/jpeg;base64,/, '');
        await fs.writeFile(path.join(outputDir, `page-${pageIndex}-${canvasData.filename}`), base64Data, 'base64');
      }
    }

    const stageFileName = pageIndex === 1 ? 'isolated-stage.html' : `isolated-stage-${pageIndex}.html`;
    const stageFilePath = path.join(outputDir, stageFileName);
    
    // Dynamically center components if not grabbing the full page
    const previewBody = pickedData.isFullPage 
      ? pickedData.preservedBodyHtml 
      : `<div style="display:flex; justify-content:center; align-items:center; min-height:100vh; padding:40px; box-sizing:border-box; overflow:hidden; position:relative;">${pickedData.preservedBodyHtml}</div>`;

    const isolatedStageHtml = [
      '<!DOCTYPE html>',
      '<html ' + pickedData.htmlAttrs + '>',
      '<head>',
      '  <meta charset="UTF-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '  <base href="' + pickedData.url + '" />',
      pickedData.headLinksHtml,
      '  <style>',
      '    *, *::before, *::after { box-sizing: border-box; }',
      `    html, body { width: 100%; max-width: 100%; overflow-x: hidden !important; margin: 0; padding: 0; background: ${pickedData.bodyBg}; }`,
      '    .ticker-wrap, [class*="ticker"], [class*="marquee"] { overflow: hidden !important; max-width: 100vw !important; }',
      pickedData.cssomDump,
      pickedData.keyframes.join('\n'),
      '  </style>',
      '</head>',
      `<body ${pickedData.isFullPage ? pickedData.bodyAttrs : ''}>`,
      previewBody,
      '</body>',
      '</html>'
    ].join('\n');
    await fs.writeFile(stageFilePath, isolatedStageHtml, 'utf-8');

    const varEntries = Object.entries(pickedData.resolvedVars);
    const formattedVars = varEntries.length ? varEntries.map(([k, v]) => `  ${k}: ${v};`).join('\n') : '  /* Fallback to computed styles inside DOM */';

    const pagePrompt = [
      `# STEALTHISSTACK v5.9 BLUEPRINT (PAGE ${pageIndex})`,
      `Target URL: ${pickedData.url}`,
      `Scope: ${pickedData.isFullPage ? 'FULL WEBPAGE' : 'COMPONENT'}`,
      '',
      '## 0. PAGE ARCHITECTURE MAP:',
      pickedData.pageSectionsSummary.length ? pickedData.pageSectionsSummary.join('\n') : '1. Full Component Hierarchy',
      '',
      '## 1. BRAND DESIGN TOKENS:',
      '```css\n:root {\n' + formattedVars + '\n}\n```',
      '',
      '## 2. MEDIA ASSETS:',
      JSON.stringify(pickedData.visibleMediaAssets, null, 2),
      '',
      '## 3. ANIMATIONS:',
      '```css\n' + (pickedData.keyframes.length ? pickedData.keyframes.join('\n\n') : '/* Transitions defined inline */') + '\n```',
      '',
      '## 4. LAYOUT RULES:',
      '```css\n' + (pickedData.fluidRules.length ? pickedData.fluidRules.join('\n') : '/* Standard layout rules */') + '\n```',
      '',
      '## 5. FULL DOM BLUEPRINT:',
      '```html\n' + (pickedData.annotatedDomBlueprint || pickedData.preservedBodyHtml) + '\n```'
    ].join('\n');

    allPagesResults.push({
      pageIndex,
      url: pickedData.url,
      pathname: new URL(pickedData.url).pathname || '/',
      stageFileName,
      stageFilePath,
      pickedData,
      pagePrompt
    });
  }

  await browser.close().catch(() => {});

  const primaryResult = allPagesResults[0];
  const combinedMultiPagePrompt = allPagesResults.map((r) => r.pagePrompt).join('\n\n================================================================================\n\n');

  const escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const pageTabsHtml = allPagesResults.length > 1
    ? `<div class="page-tabs">` +
      allPagesResults.map((r, i) => `<button class="page-tab ${i === 0 ? 'active' : ''}" onclick="switchPage(${i}, '${r.stageFileName}', this)">📄 Page ${r.pageIndex}: ${r.pathname.slice(0, 24)}</button>`).join('') +
      `</div>`
    : '';

  const perPageTextareasHtml = allPagesResults.map((r, i) => `<textarea id="page-prompt-${i}" style="display:none;">${escapeHtml(r.pagePrompt)}</textarea>`).join('\n');

  const studioFilePath = path.join(outputDir, 'picked-component.html');
  const studioHtml = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    `  <title>StealThisStack v5.9 Studio — ${allPagesResults.length} Page(s)</title>`,
    '  <style>',
    '    * { box-sizing: border-box; }',
    '    body { margin: 0; height: 100vh; display: flex; flex-direction: column; background: #090D16; color: #F8FAFC; font-family: system-ui, sans-serif; overflow: hidden; }',
    '    header { height: 54px; background: #0F172A; border-bottom: 1px solid #1E293B; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; font-size: 13px; flex-shrink: 0; }',
    '    .brand { font-weight: 700; color: #A855F7; display: flex; align-items: center; gap: 10px; }',
    '    .meta { color: #94A3B8; font-weight: 400; font-family: monospace; font-size: 12px; }',
    '    .page-tabs { background: #1E293B; padding: 6px 20px; display: flex; gap: 8px; overflow-x: auto; border-bottom: 1px solid #334155; }',
    '    .page-tab { background: #0F172A; color: #94A3B8; border: 1px solid #334155; padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap; }',
    '    .page-tab.active { background: #7C3AED; color: white; border-color: #A855F7; }',
    '    .viewport-controls { display: flex; gap: 6px; align-items: center; }',
    '    .viewport-controls button, .viewport-controls a { background: #1E293B; color: #E2E8F0; border: 1px solid #334155; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; text-decoration: none; }',
    '    .viewport-controls button:hover, .viewport-controls a:hover { border-color: #A855F7; color: white; }',
    '    main { flex: 1; display: flex; justify-content: center; align-items: stretch; padding: 12px 12px 105px 12px; overflow: hidden; }',
    '    #stage-frame { width: 100%; height: 100%; border: 1px solid #334155; border-radius: 10px; background: #090A0F; transition: width 0.3s ease; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); }',
    '    .hub-container { position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%); background: #0F172A; border: 1px solid #7C3AED; padding: 10px 16px; border-radius: 14px; display: flex; flex-direction: column; gap: 6px; width: 820px; max-width: 96vw; z-index: 100; box-shadow: 0 20px 50px rgba(0,0,0,0.9); }',
    '    .hub-buttons { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }',
    '    .hub-buttons button { background: #7C3AED; color: white; border: none; padding: 8px 4px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; }',
    '    .hub-buttons button:hover { background: #6D28D9; }',
    '    .hub-buttons button.all-pages { background: #059669; }',
    '    .hub-buttons button.all-pages:hover { background: #047857; }',
    '    #status-toast { font-size: 11px; color: #34D399; text-align: center; font-family: monospace; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <header>',
    `    <div class="brand">⚡ StealThisStack v5.9 <span class="meta">| Crawled: ${allPagesResults.length} Page(s) | Sections: ${primaryResult.pickedData.pageSectionsSummary.length} | Assets: ${primaryResult.pickedData.visibleMediaAssets.length}</span></div>`,
    '    <div class="viewport-controls">',
    '      <button onclick="setStage(\'375px\')">📱 375px</button>',
    '      <button onclick="setStage(\'768px\')">💻 768px</button>',
    '      <button onclick="setStage(\'100%\')">🖥️ Full Width</button>',
    '      <a id="fullscreen-link" href="./isolated-stage.html" target="_blank" style="background:#059669;border-color:#10B981;color:white;">↗ Fullscreen Clone</a>',
    '    </div>',
    '  </header>',
    pageTabsHtml,
    '  <main>',
    '    <iframe id="stage-frame" src="./isolated-stage.html"></iframe>',
    '  </main>',
    '  <div class="hub-container">',
    '    <div class="hub-buttons">',
    '      <button onclick="copyPrompt(\'claude\')">📋 Copy Claude</button>',
    '      <button onclick="copyPrompt(\'cursor\')">📋 Copy Cursor</button>',
    '      <button onclick="copyPrompt(\'antigravity\')">📋 Copy Antigravity</button>',
    '      <button onclick="copyPrompt(\'gemini\')">📋 Copy Gemini</button>',
    `      <button class="all-pages" onclick="copyAllPagesPrompt()">🕸️ Copy All (${allPagesResults.length}) Pages</button>`,
    '    </div>',
    `    <div id="status-toast">✔ 9.5/10 Replication Prompt Ready (${allPagesResults.length} page(s) captured)</div>`,
    '  </div>',
    perPageTextareasHtml,
    `  <textarea id="ai-prompt-all-pages" style="display:none;"># Antigravity Multi-Page Protocol\n${escapeHtml(combinedMultiPagePrompt)}</textarea>`,
    '  <script>',
    '    let activePageIndex = 0;',
    '    function setStage(w) { document.getElementById("stage-frame").style.width = w; }',
    '    function switchPage(idx, stageFile, btnEl) {',
    '      activePageIndex = idx;',
    '      document.getElementById("stage-frame").src = "./" + stageFile;',
    '      document.getElementById("fullscreen-link").href = "./" + stageFile;',
    '      document.querySelectorAll(".page-tab").forEach(b => b.classList.remove("active"));',
    '      if (btnEl) btnEl.classList.add("active");',
    '      document.getElementById("status-toast").innerText = "✔ Switched to Page " + (idx + 1) + " Blueprint";',
    '    }',
    '    function copyPrompt(m) {',
    '      const raw = document.getElementById("page-prompt-" + activePageIndex).value;',
    '      let prefix = "";',
    '      if (m === "cursor") prefix = "@web ";',
    '      if (m === "antigravity") prefix = "# Antigravity Protocol\\n";',
    '      navigator.clipboard.writeText(prefix + raw);',
    '      document.getElementById("status-toast").innerText = "✔ Copied Page " + (activePageIndex + 1) + " " + m.toUpperCase() + " Prompt!";',
    '    }',
    '    function copyAllPagesPrompt() {',
    '      const allRaw = document.getElementById("ai-prompt-all-pages").value;',
    '      navigator.clipboard.writeText(allRaw);',
    '      document.getElementById("status-toast").innerText = "✔ Copied ALL CRAWLED PAGES Master Prompt to Clipboard!";',
    '    }',
    '  </script>',
    '</body>',
    '</html>'
  ].join('\n');

  await fs.writeFile(studioFilePath, studioHtml, 'utf-8');
  exec(process.platform === 'win32' ? `start "" "${studioFilePath}"` : `open "${studioFilePath}"`);
  console.log(`\n✔ Full Studio v5.9 launched at: ${studioFilePath} (${allPagesResults.length} page(s) captured)`);
  return { studioFilePath, stageFilePath: primaryResult.stageFilePath, pickedData: primaryResult.pickedData, allPagesResults };
}