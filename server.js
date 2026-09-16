import http from 'node:http';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(process.env.FILFIL_SITE_DIR || 'filfil-site');
const dataDir = path.resolve(process.env.FILFIL_DATA_DIR || 'data');
const port = Number(process.env.PORT || 8080);
const maxBody = 6 * 1024 * 1024;
await fs.mkdir(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'filfil.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS submissions (
 id INTEGER PRIMARY KEY, kind TEXT NOT NULL, page TEXT NOT NULL,
 fields TEXT NOT NULL, attachment_name TEXT, attachment_type TEXT,
 attachment BLOB, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ratings (
 id INTEGER PRIMARY KEY, product_id TEXT NOT NULL, rating REAL NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
const insertSubmission = db.prepare('INSERT INTO submissions (kind,page,fields,attachment_name,attachment_type,attachment) VALUES (?,?,?,?,?,?)');
const insertRating = db.prepare('INSERT INTO ratings (product_id,rating) VALUES (?,?)');
const attempts = new Map();
const kinds = new Map([
  ['/Contact/SendComment', 'contact'], ['/Career/Send', 'career'],
  ['/WorkWithUs/Send', 'partner'], ['/Products/SendComment', 'product-comment']
]);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif', '.woff':'font/woff', '.woff2':'font/woff2', '.ico':'image/x-icon', '.pdf':'application/pdf', '.mp4':'video/mp4' };
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function send(res, status, body, type='text/plain; charset=utf-8', headers={}) {
  res.writeHead(status, { 'content-type':type, 'x-content-type-options':'nosniff', ...headers });
  res.end(body);
}
function clientError(res, status, message) { send(res,status,JSON.stringify({ error:message }),'application/json; charset=utf-8'); }
async function readForm(req, url) {
  const parts=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>maxBody) throw new Error('Request exceeds 6 MB'); parts.push(chunk); }
  const body=Buffer.concat(parts);
  const request=new Request(url, { method:'POST', headers:{'content-type':req.headers['content-type']||'application/x-www-form-urlencoded'}, body });
  return request.formData();
}
function rateLimit(req) {
  const ip=req.socket.remoteAddress||'unknown', now=Date.now();
  const recent=(attempts.get(ip)||[]).filter(t=>now-t<60000);
  if(recent.length>=8) return false;
  recent.push(now); attempts.set(ip,recent); return true;
}
function sameOrigin(req) {
  const origin=req.headers.origin;
  if(!origin) return true;
  try { return new URL(origin).host===req.headers.host; } catch { return false; }
}
async function searchIndex() {
  const results=[];
  async function visit(folder) {
    for(const entry of await fs.readdir(folder,{withFileTypes:true})) {
      if(entry.name==='node_modules') continue;
      const name=path.join(folder,entry.name);
      if(entry.isDirectory()) await visit(name);
      else if(entry.name==='index.html') {
        const html=await fs.readFile(name,'utf8');
        const title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||entry.name).replace(/<[^>]+>/g,'').trim();
        const body=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,30000);
        results.push({ title, body, url:'/'+path.relative(root,name).split(path.sep).join('/') });
      }
    }
  }
  await visit(root);
  return results;
}
const indexedPages=await searchIndex();
function searchPage(query) {
  const q=query.trim().slice(0,100), terms=q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const found=terms.length ? indexedPages.filter(p=>terms.every(t=>(p.title+' '+p.body).toLocaleLowerCase().includes(t))).slice(0,100) : [];
  const items=found.map(p=>`<li><a href="${encodeURI(p.url)}">${escapeHtml(p.title)}</a></li>`).join('');
  return `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>جستجو | فیلفیل</title><style>body{font:1.1rem sans-serif;max-width:800px;margin:3rem auto;padding:1rem}input{padding:.6rem;width:70%}button{padding:.6rem}li{margin:.7rem 0}</style><a href="/">خانه</a><h1>جستجو</h1><form action="/search/" method="get"><input name="q" value="${escapeHtml(q)}"><button>جستجو</button></form><p>${found.length} نتیجه</p><ul>${items}</ul></html>`;
}
async function serveFile(req,res,pathname) {
  let name;
  try { name=decodeURIComponent(pathname); } catch { return send(res,400,'Bad path'); }
  if(name.endsWith('/')) name+='index.html';
  const target=path.resolve(root,'.'+name);
  if(!target.startsWith(root+path.sep)) return send(res,403,'Forbidden');
  let stat;
  try { stat=await fs.stat(target); } catch { return send(res,404,'Not found'); }
  if(stat.isDirectory()) return send(res,301,'',{location:pathname+'/'});
  if(!stat.isFile()) return send(res,404,'Not found');
  const type=mime[path.extname(target).toLowerCase()]||'application/octet-stream';
  if(type.startsWith('text/html')) {
    let html=await fs.readFile(target,'utf8');
    html=html.replace(/<\/body>/i,'<script src="/mirror-app.js" defer></script></body>');
    return send(res,200,html,type,{'cache-control':'no-cache'});
  }
  res.writeHead(200,{'content-type':type,'content-length':stat.size,'x-content-type-options':'nosniff'});
  if(req.method==='HEAD') return res.end();
  createReadStream(target).pipe(res);
}
const clientJs=await fs.readFile(new URL('./server-client.js',import.meta.url),'utf8');
const server=http.createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    const pathname=url.pathname;
    if(req.method==='GET' && pathname==='/mirror-app.js') return send(res,200,clientJs,'text/javascript; charset=utf-8');
    if(req.method==='GET' && pathname==='/search/') return send(res,200,searchPage(url.searchParams.get('q')||''),'text/html; charset=utf-8');
    if(req.method==='GET' && pathname==='/health') return send(res,200,'ok');
    if(req.method==='GET' && pathname==='/api/submissions') {
      const token=process.env.FILFIL_ADMIN_TOKEN;
      if(!token || req.headers.authorization!==`Bearer ${token}`) return clientError(res,401,'Unauthorized');
      const rows=db.prepare('SELECT id,kind,page,fields,attachment_name,attachment_type,created_at FROM submissions ORDER BY id DESC LIMIT 1000').all();
      return send(res,200,JSON.stringify(rows),'application/json; charset=utf-8',{'cache-control':'no-store'});
    }
    if(req.method==='GET' && /^\/api\/submissions\/\d+\/attachment$/.test(pathname)) {
      const token=process.env.FILFIL_ADMIN_TOKEN;
      if(!token || req.headers.authorization!==`Bearer ${token}`) return clientError(res,401,'Unauthorized');
      const id=Number(pathname.split('/')[3]);
      const row=db.prepare('SELECT attachment_name,attachment_type,attachment FROM submissions WHERE id=?').get(id);
      if(!row?.attachment) return send(res,404,'Not found');
      const filename=(row.attachment_name||'attachment').replace(/[\r\n"\\/]/g,'_');
      return send(res,200,row.attachment,row.attachment_type||'application/octet-stream',{
        'content-disposition':`attachment; filename="${filename}"`, 'cache-control':'no-store'
      });
    }
    if(req.method==='POST' && (kinds.has(pathname)||pathname==='/products/product-rate'||pathname==='/Search/Index')) {
      if(!sameOrigin(req)) return clientError(res,403,'Invalid origin');
      if(!rateLimit(req)) return clientError(res,429,'Please wait before submitting again');
      const form=await readForm(req,url);
      if(pathname==='/Search/Index') return send(res,303,'',{location:'/search/?q='+encodeURIComponent(String(form.get('search')||''))});
      if(String(form.get('website')||'')) return send(res,200,JSON.stringify({ok:true}),'application/json; charset=utf-8');
      if(pathname==='/products/product-rate') {
        const product=String(form.get('id')||'').slice(0,100), rating=Number(form.get('rate'));
        if(!product || !Number.isFinite(rating) || rating<0 || rating>5) return clientError(res,400,'Invalid rating');
        insertRating.run(product,rating);
        return send(res,200,JSON.stringify('success'),'application/json; charset=utf-8');
      }
      const kind=kinds.get(pathname), fields={}; let attachment=null;
      for(const [key,value] of form) {
        if(['__RequestVerificationToken','captcha','website'].includes(key)) continue;
        if(value instanceof File) { if(value.size) attachment=value; continue; }
        fields[key]=String(value).trim().slice(0,8000);
      }
      fields.PagePath=String(fields.PagePath||req.headers.referer||'').slice(0,1000);
      const required=kind==='contact'?['Name','Text']:kind==='product-comment'?['Name','CommentText']:kind==='career'?['FullName']:['NameStore','Name','Phone'];
      if(required.some(k=>!fields[k])) return clientError(res,400,'Please complete the required fields');
      if(attachment && attachment.size>5*1024*1024) return clientError(res,413,'Attachment exceeds 5 MB');
      const bytes=attachment?Buffer.from(await attachment.arrayBuffer()):null;
      insertSubmission.run(kind,fields.PagePath,JSON.stringify(fields),attachment?.name?.slice(0,255)||null,attachment?.type?.slice(0,100)||null,bytes);
      return send(res,200,JSON.stringify({ok:true,message:'پیام شما ثبت شد.'}),'application/json; charset=utf-8');
    }
    if(req.method==='POST' && pathname==='/Career/ShowDynamicFields') return send(res,200,'','text/html; charset=utf-8');
    if(req.method==='GET' && pathname==='/Career/GetCareerId') return send(res,200,'{}','application/json; charset=utf-8');
    if(req.method==='GET'||req.method==='HEAD') return serveFile(req,res,pathname);
    return send(res,404,'Not found');
  } catch(error) {
    console.error(error);
    return clientError(res,error.message==='Request exceeds 6 MB'?413:500,error.message==='Request exceeds 6 MB'?error.message:'Server error');
  }
});
server.listen(port,'0.0.0.0',()=>console.log(`Filfil server: http://localhost:${port} (${indexedPages.length} indexed pages)`));
