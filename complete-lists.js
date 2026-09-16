import fs from 'node:fs/promises';
import path from 'node:path';

const origin = new URL('https://filfilworld.com/');
const output = path.resolve('filfil-site');
const lists = [
  { name: 'recipes', file: 'Recipes/index.html', endpoint: '/Reciepe/GetMore', listClass: 'products-list', totalId: 'allRecieptsCount', batch: 8 },
  { name: 'mag', file: 'mag/index.html', endpoint: '/News/GetMore', listClass: 'news-count', totalId: 'allRecieptsCount', batch: 6 },
  { name: 'products', file: 'products/index.html', endpoint: '/products/show-more', listClass: 'products-list', totalId: 'allProductCount', batch: 7 }
];
const missingAssets = [];
const missingPages = new Set();

async function fetchBody(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; FilfilMirror/2.0)' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}
function safeFile(url) {
  const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const target = path.resolve(output, pathname);
  if (!target.startsWith(output + path.sep)) throw new Error(`Unsafe path: ${url.href}`);
  return target;
}
function localUrl(value, kind) {
  const url = new URL(value, origin);
  if (url.host !== origin.host || !['http:', 'https:'].includes(url.protocol)) return value;
  let pathname = decodeURIComponent(url.pathname);
  if (kind === 'page') {
    if (pathname.endsWith('/')) pathname += 'index.html';
    else if (!path.posix.extname(pathname)) pathname += '/index.html';
  }
  return encodeURI(pathname) + url.hash;
}
function rewriteCard(card) {
  return card.replace(/\b(href|src)\s*=\s*(["'])(.*?)\2/gi, (match, attr, quote, value) => {
    try { return `${attr}=${quote}${localUrl(value, attr.toLowerCase() === 'href' ? 'page' : 'asset')}${quote}`; }
    catch { return match; }
  });
}
async function captureReferencedFiles(cards) {
  for (const card of cards) {
    for (const match of card.matchAll(/\bsrc\s*=\s*(["'])(.*?)\1/gi)) {
      const url = new URL(match[2], origin);
      if (url.host !== origin.host) continue;
      const target = safeFile(url);
      try { if ((await fs.stat(target)).size > 0) continue; } catch { /* download */ }
      try {
        const body = Buffer.from(await (await fetchBody(url)).arrayBuffer());
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, body);
      } catch (error) { missingAssets.push({ url: url.href, error: error.message }); }
    }
    for (const match of card.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) {
      const url = new URL(match[2], origin);
      if (url.host !== origin.host) continue;
      const target = safeFile(url);
      try { if ((await fs.stat(target)).size > 0) continue; } catch { missingPages.add(url.href); }
    }
  }
}
async function captureList(config) {
  const file = path.join(output, config.file);
  let html = await fs.readFile(file, 'utf8');
  html = html.replace(/\s*<li\b[^>]*data-mirror-extra[^>]*>[\s\S]*?<\/li>/gi, '');
  const section = new RegExp(`(<ul class="${config.listClass}[^>]*>)([\\s\\S]*?)(<\\/ul>)`, 'i');
  const currentList = html.match(section);
  if (!currentList) throw new Error(`List missing in ${config.file}`);
  const initial = (currentList[2].match(/<li\b/gi) || []).length;
  const totalMatch = html.match(new RegExp(`id="${config.totalId}"[^>]*value="(\\d+)"`, 'i'));
  if (!totalMatch) throw new Error(`Total count missing in ${config.file}`);
  const total = Number(totalMatch[1]);
  const cards = [];
  let count = initial;
  while (count < total) {
    const url = new URL(config.endpoint, origin);
    url.searchParams.set('count', count);
    const fragment = await (await fetchBody(url)).json();
    if (typeof fragment !== 'string') throw new Error(`Unexpected response from ${url.href}`);
    const next = [...fragment.matchAll(/<li\b[\s\S]*?<\/li>/gi)].map(match => rewriteCard(match[0]));
    if (!next.length) throw new Error(`No cards from ${url.href}; ${count}/${total} saved`);
    cards.push(...next);
    count += next.length;
    console.log(`${config.name}: ${count}/${total}`);
    if (count > total) throw new Error(`Too many cards from ${url.href}`);
  }
  await captureReferencedFiles(cards);
  const extra = cards.map(card => card.replace(/<li\b/i, '<li class="mirror-hidden" data-mirror-extra'));
  html = html.replace(section, (_, open, body, close) => `${open}${body}\n${extra.join('\n')}\n${close}`);
  if (!html.includes('id="filfil-static-more-style"')) {
    html = html.replace('</head>', '<style id="filfil-static-more-style">.mirror-hidden{display:none!important}</style></head>');
  }
  const replacement = `<script id="filfil-static-more">\nlet showMore = () => {\n  const list = document.querySelector('.${config.listClass}');\n  const next = [...list.querySelectorAll('li[data-mirror-extra].mirror-hidden')].slice(0, ${config.batch});\n  next.forEach(item => item.classList.remove('mirror-hidden'));\n  if (!list.querySelector('li[data-mirror-extra].mirror-hidden')) document.querySelector('.detail-view-infinite')?.style.setProperty('display', 'none');\n};\n</script>`;
  if (/<script id="filfil-static-more">[\s\S]*?<\/script>/i.test(html)) {
    html = html.replace(/<script id="filfil-static-more">[\s\S]*?<\/script>/i, replacement);
  } else {
    const original = /<script>\s*let showMore = \(\) => \{[\s\S]*?\n\s*\}\s*<\/script>/i;
    if (!original.test(html)) throw new Error(`Original showMore script missing in ${config.file}`);
    html = html.replace(original, replacement);
  }
  await fs.writeFile(file, html);
  return { name: config.name, initial, total, captured: cards.length };
}
const results = [];
for (const config of lists) results.push(await captureList(config));
const report = { lists: results, missingPages: [...missingPages], missingAssets };
await fs.writeFile(path.join(output, 'static-list-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
