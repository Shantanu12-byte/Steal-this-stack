import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';

// Apply the stealth plugin to avoid being blocked by Cloudflare/Bot management
chromium.use(stealth());

/**
 * Mode 1: Full-Page Design System Token Extractor (Used by generator.js & mcp-server.js)
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
                if (prop.startsWith('--')) {
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

      for (const el of Array.from(document.querySelectorAll('*')).slice(0, 900)) {
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
        .slice(0, 12)
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
 * Mode 2: Interactive Visual Component & Full-Page Compiler Studio (--pick)
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
      '--disable-features=Translate', // Kill Google Translate (<font> pollution)
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

  // Pre-boot WebGL Shader Hook
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

  // Network Interceptor
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
          if (txt && capturedAssets.externalCssTexts.length < 15) {
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

      if (cleanPath.endsWith('.woff2') && capturedAssets.fonts.length < 8) {
        const fileName = path.basename(cleanPath);
        const buf = await response.body();
        await fs.writeFile(path.join(assetsDir, fileName), buf);
        capturedAssets.fonts.push({ fileName, originalUrl: reqUrl, localPath: './assets/' + fileName });
      }
    } catch (e) { }
  });

  try {
    console.log('🌐 Navigating to ' + url + '... (Waiting for JS to mount & hydrate)');
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
  } catch (err) {
    console.log('⚠️ Navigation warning: ' + err.message);
    if (page.isClosed()) {
      console.error('✖ Browser closed before extraction could finish.');
      await browser.close();
      return;
    }
  }

  let resolvePick;
  const pickPromise = new Promise((resolve) => { resolvePick = resolve; });
  await page.exposeFunction('__onStealElementPicked', (payload) => { resolvePick(payload); });

  // Inject Visual Picker Interface
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
    fullPageBtn.innerText = '🌐 Steal Entire Webpage (Full Studio)';
    fullPageBtn.style.cssText =
      'background:linear-gradient(135deg,#7C3AED,#EC4899);color:white;border:none;padding:6px 14px;border-radius:9999px;font-weight:700;font-size:12px;cursor:pointer;box-shadow:0 4px 12px rgba(124,58,237,0.4);';

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
      const animCount = typeof el.getAnimations === 'function' ? el.getAnimations({ subtree: true }).length : 0;
      badgeText.innerText = `⚡ <${el.tagName.toLowerCase()}> (${Math.round(r.width)}×${Math.round(r.height)}px) | 🎬 ${animCount} Anims | ↑/↓ Resize`;
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
      async (e) => {
        e.preventDefault();
        e.stopPropagation();
        fullPageBtn.innerText = '⏳ Deep Hydrating DOM...';

        // Single controlled pass to trigger lazy loads without recursive scroll duplication
        await new Promise((resolve) => {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          setTimeout(() => {
            window.scrollTo({ top: 0, behavior: 'instant' });
            setTimeout(resolve, 800);
          }, 1200);
        });

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

  // Safe High-DPI Reference Screenshot
  const referenceCropPath = path.join(outputDir, 'reference-crop.png');
  try {
    const pickedLocator = page.locator('[data-steal-picked="true"]').first();
    await pickedLocator.scrollIntoViewIfNeeded({ timeout: 2000 });
    if (!selectionInfo.isFullPage) {
      await pickedLocator.screenshot({ path: referenceCropPath });
    } else {
      await page.screenshot({ path: referenceCropPath, fullPage: true });
    }
    console.log('📸 Reference visual crop saved to reference-crop.png');
  } catch (e) {
    console.log('⚠️ Could not take reference crop:', e.message);
  }

  // Complete Extraction Payload
  const pickedData = await page.evaluate(
    ({ isFullPage, externalCssList }) => {
      const target = document.querySelector('[data-steal-picked="true"]') || document.body;
      const targetRect = target.getBoundingClientRect();

      // Memory-safe canvas capture
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

      document.querySelectorAll('img, video, audio, source, iframe, a').forEach((node) => {
        if (node.src) node.setAttribute('src', toAbs(node.getAttribute('src')));
        if (node.currentSrc && (node.tagName === 'IMG' || node.tagName === 'VIDEO')) {
          node.setAttribute('src', toAbs(node.currentSrc));
        }
        if (node.href && node.tagName === 'A') node.setAttribute('href', toAbs(node.getAttribute('href')));
        node.removeAttribute('loading');
        node.removeAttribute('srcset');
      });

      // Extract explicit image & video assets
      const visibleMediaAssets = [];
      target.querySelectorAll('img, video').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 12 && r.height > 12) {
          const src = el.currentSrc || el.src;
          if (src) {
            visibleMediaAssets.push({
              tag: el.tagName.toLowerCase(),
              src: toAbs(src),
              alt: el.alt || 'graphic',
              dimensions: `${Math.round(r.width)}x${Math.round(r.height)}px`
            });
          }
        }
      });

      // Harvest CSS Variables across live sheets
      const resolvedVars = {};
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule.style) {
              for (let i = 0; i < rule.style.length; i++) {
                const prop = rule.style[i];
                if (prop.startsWith('--') && !resolvedVars[prop]) {
                  resolvedVars[prop] = rule.style.getPropertyValue(prop).trim();
                }
              }
            }
          }
        } catch (e) { }
      }

      // Deduplicate CSS Keyframes & Fluid Rules
      const keyframesMap = new Map();
      const fluidRules = new Set();
      const cssomRules = [];

      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            const text = rule.cssText || '';
            if (!sheet.href) cssomRules.push(text);

            if (rule.type === CSSRule.KEYFRAMES_RULE) {
              keyframesMap.set(rule.name, text);
            }
            if (/(clamp|calc|min|max)\(/.test(text) && fluidRules.size < 20) {
              fluidRules.add(text);
            }
          }
        } catch (e) { }
      }

      for (const raw of externalCssList || []) {
        const matches = raw.matchAll(/@(?:-webkit-)?keyframes\s+([a-zA-Z0-9_-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g);
        for (const m of matches) {
          if (!keyframesMap.has(m[1])) {
            keyframesMap.set(m[1], m[0]);
          }
        }
        const clampMatches = raw.match(/[^{}]+\{[^{}]*clamp\([^)]+\)[^{}]*\}/g) || [];
        clampMatches.slice(0, 15).forEach((c) => fluidRules.add(c.trim()));
      }

      const cssVarsArray = Object.entries(resolvedVars).map(([k, v]) => `${k}: ${v};`);
      const cssVarsDump = `:root {\n  ${cssVarsArray.join('\n  ')}\n}`;
      cssomRules.unshift(cssVarsDump);

      // Traversal for Complete Blueprint Tree
      const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'TEMPLATE', 'IFRAME', 'FONT']);
      let nodeCount = 0;

      const serializeNode = (el, parentCs = null, depth = 0) => {
        if (!el || nodeCount > 900 || depth > 15) return '';
        if (el.nodeType === Node.TEXT_NODE) {
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          return text ? text : '';
        }
        if (el.nodeType !== Node.ELEMENT_NODE) return '';
        if (SKIP_TAGS.has(el.tagName)) return '';

        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);

        // Skip invisible skip links, but allow structural containers through
        if (cs.display === 'none' || cs.visibility === 'hidden') return '';
        if (r.width === 0 && r.height === 0 && !['BODY', 'MAIN', 'HEADER', 'FOOTER', 'SECTION', 'DIV'].includes(el.tagName)) {
          return '';
        }

        nodeCount++;
        const tag = el.tagName.toLowerCase();

        if (tag === 'svg') {
          return '  '.repeat(depth) + `<svg width="${Math.round(r.width)}" height="${Math.round(r.height)}"></svg>\n`;
        }

        const keyStyles = [];
        const inheritableProps = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'];
        const layoutProps = [
          'padding', 'margin', 'gap', 'border-radius', 'display', 'flex-direction',
          'justify-content', 'align-items', 'grid-template-columns', 'position',
          'top', 'left', 'bottom', 'right', 'transform', 'opacity', 'box-shadow', 'backdrop-filter'
        ];

        layoutProps.forEach((prop) => {
          const val = cs.getPropertyValue(prop);
          if (
            val &&
            val !== '0px' &&
            val !== 'none' &&
            val !== 'normal' &&
            val !== 'auto' &&
            val !== 'block' &&
            val !== 'row' &&
            val !== 'static' &&
            !(prop === 'opacity' && val === '1')
          ) {
            keyStyles.push(`${prop}:${val}`);
          }
        });

        const trans = cs.getPropertyValue('transition');
        if (trans && trans !== 'all 0s ease 0s' && trans !== 'none 0s ease 0s' && !trans.startsWith('all 0s')) {
          keyStyles.push(`transition:${trans}`);
        }
        const anim = cs.getPropertyValue('animation');
        const animName = cs.getPropertyValue('animation-name');
        if (animName && animName !== 'none') {
          keyStyles.push(`animation:${anim}`);
        }

        inheritableProps.forEach((prop) => {
          const val = cs.getPropertyValue(prop);
          const parentVal = parentCs ? parentCs.getPropertyValue(prop) : null;
          if (val && val !== parentVal && val !== 'normal') {
            keyStyles.push(`${prop}:${val}`);
          }
        });

        const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : null;
        if (bg) keyStyles.push('bg:' + bg);

        let attrs = keyStyles.length ? ` data-computed="${keyStyles.join('; ')}"` : '';
        if (el.hasAttribute('data-stealth-canvas-export')) {
          attrs += ` data-stealth-canvas-export="${el.getAttribute('data-stealth-canvas-export')}"`;
        }

        if (tag === 'img') {
          return '  '.repeat(depth) + `<img src="${toAbs(el.src)}" alt="${el.alt || ''}" width="${Math.round(r.width)}" height="${Math.round(r.height)}"${attrs} />\n`;
        }

        const childrenStr = Array.from(el.childNodes)
          .map((c) => serializeNode(c, cs, depth + 1))
          .filter(Boolean)
          .join('\n');

        return '  '.repeat(depth) + `<${tag}${attrs}>\n${childrenStr}\n` + '  '.repeat(depth) + `</${tag}>`;
      };

      // Clean duplicate appended footers and ribbons created by scroll events
      const footers = Array.from(document.querySelectorAll('footer'));
      if (footers.length > 1) {
        footers.slice(1).forEach((f) => f.remove());
      }
      const bottomBars = Array.from(document.querySelectorAll('.footer-ribbon, [class*="footer-line"]'));
      if (bottomBars.length > 1) {
        bottomBars.slice(1).forEach((b) => b.remove());
      }

      const headLinksHtml = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        .map((el) => el.outerHTML)
        .join('\n');

      // Global SVG defs for masks and filters
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
        visibleMediaAssets: visibleMediaAssets.slice(0, 30),
        resolvedVars,
        keyframes: Array.from(keyframesMap.values()).slice(0, 15),
        fluidRules: Array.from(fluidRules).slice(0, 15),
        annotatedDomBlueprint: serializeNode(target, null, 0),
        webglShaders: window.__STEAL_SHADERS__ || [],
        canvasExports
      };
    },
    { isFullPage: selectionInfo.isFullPage, externalCssList: capturedAssets.externalCssTexts }
  );

  pickedData.capturedAssets = capturedAssets;
  await browser.close();

  // Save exported canvas frames
  for (const canvasData of pickedData.canvasExports) {
    if (canvasData.dataUrl) {
      const base64Data = canvasData.dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      await fs.writeFile(path.join(outputDir, canvasData.filename), base64Data, 'base64');
    }
  }

  // 1. Write Isolated Cloned Site (Visual Sandbox with Strict CSS Scoping & Overflow Guards)
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
    '    /* Essential viewport & overflow guards */',
    '    *, *::before, *::after { box-sizing: border-box; }',
    '    html, body { width: 100%; max-width: 100%; overflow-x: hidden !important; margin: 0; padding: 0; background: #090A0F; }',
    '    /* Contain ticker, marquee, and project card overflow runaway */',
    '    .ticker-wrap, [class*="ticker"], [class*="marquee"] {',
    '      overflow: hidden !important;',
    '      width: 100% !important;',
    '      max-width: 100vw !important;',
    '      white-space: nowrap !important;',
    '      display: flex !important;',
    '    }',
    '    .ticker-phrase {',
    '      display: inline-block;',
    '      white-space: nowrap;',
    '    }',
    '    .p-project-card {',
    '      max-width: 100vw !important;',
    '      box-sizing: border-box !important;',
    '    }',
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

  // 2. Build Master AI Engineering Prompt
  const varEntries = Object.entries(pickedData.resolvedVars);
  const formattedVars = varEntries.length
    ? varEntries.map(([k, v]) => `  ${k}: ${v};`).join('\n')
    : '  /* Fallback to computed styles inside DOM nodes */';

  const masterAiPrompt = [
    '# STEALTHISSTACK v5.4 FULL-FIDELITY BLUEPRINT',
    `Target URL: ${pickedData.url}`,
    `Scope: ${pickedData.isFullPage ? 'FULL WEBPAGE' : 'COMPONENT'}`,
    '',
    '## EXECUTION RULES (DO NOT DEVIATE):',
    '1. IMPLEMENT ALL ANIMATIONS: You MUST wire up every CSS `@keyframes` and `transition` listed in Section 3.',
    '2. USE REAL ASSET URLS: Render every image and media asset listed in Section 2 with its exact absolute URL.',
    '3. MATCH CSS VARIABLES: Reference the extracted root variables for brand colors, background tints, and gradients.',
    '',
    '## 1. RESOLVED ROOT DESIGN TOKENS (CSS VARIABLES):',
    '```css',
    ':root {\n' + formattedVars + '\n}',
    '```',
    '',
    '## 2. EXTRACTED MEDIA ASSETS TO RENDER:',
    JSON.stringify(pickedData.visibleMediaAssets, null, 2),
    '',
    '## 3. DEDUPLICATED CSS @KEYFRAMES & ANIMATIONS:',
    '```css',
    pickedData.keyframes.length ? pickedData.keyframes.join('\n\n') : '/* Transitions defined inline */',
    '```',
    '',
    '## 4. FLUID CLAMP & RESPONSIVE RULES:',
    '```css',
    pickedData.fluidRules.length ? pickedData.fluidRules.join('\n') : '/* Standard layout rules */',
    '```',
    '',
    '## 5. COMPLETE STRUCTURAL BLUEPRINT (DEDUPLICATED DOM):',
    '```html',
    pickedData.annotatedDomBlueprint || pickedData.preservedBodyHtml.slice(0, 15000),
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
    `  <title>StealThisStack v5.4 Studio — ${pickedData.tagName}</title>`,
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
    `    <div class="brand">⚡ StealThisStack v5.4 <span class="meta">| Keyframes: ${pickedData.keyframes.length} | Media: ${pickedData.visibleMediaAssets.length} | Shaders: ${pickedData.webglShaders.length}</span></div>`,
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
    `    <div id="status-toast">✔ Ready! Captured ${pickedData.keyframes.length} Keyframes & ${pickedData.visibleMediaAssets.length} Visual Assets</div>`,
    '  </div>',
    `  <textarea id="ai-prompt-claude" style="display:none;">${escapeHtml(masterAiPrompt)}</textarea>`,
    `  <textarea id="ai-prompt-cursor" style="display:none;">${escapeHtml('@web ' + masterAiPrompt)}</textarea>`,
    `  <textarea id="ai-prompt-antigravity" style="display:none;">${escapeHtml('# Antigravity v5.4 Protocol\n' + masterAiPrompt)}</textarea>`,
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
  console.log(`\n✔ Full Studio launched at: ${studioFilePath}`);
  return { studioFilePath, stageFilePath, pickedData };
}