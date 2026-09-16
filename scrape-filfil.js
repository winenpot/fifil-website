import puppeteer from 'puppeteer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const base = new URL(process.env.FILFIL_URL || 'https://filfilworld.com/');
const output = path.resolve(process.env.FILFIL_OUTPUT || 'filfil-site');
const maxPages = Number(process.env.FILFIL_MAX_PAGES || 10000);
const timeoutMs = Number(process.env.FILFIL_TIMEOUT_MS || 20000);
const refresh = process.env.FILFIL_REFRESH === '1';
const pageQueue = [base.href];
const queuedPages = new Set(pageQueue);
const assetQueue = new Set();
const pages = new Map();
const assets = new Map();
const failures = [];
const externalResources = new Set();
const forms = [];
const responseTasks = new Set();
const assetExt = /\.(?:css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|otf|pdf|mp4|webm|mp3|wav|json|xml|txt)$/i;
const ignoredPage = /\/(?:wp-admin|wp-json|wp-login\.php)(?:\/|$)/i;

function urlOf(value, relativeTo = base.href) {
  try {
    const result = new URL(value, relativeTo);
    if (!['http:', 'https:'].includes(result.protocol) || result.host !== base.host) return null;
    result.hash = '';
    return result.href;
  } catch { return null; }
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10); }
function localPath(url, page = false) {
  const parsed = new URL(url);
  let name = decodeURIComponent(parsed.pathname);
  if (page) {
    if (name.endsWith('/')) name += 'index.html';
    else if (!path.extname(name)) name += '/index.html';
  } else if (name.endsWith('/')) return null;
  if (parsed.search) {
    const ext = path.extname(name);
    name = `${name.slice(0, -ext.length || undefined)}--${hash(parsed.search)}${ext}`;
  }
  // URL paths are untrusted input. Keep writes strictly inside output.
  const safe = path.posix.normalize(name).replace(/^\/+/, '');
  if (!safe || safe === '..' || safe.startsWith('../') || safe.includes('\0')) return null;
  return safe;
}
function enqueuePage(url) {
  if (!url || ignoredPage.test(new URL(url).pathname) || queuedPages.has(url)) return;
  queuedPages.add(url);
  pageQueue.push(url);
}
function enqueueAsset(url) {
  if (url && !assetQueue.has(url)) assetQueue.add(url);
}
function enqueueLink(value, relativeTo = base.href) {
  const url = urlOf(value, relativeTo);
  if (!url) return;
  if (assetExt.test(new URL(url).pathname)) enqueueAsset(url);
  else enqueuePage(url);
}
async function save(name, data) {
  const target = path.resolve(output, name);
  if (!target.startsWith(output + path.sep)) throw new Error(`Unsafe path: ${name}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}
async function savedFileExists(name) {
  try { return (await fs.stat(path.join(output, name))).size > 0; }
  catch { return false; }
}
async function get(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'Mozilla/5.0 (compatible; FilfilMirror/2.0)' } });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          error.retryable = false;
        }
        throw error;
      }
      return response;
    } catch (error) {
      if (attempt === 2 || error.retryable === false) throw error;
    }
  }
}
async function captureResponse(response) {
  const url = urlOf(response.url());
  if (!url || assets.has(url) || response.status() < 200 || response.status() >= 300) return;
  const type = response.headers()['content-type'] || '';
  try {
    const body = await response.buffer();
    const name = localPath(url);
    if (!name || type.includes('text/html')) return;
    let outputBody = body;
    if (type.includes('text/css') || name.endsWith('.css')) {
      const css = body.toString('utf8');
      for (const child of cssUrls(css)) enqueueAsset(urlOf(child, url));
      outputBody = Buffer.from(rewriteCss(css, url));
    }
    await save(name, outputBody);
    assets.set(url, { file: name, bytes: outputBody.length, type });
  } catch { /* A response can disappear during navigation. */ }
}
async function discoverSitemap(url, seen = new Set()) {
  if (!url || seen.has(url)) return;
  seen.add(url);
  try {
    const xml = await (await get(url)).text();
    for (const match of xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
      const child = urlOf(match[1].replaceAll('&amp;', '&'));
      if (!child) continue;
      if (/\.xml(?:\?|$)/i.test(child)) await discoverSitemap(child, seen);
      else enqueueLink(child);
    }
  } catch { /* Sitemap is optional; links remain the primary discovery source. */ }
}
function rewriteOne(raw, source, kind) {
  if (/^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(raw.trim())) return raw;
  const target = urlOf(raw, source);
  if (!target) return raw;
  const parsed = new URL(raw, source);
  const name = localPath(target, kind === 'page');
  return name ? `/${name}${parsed.hash}` : raw;
}
// CSS URLs can contain parentheses, e.g. IRANSansWeb(FaNum).woff2.
function cssUrlSpans(css) {
  const spans = [];
  for (const match of css.matchAll(/url\s*\(/gi)) {
    let position = match.index + match[0].length;
    let depth = 1;
    let quote = '';
    for (; position < css.length; position++) {
      const char = css[position];
      if (quote) {
        if (char === '\\') { position++; continue; }
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '(') depth++;
      else if (char === ')' && --depth === 0) break;
    }
    if (depth !== 0) continue;
    const raw = css.slice(match.index + match[0].length, position).trim();
    const value = /^["']/.test(raw) && raw.at(-1) === raw[0] ? raw.slice(1, -1) : raw;
    spans.push({ start: match.index, end: position + 1, value, quote: raw[0] === '"' || raw[0] === "'" ? raw[0] : '' });
  }
  return spans;
}
function cssUrls(css) { return cssUrlSpans(css).map(span => span.value); }
function rewriteCss(css, source) {
  const spans = cssUrlSpans(css);
  for (const span of spans.reverse()) {
    css = css.slice(0, span.start) + `url(${span.quote}${rewriteOne(span.value, source, 'asset')}${span.quote})` + css.slice(span.end);
  }
  return css;
}
function rewriteHtml(html, source) {
  let result = html.replace(/\b(href|src|poster|data-src|data-lazy-src|action)\s*=\s*(["'])(.*?)\2/gi,
    (_, attr, quote, value) => {
      const kind = attr.toLowerCase() === 'href' && !assetExt.test(new URL(value, source).pathname) ? 'page' : 'asset';
      // Forms need a backend. Keep their original destination for the audit.
      if (attr.toLowerCase() === 'action') return `${attr}=${quote}${value}${quote}`;
      return `${attr}=${quote}${rewriteOne(value, source, kind)}${quote}`;
    });
  result = result.replace(/\bsrcset\s*=\s*(["'])(.*?)\1/gi, (_, quote, value) =>
    `srcset=${quote}${value.split(',').map(part => {
      const [url, ...descriptor] = part.trim().split(/\s+/);
      return [rewriteOne(url, source, 'asset'), ...descriptor].join(' ');
    }).join(', ')}${quote}`);
  result = result.replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi, (_, quote, value) =>
    `style=${quote}${rewriteCss(value, source)}${quote}`);
  result = result.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    (_, attrs, css) => `<style${attrs}>${rewriteCss(css, source)}</style>`);
  return result;
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  let listReport;
  if (!refresh) {
    try {
      const previous = JSON.parse(await fs.readFile(path.join(output, 'mirror-report.json'), 'utf8'));
      if (previous.source === base.href) {
        for (const record of previous.pages || []) {
          enqueuePage(record.url);
          if (await savedFileExists(record.file)) pages.set(record.url, record.file);
        }
        for (const record of previous.assets || []) {
          enqueueAsset(record.url);
          // Re-fetch CSS once to repair URLs parsed incorrectly by earlier versions.
          if (!record.type?.includes('text/css') && !record.file?.endsWith('.css') &&
            await savedFileExists(record.file)) assets.set(record.url, record);
        }
        for (const record of previous.failures || []) {
          if (record.type === 'page') enqueueLink(record.url);
          else if (!/\(FaNum$/i.test(record.url)) enqueueAsset(record.url);
        }
        forms.push(...(previous.forms || []));
        for (const resource of previous.externalResources || []) externalResources.add(resource);
        console.log(`Resuming: ${pages.size} saved pages, ${assets.size} saved assets.`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`Could not load previous report: ${error.message}`);
    }
  }
  try {
    listReport = JSON.parse(await fs.readFile(path.join(output, 'static-list-report.json'), 'utf8'));
    for (const value of listReport.missingPages || []) {
      const url = urlOf(value);
      if (!url) continue;
      const page = new URL(url);
      page.pathname = page.pathname.replace(/\/index\.html$/i, '/');
      enqueuePage(page.href);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not load list report: ${error.message}`);
  }
  for (const route of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
    await discoverSitemap(urlOf(route));
  }
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const tab = await browser.newPage();
    await tab.setUserAgent('Mozilla/5.0 (compatible; FilfilMirror/2.0)');
    tab.on('response', response => {
      const task = captureResponse(response);
      responseTasks.add(task);
      task.finally(() => responseTasks.delete(task));
    });
    for (let index = 0; index < pageQueue.length && index < maxPages; index++) {
      const url = pageQueue[index];
      if (pages.has(url)) { console.log(`CACHED PAGE ${index + 1}/${pageQueue.length} ${url}`); continue; }
      try {
        const response = await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? 'no response'}`);
        await new Promise(resolve => setTimeout(resolve, 750));
        const found = await tab.evaluate(() => ({
          links: [...document.querySelectorAll('a[href], area[href], iframe[src]')].map(el => el.href || el.src),
          assets: [
            ...performance.getEntriesByType('resource').map(entry => entry.name),
            ...document.querySelectorAll('link[href], script[src], img[src], img[srcset], source[src], source[srcset], video[src], video[poster]')
          ].flatMap(el => [el.href, el.src, el.poster, ...(el.srcset || '').split(',').map(part => part.trim().split(/\s+/)[0])]).filter(Boolean),
          styles: [...document.querySelectorAll('[style], style')].map(el => el.getAttribute('style') || el.textContent || ''),
          forms: [...document.forms].map(el => ({ action: el.action, method: el.method }))
        }));
        for (const value of found.links) enqueueLink(value, url);
        for (const value of found.assets) {
          const local = urlOf(value, url);
          if (local) enqueueAsset(local);
          else if (/^https?:/i.test(value)) externalResources.add(value);
        }
        for (const form of found.forms) forms.push({ page: url, ...form });
        for (const css of found.styles) for (const child of cssUrls(css)) enqueueAsset(urlOf(child, url));
        const html = await tab.content();
        const name = localPath(url, true);
        if (name) { pages.set(url, name); await save(name, rewriteHtml(html, url)); }
        console.log(`PAGE ${index + 1}/${pageQueue.length} ${url}`);
      } catch (error) {
        failures.push({ type: 'page', url, error: error.message });
        console.warn(`FAILED PAGE ${url}: ${error.message}`);
      }
    }
    await Promise.all(responseTasks);
  } finally { await browser.close(); }
  for (const url of assetQueue) {
    if (assets.has(url)) continue;
    try {
      const response = await get(url);
      const type = response.headers.get('content-type') || '';
      if (type.includes('text/html')) { enqueuePage(url); continue; }
      const name = localPath(url);
      if (!name) continue;
      let body = Buffer.from(await response.arrayBuffer());
      if (type.includes('text/css') || name.endsWith('.css')) {
        const css = body.toString('utf8');
        for (const child of cssUrls(css)) enqueueAsset(urlOf(child, url));
        body = Buffer.from(rewriteCss(css, url));
      }
      await save(name, body);
      assets.set(url, { file: name, bytes: body.length, type });
      console.log(`ASSET ${assets.size}/${assetQueue.size} ${url}`);
    } catch (error) {
      failures.push({ type: 'asset', url, error: error.message });
      console.warn(`FAILED ASSET ${url}: ${error.message}`);
    }
  }
  const report = { source: base.href, createdAt: new Date().toISOString(), pages: [...pages].map(([url, file]) => ({ url, file })), assets: [...assets].map(([url, data]) => ({ url, ...data })), failures, forms, externalResources: [...externalResources], discoveredPages: pageQueue.length, maxPages };
  await save('mirror-report.json', JSON.stringify(report, null, 2));
  if (listReport) {
    const stillMissing = [];
    for (const value of listReport.missingPages || []) {
      if (!await savedFileExists(localPath(value, true))) stillMissing.push(value);
    }
    listReport.missingPages = stillMissing;
    await save('static-list-report.json', JSON.stringify(listReport, null, 2));
  }
  console.log(`Done: ${pages.size} pages, ${assets.size} assets, ${failures.length} failures.`);
  if (!pages.size || failures.length || pageQueue.length > maxPages) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
