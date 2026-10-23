import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';

chromium.use(stealth());

/**
 * Mode 1: Design System Token Extractor (Used by generator.js & mcp-server.js)
 */
export async function extractDesignSystem(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const rgbToHex = (rgb) => {
        if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return null;
        const m = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
        if (!m) return rgb.startsWith('#') ? rgb : null;
        if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
        return (
          '#' +
          [m[1], m[2], m[3]]
            .map((x) => parseInt(x, 10).toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase()
        );
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
        } catch (e) { }
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

        if (cs.fontFamily) {
          fontFamilies.add(cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
        }
        if (cs.borderRadius && cs.borderRadius !== '0px') borderRadii.add(cs.borderRadius);
        if (cs.boxShadow && cs.boxShadow !== 'none') boxShadows.add(cs.boxShadow);
        if (cs.backdropFilter && cs.backdropFilter !== 'none') backdropFilters.add(cs.backdropFilter);
        if (
          cs.transition &&
          cs.transition !== 'all 0s ease 0s' &&
          cs.transition !== 'none 0s ease 0s' &&
          !cs.transition.startsWith('all 0s')
        ) {
          transitions.add(cs.transition);
        }

        const tag = el.tagName.toLowerCase();
        if (['h1', 'h2', 'h3', 'p'].includes(tag) && !scale[tag]) {
          scale[tag] = {
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            letterSpacing: cs.letterSpacing
          };
        }
      }

      const svgs = Array.from(document.querySelectorAll('svg'))
        .filter((s) => {
          const r = s.getBoundingClientRect();
          return r.width > 8 && r.width < 120 && r.height > 8 && r.height < 120;
        })
        .slice(0, 15)
        .map((s, idx) => ({
          id: s.id || `icon-${idx + 1}`,
          html: s.outerHTML
        }));

      const topKeys = (map, n = 8) =>
        Array.from(map.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([k]) => k);

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
    await browser.close();
    throw err;
  }
}

/**
 * Mode 2: High-Accuracy Visual Component & Full-Page Compiler Studio (--pick)
 */
export async function interactivePickElement(url, outputDir) {
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
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    window.__STEAL_SHADERS__ = [];
    const hookWebGL = (proto) => {
      if (!proto || !proto.shaderSource) return;
      const orig = proto.shaderSource;
      proto.shaderSource = function (shader, source) {
        try {
          if (typeof source === 'string' && source.length > 30 && window.__STEAL_SHADERS__.length < 10) {
            window.__STEAL_SHADERS__.push({
              type: shader && shader._shaderType === 35632 ? 'fragment' : 'vertex',
              source: source.slice(0, 3000)
            });
          }
        } catch (e) { }
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
      if (status < 200 || status >= 300 || status === 301 || status === 302) return;

      const cleanPath = reqUrl.split('?')[0].toLowerCase();
      const contentType = (response.headers()['content-type'] || '').toLowerCase();

      if (cleanPath.endsWith('.css') || contentType.includes('text/css')) {
        try {
          const txt = await response.text();
          if (txt && capturedAssets.externalCssTexts.length < 30) {
            capturedAssets.externalCssTexts.push(txt);
          }
        } catch (e) { }
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
    } catch (e) { }
  });

  try {
    console.log('🌐 Navigating to ' + url + '...');
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
  } catch (err) {
    console.log('⚠️ Navigation note: ' + err.message);
    if (page.isClosed()) {
      await browser.close();
      return;
    }
  }

  let resolvePick;
  const pickPromise = new Promise((resolve) => { resolvePick = resolve; });
  await page.exposeFunction('__onStealElementPicked', (payload) => { resolvePick(payload); });

  await page.evaluate(() => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #A855F7;background:rgba(168,85,247,0.12);border-radius:8px;transition:all 0.05s ease-out;box-shadow:0 0 24px rgba(168,85,247,0.55);';
    document.body.appendChild(overlay);

    const topBar = document.createElement('div');
    topBar.id = '__steal_topbar';
    topBar.style.cssText =
      'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#090A0F;color:#F8FAFC;padding:8px 16px;border-radius:9999px;font-family:system-ui,monospace;font-size:13px;border:1px solid #A855F7;box-shadow:0 10px 30px rgba(0,0,0,0.85);display:flex;align-items:center;gap:14px;white-space:nowrap;';

    const badgeText = document.createElement('span');
    badgeText.innerText = '⚡ Hover UI & Click | Press ↑/↓ to adjust parent/child';

    const fullPageBtn = document.createElement('button');
    fullPageBtn.innerText = '🌐 Steal Entire Webpage (Full-Depth 9.5/10)';
    fullPageBtn.style.cssText =
      'background:linear-gradient(135deg,#7C3AED,#EC4899);color:white;border:none;padding:6px 14px;border-radius:9999px;font-weight:700;font-size:12px;cursor:pointer;';

    topBar.appendChild(badgeText);
    topBar.appendChild(fullPageBtn);
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

    window.addEventListener(
      'mousemove',
      (e) => {
        const rawEl = document.elementFromPoint(e.clientX, e.clientY);
        if (rawEl && topBar.contains(rawEl)) return;
        updateHighlight(getSmartContainer(rawEl));
      },
      true
    );

    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'ArrowUp' && currentTarget && currentTarget.parentElement && currentTarget.parentElement !== document.documentElement) {
          e.preventDefault();
          updateHighlight(currentTarget.parentElement);
        } else if (e.key === 'ArrowDown' && currentTarget && currentTarget.firstElementChild) {
          e.preventDefault();
          updateHighlight(currentTarget.firstElementChild);
        }
      },
      true
    );

    const finalizeSelection = (target, isFullPage) => {
      overlay.remove();
      topBar.remove();
      document.querySelectorAll('[data-steal-picked]').forEach((el) => el.removeAttribute('data-steal-picked'));
      target.setAttribute('data-steal-picked', 'true');
      window.__onStealElementPicked({ isFullPage, tagName: isFullPage ? 'full-webpage' : target.tagName.toLowerCase() });
    };

    fullPageBtn.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        fullPageBtn.innerText = '⏳ Unlocking Scroll Containers & Hydrating Sections...';
        finalizeSelection(document.body, true);
      },
      true
    );

    window.addEventListener(
      'click',
      (e) => {
        if (topBar.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        const target = currentTarget || getSmartContainer(document.elementFromPoint(e.clientX, e.clientY));
        if (!target) return;
        finalizeSelection(target, false);
      },
      true
    );
  });

  const selectionInfo = await pickPromise;

  // Multi-Layer Hardware Wheel + Container Scroll Hydration (Defeats Lenis/Next.js Virtualization)
  if (selectionInfo.isFullPage) {
    console.log('🔄 Hydrating full page (Hardware Wheel + Inner Scroll Containers + Section Reveal)...');
    await page.mouse.move(720, 450);

    for (let step = 0; step < 18; step++) {
      await page.mouse.wheel(0, 750);
      await page.evaluate((idx) => {
        window.scrollBy(0, 750);
        // Also scroll any custom smooth-scroll wrapper (Lenis, Locomotive, inner <main> overflow)
        document.querySelectorAll('main, [data-scroll-container], [class*="scroll"], div').forEach((el) => {
          if (el.scrollHeight > el.clientHeight + 200) {
            el.scrollTop += 750;
          }
        });
        // Force scrollIntoView on top-level sections so IntersectionObservers fire
        const sections = document.querySelectorAll('section, footer, main > div, body > div > div');
        if (sections[idx]) {
          try { sections[idx].scrollIntoView({ behavior: 'instant', block: 'center' }); } catch (e) { }
        }
      }, step);
      await page.waitForTimeout(180);
    }

    // Scroll back to top and wait for final paints
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelectorAll('main, [data-scroll-container], div').forEach((el) => {
        if (el.scrollTop > 0) el.scrollTop = 0;
      });
    });
    await page.waitForTimeout(600);
  }

  const referenceCropPath = path.join(outputDir, 'reference-crop.png');
  try {
    const pickedLocator = page.locator('[data-steal-picked="true"]').first();
    await pickedLocator.scrollIntoViewIfNeeded({ timeout: 2000 });
    if (!selectionInfo.isFullPage) {
      await pickedLocator.screenshot({ path: referenceCropPath });
    } else {
      await page.screenshot({ path: referenceCropPath, fullPage: true });
    }
  } catch (e) { }

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
        } catch (err) { }
      });

      const toAbs = (relUrl) => {
        if (!relUrl || relUrl.startsWith('data:') || relUrl.startsWith('blob:')) return relUrl;
        try {
          return new URL(relUrl, window.location.href).href;
        } catch (e) {
          return relUrl;
        }
      };

      // Force lazy-loaded images/videos to resolve their real URLs
      document.querySelectorAll('img, video, audio, source, iframe, a').forEach((node) => {
        const dataSrc = node.getAttribute('data-src') || node.getAttribute('data-lazy-src');
        if (dataSrc && !node.getAttribute('src')) node.setAttribute('src', toAbs(dataSrc));
        if (node.src) node.setAttribute('src', toAbs(node.getAttribute('src')));
        if (node.currentSrc && (node.tagName === 'IMG' || node.tagName === 'VIDEO')) {
          node.setAttribute('src', toAbs(node.currentSrc));
        }
        if (node.href && node.tagName === 'A') node.setAttribute('href', toAbs(node.getAttribute('href')));
        node.removeAttribute('loading');
        node.removeAttribute('srcset');
      });

      // Deduplicated Media Asset Manifest (Captures <img src>, <video src>, <video><source src>, and CSS bg-images)
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
          if (!mediaSeen.has(absSrc) && !absSrc.startsWith('data:')) {
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

      // Clean Root Design Tokens (Filters out noisy video-player & internal Tailwind empty vars)
      const resolvedVars = {};
      const NOISY_VAR_PREFIXES = ['--tw-', '--media-', '--cue-', '--chapter-', '--item-', '--checkbox-', '--track-', '--thumb-', '--scrollbar-', '--webkit-scrollbar-', '--vp-', '--anchor-', '--default-'];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule.style) {
              for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith('--') && !resolvedVars[prop]) {
                  if (NOISY_VAR_PREFIXES.some((prefix) => prop.startsWith(prefix))) continue;
                  const val = rule.style.getPropertyValue(prop).trim();
                  if (val) resolvedVars[prop] = val;
                }
              }
            }
          }
        } catch (e) { }
      }

      const keyframesMap = new Map();
      const fluidRules = new Set();
      const cssomRules = [];

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            const text = rule.cssText || '';
            if (!sheet.href) cssomRules.push(text);

            if (rule.type === CSSRule.KEYFRAMES_RULE && !rule.name.startsWith('vds-')) {
              keyframesMap.set(rule.name, text);
            }
            if (/(clamp|grid-cols|space-y|aspect-)/.test(text) && !text.includes('env(safe-area') && fluidRules.size < 35) {
              fluidRules.add(text);
            }
          }
        } catch (e) { }
      }

      for (const raw of externalCssList || []) {
        const matches = raw.matchAll(/@(?:-webkit-)?keyframes\s+([a-zA-Z0-9_-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g);
        for (const m of matches) {
          if (!keyframesMap.has(m[1]) && !m[1].startsWith('vds-')) {
            keyframesMap.set(m[1], m[0]);
          }
        }
        const clampMatches = raw.match(/[^{}]+\{[^{}]*clamp\([^)]+\)[^{}]*\}/g) || [];
        clampMatches.slice(0, 20).forEach((c) => fluidRules.add(c.trim()));
      }

      const cssVarsArray = Object.entries(resolvedVars).map(([k, v]) => `${k}: ${v};`);
      const cssVarsDump = `:root {\n  ${cssVarsArray.join('\n  ')}\n}`;
      cssomRules.unshift(cssVarsDump);

      // Section-Aware Full-Depth DOM Serializer
      const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'TEMPLATE', 'IFRAME', 'FONT']);
      let nodeCount = 0;
      const MAX_TOTAL_NODES = isFullPage ? 6500 : 1800;

      const serializeNode = (el, parentCs = null, depth = 0) => {
        if (!el || nodeCount > MAX_TOTAL_NODES || depth > 28) return '';
        if (el.nodeType === Node.TEXT_NODE) {
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          return text ? '  '.repeat(depth) + text : '';
        }
        if (el.nodeType !== Node.ELEMENT_NODE) return '';
        if (SKIP_TAGS.has(el.tagName)) return '';

        const tag = el.tagName.toLowerCase();
        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);

        // Skip screen-reader-only skip links ("Skip to main content")
        if (tag === 'a' && (el.innerText || '').toLowerCase().includes('skip to')) return '';

        // Only skip display:none if it is NOT a structural section or navigation menu
        if (cs.display === 'none' && !['SECTION', 'FOOTER', 'MAIN', 'ARTICLE', 'NAV'].includes(el.tagName)) {
          return '';
        }

        // Retain full SVG markup for icons up to 80px
        if (tag === 'svg') {
          nodeCount++;
          if (r.width <= 80 && r.height <= 80 && el.innerHTML.length < 1800) {
            return '  '.repeat(depth) + el.outerHTML.replace(/\s+/g, ' ').trim();
          }
          return '  '.repeat(depth) + `<svg width="${Math.round(r.width || 24)}" height="${Math.round(r.height || 24)}" viewBox="${el.getAttribute('viewBox') || '0 0 24 24'}"></svg>`;
        }

        // Preserve semantic attributes (href, id, aria-label, role)
        let semanticAttrs = '';
        if (el.id && !el.id.startsWith('radix-') && !el.id.startsWith('headlessui-')) {
          semanticAttrs += ` id="${el.id}"`;
        }
        if (tag === 'a' && el.getAttribute('href')) {
          semanticAttrs += ` href="${toAbs(el.getAttribute('href'))}"`;
        }
        if (tag === 'video') {
          const vSrc = el.currentSrc || el.src || (el.querySelector('source') ? el.querySelector('source').src : '');
          if (vSrc) semanticAttrs += ` src="${toAbs(vSrc)}" autoplay loop muted playsinline`;
        }

        const keyStyles = [];
        const inheritableProps = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'];
        const layoutProps = [
          'padding', 'margin', 'gap', 'border-radius', 'display', 'flex-direction',
          'justify-content', 'align-items', 'grid-template-columns', 'position',
          'box-shadow', 'backdrop-filter', 'border'
        ];

        layoutProps.forEach((prop) => {
          let val = cs.getPropertyValue(prop);
          if (
            val &&
            val !== '0px' &&
            val !== 'none' &&
            val !== 'normal' &&
            val !== 'auto' &&
            val !== 'block' &&
            val !== 'row' &&
            val !== 'static' &&
            !val.startsWith('0px none')
          ) {
            // Clean sub-pixel grid column noise into clean fractions
            if (prop === 'grid-template-columns' && val.includes('px')) {
              const colCount = val.trim().split(/\s+/).length;
              if (colCount > 1) val = `repeat(${colCount}, minmax(0, 1fr))`;
            }
            keyStyles.push(`${prop}:${val}`);
          }
        });

        // Clean Transitions (Strip verbose 6-property Tailwind transition lists down to concise form)
        const trans = cs.getPropertyValue('transition');
        if (trans && trans !== 'all 0s ease 0s' && trans !== 'none 0s ease 0s' && !trans.startsWith('all 0s')) {
          if (trans.includes('color') && trans.includes('background-color') && trans.includes('fill')) {
            const durMatch = trans.match(/[\d.]+s\s+cubic-bezier\([^)]+\)/);
            keyStyles.push(`transition:colors ${durMatch ? durMatch[0] : '0.3s ease'}`);
          } else {
            keyStyles.push(`transition:${trans}`);
          }
        }

        const anim = cs.getPropertyValue('animation');
        const animName = cs.getPropertyValue('animation-name');
        if (animName && animName !== 'none') {
          keyStyles.push(`animation:${anim}`);
        }

        inheritableProps.forEach((prop) => {
          let val = cs.getPropertyValue(prop);
          const parentVal = parentCs ? parentCs.getPropertyValue(prop) : null;
          if (val && val !== parentVal && val !== 'normal') {
            if (prop === 'font-family') {
              val = val.split(',')[0].replace(/['"]/g, '').trim();
            }
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

        const childrenList = Array.from(el.childNodes)
          .map((c) => serializeNode(c, cs, depth + 1))
          .filter(Boolean);

        // Prune completely empty, unstyled decorative wrapper divs that have no children, background, or media
        if (childrenList.length === 0 && !['video', 'canvas', 'input', 'textarea', 'hr'].includes(tag) && !bg) {
          return '';
        }

        nodeCount++;
        return '  '.repeat(depth) + `<${tag}${attrs}>\n${childrenList.join('\n')}\n` + '  '.repeat(depth) + `</${tag}>`;
      };

      // Deduplicate any scroll-cloned footers
      const footers = Array.from(document.querySelectorAll('footer'));
      if (footers.length > 1) footers.slice(1).forEach((f) => f.remove());

      // Extract Major Page Sections Map so AI knows every section on the page
      const pageSectionsSummary = Array.from(target.querySelectorAll('header, main > *, section, footer'))
        .map((sec, idx) => {
          const h = sec.querySelector('h1, h2, h3');
          const r = sec.getBoundingClientRect();
          if (r.height < 20) return null;
          return `${idx + 1}. <${sec.tagName.toLowerCase()}${sec.id ? '#' + sec.id : ''}> (${Math.round(r.width)}x${Math.round(r.height)}px) — Heading: "${h ? h.innerText.replace(/\s+/g, ' ').trim().slice(0, 70) : 'Visual/Content Block'}"`;
        })
        .filter(Boolean);

      const headLinksHtml = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        .map((el) => el.outerHTML)
        .join('\n');

      const globalSvgDefs = Array.from(document.querySelectorAll('svg defs'))
        .map((d) => `<svg style="width:0;height:0;position:absolute;overflow:hidden;" aria-hidden="true">${d.outerHTML}</svg>`)
        .join('\n');

      return {
        url: window.location.href,
        isFullPage,
        tagName: isFullPage ? 'full-webpage' : target.tagName.toLowerCase(),
        htmlAttrs: Array.from(document.documentElement.attributes).map((a) => `${a.name}="${a.value}"`).join(' '),
        bodyAttrs: Array.from(document.body.attributes).map((a) => `${a.name}="${a.value}"`).join(' '),
        dimensions: { width: Math.round(targetRect.width), height: Math.round(targetRect.height) },
        headLinksHtml,
        cssomDump: cssomRules.join('\n'),
        preservedBodyHtml: globalSvgDefs + '\n' + (isFullPage ? document.body.innerHTML : target.outerHTML),
        pageSectionsSummary,
        visibleMediaAssets: visibleMediaAssets.slice(0, 60),
        resolvedVars,
        keyframes: Array.from(keyframesMap.values()).slice(0, 25),
        fluidRules: Array.from(fluidRules).slice(0, 25),
        annotatedDomBlueprint: serializeNode(target, null, 0),
        webglShaders: window.__STEAL_SHADERS__ || [],
        canvasExports
      };
    },
    { isFullPage: selectionInfo.isFullPage, externalCssList: capturedAssets.externalCssTexts }
  );

  pickedData.capturedAssets = capturedAssets;
  await browser.close();

  for (const canvasData of pickedData.canvasExports) {
    if (canvasData.dataUrl) {
      const base64Data = canvasData.dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      await fs.writeFile(path.join(outputDir, canvasData.filename), base64Data, 'base64');
    }
  }

  const stageFilePath = path.join(outputDir, 'isolated-stage.html');
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
    '    html, body { width: 100%; max-width: 100%; overflow-x: hidden !important; margin: 0; padding: 0; background: #090A0F; }',
    '    .ticker-wrap, [class*="ticker"], [class*="marquee"] { overflow: hidden !important; max-width: 100vw !important; }',
    pickedData.cssomDump,
    pickedData.keyframes.join('\n'),
    '  </style>',
    '</head>',
    '<body ' + pickedData.bodyAttrs + '>',
    pickedData.preservedBodyHtml,
    '</body>',
    '</html>'
  ].join('\n');
  await fs.writeFile(stageFilePath, isolatedStageHtml, 'utf-8');

  const varEntries = Object.entries(pickedData.resolvedVars);
  const formattedVars = varEntries.length
    ? varEntries.map(([k, v]) => `  ${k}: ${v};`).join('\n')
    : '  /* Fallback to computed styles inside DOM nodes */';

  const masterAiPrompt = [
    '# STEALTHISSTACK v5.7 1:1 REPLICATION BLUEPRINT',
    `Target URL: ${pickedData.url}`,
    `Scope: ${pickedData.isFullPage ? 'FULL WEBPAGE' : 'COMPONENT'}`,
    '',
    '## EXECUTION RULES (DO NOT DEVIATE):',
    '1. BUILD EVERY SECTION IN SECTION 0: Reconstruct the complete vertical page architecture from Header down to Footer. Never truncate or leave placeholder comments.',
    '2. BIND REAL MEDIA URLS: Use the exact absolute `src` URLs from Section 2 for all `<video>`, `<img>`, and `<svg>` elements.',
    '3. WIRE ALL KEYFRAMES & HOVER STATES: Implement every `@keyframes` rule in Section 3 and bind interactive hover/dropdown transitions.',
    '4. APPLY CLEAN DESIGN TOKENS: Use the brand CSS variables in Section 1.',
    '',
    '## 0. PAGE ARCHITECTURE MAP (REQUIRED SECTIONS TO RENDER):',
    pickedData.pageSectionsSummary.length
      ? pickedData.pageSectionsSummary.join('\n')
      : '1. Full Component Hierarchy',
    '',
    '## 1. BRAND DESIGN TOKENS (CLEAN CSS VARIABLES):',
    '```css',
    ':root {\n' + formattedVars + '\n}',
    '```',
    '',
    '## 2. EXTRACTED MEDIA ASSETS TO RENDER (ABSOLUTE URLS):',
    JSON.stringify(pickedData.visibleMediaAssets, null, 2),
    '',
    '## 3. DEDUPLICATED CSS @KEYFRAMES & ANIMATIONS:',
    '```css',
    pickedData.keyframes.length ? pickedData.keyframes.join('\n\n') : '/* Transitions defined inline */',
    '```',
    '',
    '## 4. RESPONSIVE & GRID LAYOUT RULES:',
    '```css',
    pickedData.fluidRules.length ? pickedData.fluidRules.join('\n') : '/* Standard layout rules */',
    '```',
    '',
    '## 5. FULL DOM BLUEPRINT (NORMALIZED COMPUTED STYLES, HREFS, VIDEOS & INLINE SVGS):',
    '```html',
    pickedData.annotatedDomBlueprint || pickedData.preservedBodyHtml,
    '```'
  ].join('\n');

  const escapeHtml = (str) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 3. Write Studio Wrapper with Viewport Controls & Prompt Hub
  const studioFilePath = path.join(outputDir, 'picked-component.html');
  const studioHtml = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    `  <title>StealThisStack v5.7 Studio — ${pickedData.tagName}</title>`,
    '  <style>',
    '    * { box-sizing: border-box; }',
    '    body { margin: 0; height: 100vh; display: flex; flex-direction: column; background: #090D16; color: #F8FAFC; font-family: system-ui, sans-serif; overflow: hidden; }',
    '    header { height: 54px; background: #0F172A; border-bottom: 1px solid #1E293B; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; font-size: 13px; flex-shrink: 0; }',
    '    .brand { font-weight: 700; color: #A855F7; display: flex; align-items: center; gap: 10px; }',
    '    .meta { color: #94A3B8; font-weight: 400; font-family: monospace; font-size: 12px; }',
    '    .viewport-controls { display: flex; gap: 6px; align-items: center; }',
    '    .viewport-controls button, .viewport-controls a { background: #1E293B; color: #E2E8F0; border: 1px solid #334155; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; text-decoration: none; }',
    '    .viewport-controls button:hover, .viewport-controls a:hover { border-color: #A855F7; color: white; }',
    '    main { flex: 1; display: flex; justify-content: center; align-items: stretch; padding: 12px 12px 100px 12px; overflow: hidden; }',
    '    #stage-frame { width: 100%; height: 100%; border: 1px solid #334155; border-radius: 10px; background: #090A0F; transition: width 0.3s ease; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); }',
    '    .hub-container { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); background: #0F172A; border: 1px solid #7C3AED; padding: 12px 18px; border-radius: 14px; display: flex; flex-direction: column; gap: 8px; width: 780px; max-width: 96vw; z-index: 100; box-shadow: 0 20px 50px rgba(0,0,0,0.9); }',
    '    .hub-buttons { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }',
    '    .hub-buttons button { background: #7C3AED; color: white; border: none; padding: 8px 6px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 12px; }',
    '    .hub-buttons button:hover { background: #6D28D9; }',
    '    #status-toast { font-size: 11px; color: #34D399; text-align: center; font-family: monospace; }',
    '  </style>',
    '</head>',
    '<body>',
    '  <header>',
    `    <div class="brand">⚡ StealThisStack v5.7 <span class="meta">| Sections: ${pickedData.pageSectionsSummary.length} | Keyframes: ${pickedData.keyframes.length} | Media: ${pickedData.visibleMediaAssets.length}</span></div>`,
    '    <div class="viewport-controls">',
    '      <button onclick="setStage(\'375px\')">📱 375px</button>',
    '      <button onclick="setStage(\'768px\')">💻 768px</button>',
    '      <button onclick="setStage(\'100%\')">🖥️ Full Width</button>',
    '      <a href="./isolated-stage.html" target="_blank" style="background:#059669;border-color:#10B981;color:white;">↗ Fullscreen Clone</a>',
    '    </div>',
    '  </header>',
    '  <main>',
    '    <iframe id="stage-frame" src="./isolated-stage.html"></iframe>',
    '  </main>',
    '  <div class="hub-container">',
    '    <div class="hub-buttons">',
    '      <button onclick="copyPrompt(\'claude\')">📋 Copy Claude Prompt</button>',
    '      <button onclick="copyPrompt(\'cursor\')">📋 Copy Cursor Prompt</button>',
    '      <button onclick="copyPrompt(\'antigravity\')">📋 Copy Antigravity</button>',
    '      <button onclick="copyPrompt(\'gemini\')">📋 Copy Gemini</button>',
    '    </div>',
    `    <div id="status-toast">✔ Ready! Captured ${pickedData.pageSectionsSummary.length} Page Sections, ${pickedData.visibleMediaAssets.length} Assets & ${pickedData.keyframes.length} Animations</div>`,
    '  </div>',
    `  <textarea id="ai-prompt-claude" style="display:none;">${escapeHtml(masterAiPrompt)}</textarea>`,
    `  <textarea id="ai-prompt-cursor" style="display:none;">${escapeHtml('@web ' + masterAiPrompt)}</textarea>`,
    `  <textarea id="ai-prompt-antigravity" style="display:none;">${escapeHtml('# Antigravity Protocol\n' + masterAiPrompt)}</textarea>`,
    `  <textarea id="ai-prompt-gemini" style="display:none;">${escapeHtml(masterAiPrompt)}</textarea>`,
    '  <script>',
    '    function setStage(w) { document.getElementById("stage-frame").style.width = w; }',
    '    function copyPrompt(m) {',
    '      const ta = document.getElementById("ai-prompt-" + m);',
    '      if (!ta) return;',
    '      navigator.clipboard.writeText(ta.value);',
    '      document.getElementById("status-toast").innerText = "✔ Copied " + m.toUpperCase() + " Prompt to Clipboard!";',
    '    }',
    '  </script>',
    '</body>',
    '</html>'
  ].join('\n');

  await fs.writeFile(studioFilePath, studioHtml, 'utf-8');
  exec(process.platform === 'win32' ? `start "" "${studioFilePath}"` : `open "${studioFilePath}"`);
  console.log(`\n✔ Full Studio v5.7 launched at: ${studioFilePath}`);
  return { studioFilePath, stageFilePath, pickedData };
}