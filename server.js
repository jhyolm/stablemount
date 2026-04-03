import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env before anything touches process.env
(function loadEnv() {
  const p = join(__dirname, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
})();

import {
  ensureDirs, safePath,
  getSite, updateSite,
  hasPassword, setPassword, verifyPassword, createSession, validateSession, destroySession,
  saveSnapshot, listSnapshots, getSnapshot, restoreSnapshot,
  listDecisions, createDecision, updateDecision, deleteDecision, saveDecisions,
  listPartials, getPartialHTML, createPartial, updatePartial, deletePartial,
  listPages, getPageBySlug, getPageHTML, createPage, updatePage, savePageHTML, deletePage,
  getPartialByName, getPartialHTMLByName, savePartialHTMLByName,
  getChat, appendChat, clearChat,
  listCollections, getCollection, getCollectionBySlug, createCollection, updateCollection, deleteCollection,
  getCollectionListingHTML, saveCollectionListingHTML, getCollectionDetailHTML, saveCollectionDetailHTML,
  listEntries, getEntry, getEntryBySlug, createEntry, updateEntry, deleteEntry,
  listFunctions, getFunctionCode, saveFunctionCode, deleteFunction as deleteFunc,
  listMedia, addMedia, deleteMedia,
} from './core/store.js';
import { generatePage, chatModifyPage, chatSite, generateCollectionTemplates, MODELS, getChatModel, setChatModel } from './core/ai.js';
import { parsePartial, resolvePartials, restorePartialDirectives } from './core/partial.js';
import { renderListing, renderDetail, resolveCollectionDirectives, restoreCollectionDirectives } from './core/collection.js';
import { localizeImages } from './core/images.js';
import { executeFunction } from './core/functions.js';
import { loadExtensions, matchRoute, matchPage, runHook, runTransformHook, watchExtensions } from './core/extensions.js';

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp',
};

function sanitizeSlug(s) {
  return s.replace(/[^a-zA-Z0-9_-]/g, '');
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function serveFile(res, filePath) {
  if (!existsSync(filePath)) return send(res, 404, '{"error":"Not found"}');
  const ext = extname(filePath);
  send(res, 200, readFileSync(filePath, 'utf8'), MIME[ext] || 'text/plain');
}

const MAX_JSON_BODY = 2 * 1024 * 1024;  // 2 MB
const MAX_UPLOAD_SIZE = 20 * 1024 * 1024; // 20 MB

function readBody(req, limit = MAX_JSON_BODY) {
  return new Promise((resolve, reject) => {
    let d = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new Error('Request body too large')); return; }
      d += c;
    });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

function readBodyBuffer(req, limit = MAX_UPLOAD_SIZE) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new Error('Upload too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function jsonBody(req) {
  const raw = await readBody(req);
  return raw ? JSON.parse(raw) : {};
}

function injectOverlay(html, slug, pageTitle) {
  const config = `<script data-sm-overlay>window.__SM__={slug:${JSON.stringify(slug)},title:${JSON.stringify(pageTitle || slug)}};</script>`;
  const css = '<link rel="stylesheet" href="/overlay/overlay.css" data-sm-overlay>';
  const js = '<script src="/overlay/overlay.js" data-sm-overlay></script>';
  const lr = '<script data-sm-overlay>(() => { let r = false; const e = new EventSource("/api/livereload"); e.onopen = () => { if (r) location.reload(); }; e.onerror = () => { r = true; }; })();</script>';
  html = html.replace('</head>', `${css}\n${config}\n</head>`);
  html = html.replace('</body>', `${js}\n${lr}\n</body>`);
  return html;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  }
  return cookies;
}

function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
}

function setSessionCookie(res, token, req) {
  const secure = isSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sm_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secure}`);
}

function clearSessionCookie(res, req) {
  const secure = isSecure(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sm_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
}

const ALLOWED_UPLOAD_TYPES = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.pdf',
  '.mp4', '.webm', '.mp3', '.ogg', '.wav', '.woff', '.woff2', '.ttf', '.otf',
]);

function isAuthenticated(req) {
  if (!hasPassword()) return true;
  const cookies = parseCookies(req);
  return validateSession(cookies.sm_session);
}

// Load developer extensions at startup, hot-reload on file changes
let extensions = { routes: new Map(), middleware: [], hooks: { onRequest: [], onPageRender: [], onPageSave: [], onContentChange: [], onAIResponse: [] }, manifests: [] };
(async () => {
  try {
    extensions = await loadExtensions();
  } catch (err) {
    console.error('Extension loading failed:', err.message);
  }
  watchExtensions(ext => { extensions = ext; });
})();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    ensureDirs();

    // ── Extension: onRequest hook ──
    const reqHookResult = await runHook(extensions.hooks, 'onRequest', { path, method, headers: req.headers, url });
    if (reqHookResult?.redirect) {
      res.writeHead(302, { Location: reqHookResult.redirect });
      return res.end();
    }
    if (reqHookResult?.status) {
      return send(res, reqHookResult.status, reqHookResult.body || '');
    }

    // ── Auth routes (always accessible) ──
    if (path === '/login') {
      return serveFile(res, join(__dirname, 'core', 'auth', 'login.html'));
    }
    if (path === '/api/auth/status' && method === 'GET') {
      return send(res, 200, { setup: hasPassword(), authenticated: isAuthenticated(req) });
    }
    if (path === '/api/auth/setup' && method === 'POST') {
      if (hasPassword()) return send(res, 400, { error: 'Password already set' });
      const { password } = await jsonBody(req);
      if (!password || password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters' });
      setPassword(password);
      const token = createSession();
      setSessionCookie(res, token, req);
      return send(res, 200, { ok: true });
    }
    if (path === '/api/auth/login' && method === 'POST') {
      const { password } = await jsonBody(req);
      if (!verifyPassword(password)) return send(res, 401, { error: 'Invalid password' });
      const token = createSession();
      setSessionCookie(res, token, req);
      return send(res, 200, { ok: true });
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      const cookies = parseCookies(req);
      if (cookies.sm_session) destroySession(cookies.sm_session);
      clearSessionCookie(res, req);
      return send(res, 200, { ok: true });
    }

    // ── Auth guard ──
    if (hasPassword() && !isAuthenticated(req)) {
      if (path.startsWith('/api/')) return send(res, 401, { error: 'Unauthorized' });
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }

    // ── Livereload SSE ──
    if (path === '/api/livereload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: connected\n\n');
      const keepalive = setInterval(() => res.write(':\n\n'), 15000);
      req.on('close', () => clearInterval(keepalive));
      return;
    }

    // ── API: Site ──
    if (path === '/api/site' && method === 'GET') return send(res, 200, getSite());
    if (path === '/api/site' && method === 'PUT') return send(res, 200, updateSite(await jsonBody(req)));

    // ── API: AI Model ──
    if (path === '/api/ai/model' && method === 'GET') {
      return send(res, 200, { current: getChatModel(), options: MODELS });
    }
    if (path === '/api/ai/model' && method === 'PUT') {
      const { model } = await jsonBody(req);
      setChatModel(model);
      return send(res, 200, { current: getChatModel() });
    }

    // ── API: Media ──
    if (path === '/api/media' && method === 'GET') return send(res, 200, listMedia());
    let m = path.match(/^\/api\/media\/([^/]+)$/);
    if (m && method === 'DELETE') { deleteMedia(m[1]); return send(res, 204, ''); }

    if (path === '/api/media/upload' && method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      if (!contentType.includes('multipart/form-data')) return send(res, 400, { error: 'multipart required' });

      const boundary = contentType.split('boundary=')[1];
      const raw = await readBodyBuffer(req);

      const parts = raw.toString('binary').split('--' + boundary);
      let fileBuffer = null, fileName = '';
      for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd < 0) continue;
        const headers = part.slice(0, headerEnd);
        if (!headers.includes('filename="')) continue;
        const fnMatch = headers.match(/filename="([^"]+)"/);
        fileName = fnMatch ? fnMatch[1] : 'upload';
        const body = part.slice(headerEnd + 4);
        const trimmed = body.endsWith('\r\n') ? body.slice(0, -2) : body;
        fileBuffer = Buffer.from(trimmed, 'binary');
        break;
      }

      if (!fileBuffer) return send(res, 400, { error: 'no file found' });

      const ext = extname(fileName).toLowerCase() || '.jpg';
      if (!ALLOWED_UPLOAD_TYPES.has(ext)) return send(res, 400, { error: `File type ${ext} not allowed` });

      const { randomBytes } = await import('node:crypto');
      const name = randomBytes(8).toString('hex') + ext;
      const mediaDir = join(__dirname, 'content', 'media', 'uploads');
      if (!existsSync(mediaDir)) { const { mkdirSync } = await import('node:fs'); mkdirSync(mediaDir, { recursive: true }); }
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(mediaDir, name), fileBuffer);

      const mediaPath = `/media/uploads/${name}`;
      const mimeType = MIME[ext] || 'application/octet-stream';
      const item = addMedia({ path: mediaPath, originalName: fileName, size: fileBuffer.length, mimeType });

      return send(res, 200, { ...item, path: mediaPath, name });
    }

    // ── API: Decisions ──
    if (path === '/api/decisions' && method === 'GET') return send(res, 200, listDecisions());
    if (path === '/api/decisions' && method === 'POST') return send(res, 201, createDecision(await jsonBody(req)));
    m = path.match(/^\/api\/decisions\/([^/]+)$/);
    if (m && method === 'PUT') {
      const r = updateDecision(m[1], await jsonBody(req));
      return r ? send(res, 200, r) : send(res, 404, { error: 'Not found' });
    }
    if (m && method === 'DELETE') { deleteDecision(m[1]); return send(res, 204, ''); }

    // ── API: Partials ──
    if (path === '/api/partials' && method === 'GET') return send(res, 200, listPartials());
    if (path === '/api/partials' && method === 'POST') return send(res, 201, createPartial(await jsonBody(req)));
    m = path.match(/^\/api\/partials\/([^/]+)\/html$/);
    if (m && method === 'GET') return send(res, 200, getPartialHTML(m[1]), 'text/html');
    if (m && method === 'PUT') {
      updatePartial(m[1], { html: await readBody(req) });
      return send(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/partials\/([^/]+)$/);
    if (m && method === 'PUT') {
      const r = updatePartial(m[1], await jsonBody(req));
      return r ? send(res, 200, r) : send(res, 404, { error: 'Not found' });
    }
    if (m && method === 'DELETE') { deletePartial(m[1]); return send(res, 204, ''); }

    // ── API: Pages ──
    if (path === '/api/pages' && method === 'GET') return send(res, 200, listPages());
    if (path === '/api/pages' && method === 'POST') return send(res, 201, createPage(await jsonBody(req)));
    m = path.match(/^\/api\/pages\/([^/]+)\/html$/);
    if (m && method === 'PUT') {
      let html = await readBody(req);
      html = restorePartialDirectives(html);
      html = restoreCollectionDirectives(html);
      html = await runTransformHook(extensions.hooks, 'onPageSave', html, m[1]);
      savePageHTML(m[1], html);
      runHook(extensions.hooks, 'onContentChange', { type: 'page', slug: m[1], action: 'save' });
      return send(res, 200, { ok: true });
    }
    m = path.match(/^\/api\/pages\/([^/]+)$/);
    if (m && method === 'PUT') {
      const r = updatePage(m[1], await jsonBody(req));
      return r ? send(res, 200, r) : send(res, 404, { error: 'Not found' });
    }
    if (m && method === 'DELETE') { deletePage(m[1]); return send(res, 204, ''); }

    // ── API: Version History ──
    m = path.match(/^\/api\/history\/(pages|partials)\/([^/]+)$/);
    if (m && method === 'GET') {
      const slug = sanitizeSlug(m[2]);
      return send(res, 200, listSnapshots(m[1], slug));
    }
    m = path.match(/^\/api\/history\/(pages|partials)\/([^/]+)\/([^/]+)$/);
    if (m && method === 'GET') {
      const slug = sanitizeSlug(m[2]);
      const snapId = sanitizeSlug(m[3]);
      const content = getSnapshot(m[1], slug, snapId);
      return content !== null ? send(res, 200, content, 'text/html') : send(res, 404, { error: 'Not found' });
    }
    m = path.match(/^\/api\/history\/(pages|partials)\/([^/]+)\/([^/]+)\/restore$/);
    if (m && method === 'POST') {
      const slug = sanitizeSlug(m[2]);
      const snapId = sanitizeSlug(m[3]);
      const content = restoreSnapshot(m[1], slug, snapId);
      return content !== null ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Not found' });
    }

    // ── API: Publish ──
    if (path === '/api/publish' && method === 'POST') {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);
      try {
        const { stdout, stderr } = await execAsync('node export.js', { cwd: __dirname, timeout: 30000 });
        return send(res, 200, { ok: true, output: stdout });
      } catch (err) {
        return send(res, 500, { error: err.message, output: err.stdout || '' });
      }
    }

    // ── API: Generate ──
    if (path === '/api/generate' && method === 'POST') {
      const body = await jsonBody(req);
      const intent = body.intent;
      const title = body.title;
      let slug = (body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
      if (!slug) {
        slug = (body.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      }
      if (!slug) slug = 'home';
      const existingSlugs = listPages().map(p => p.slug);
      if (existingSlugs.includes(slug)) {
        let n = 2;
        while (existingSlugs.includes(`${slug}-${n}`)) n++;
        slug = `${slug}-${n}`;
      }
      if (!intent || !body.title) return send(res, 400, { error: 'intent and title are required' });

      const result = await generatePage(intent, slug);

      // Save proposed decisions (skip duplicates by name)
      const existingDecisions = listDecisions();
      const newDecisions = [];
      for (const d of result.decisions) {
        if (!d.name || !d.kind) continue;
        if (existingDecisions.some(e => e.name.toLowerCase() === d.name.toLowerCase())) continue;
        newDecisions.push(createDecision({
          name: d.name, kind: d.kind,
          weight: d.weight || 'rule', scope: d.scope || 'global',
          content: d.content || '',
        }));
      }

      // Save proposed partials (skip duplicates by name)
      const existingPartials = listPartials();
      const newPartials = [];
      for (const c of result.components) {
        if (!c.name || !c.html) continue;
        if (existingPartials.some(e => e.name.toLowerCase() === c.name.toLowerCase())) continue;
        newPartials.push(createPartial({
          name: c.name, html: c.html,
          weight: c.weight || 'rule',
          scope: c.scope || 'global',
        }));
      }

      const page = createPage({ title, slug, intent });
      const finalHTML = await localizeImages(result.html);
      savePageHTML(slug, finalHTML);

      return send(res, 201, { page, newDecisions, newPartials });
    }

    // ── API: Unified Chat ──
    if (path === '/api/chat' && method === 'POST') {
      const { message, slug: pageSlug, html: pageHTML, selection } = await jsonBody(req);
      if (!message) return send(res, 400, { error: 'message required' });

      const chatSlug = pageSlug || 'site';
      appendChat(chatSlug, { role: 'user', content: message });

      const history = getChat(chatSlug)
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .map(msg => ({ role: msg.role, content: msg.content }));

      let aiMessage = message;
      if (selection && selection.html) {
        aiMessage = `[SELECTED AREA: ${selection.name || 'element'}]\n${selection.html}\n[/SELECTED]\n\n${message}`;
      }

      const result = await chatSite(aiMessage, history, pageHTML || null, pageSlug || null);

      console.log('[chat] reply:', result.reply);
      console.log('[chat] actions:', JSON.stringify(result.actions, null, 2));
      console.log('[chat] changes:', result.changes.length, 'patches');

      const actionResults = [];
      for (const a of result.actions) {
        console.log('[chat] executing action:', a.action, a.slug || a.collection || '');
        try {
          switch (a.action) {
            case 'createCollection': {
              createCollection({ name: a.name, slug: a.slug, schema: a.schema || [] });
              actionResults.push({ action: 'createCollection', slug: a.slug });
              break;
            }
            case 'createEntry': {
              createEntry(a.collection, { slug: a.slug, data: a.data || {} });
              actionResults.push({ action: 'createEntry', collection: a.collection, slug: a.slug });
              break;
            }
            case 'createPage': {
              const genResult = await generatePage(a.intent || `A ${a.title} page`);
              createPage({ title: a.title, slug: a.slug, intent: a.intent || '' });
              const finalHTML = await localizeImages(genResult.html);
              savePageHTML(a.slug, finalHTML);
              actionResults.push({ action: 'createPage', slug: a.slug });
              break;
            }
            case 'deletePage': {
              const pg = getPageBySlug(a.slug);
              if (pg) { deletePage(pg.id); actionResults.push({ action: 'deletePage', slug: a.slug }); }
              break;
            }
            case 'deleteCollection': {
              const col = getCollectionBySlug(a.slug);
              if (col) { deleteCollection(col.id); actionResults.push({ action: 'deleteCollection', slug: a.slug }); }
              break;
            }
            case 'deleteEntry': {
              const entryCol = getCollectionBySlug(a.collection);
              if (entryCol) {
                const entries = listEntries(a.collection);
                const entry = entries.find(e => e.slug === a.slug);
                if (entry) { deleteEntry(a.collection, entry.id); actionResults.push({ action: 'deleteEntry', slug: a.slug }); }
              }
              break;
            }
            case 'createFunction': {
              if (a.name && a.code) {
                saveFunctionCode(a.name, a.code);
                actionResults.push({ action: 'createFunction', name: a.name });
              }
              break;
            }
            case 'deleteFunction': {
              if (a.name) {
                deleteFunc(a.name);
                actionResults.push({ action: 'deleteFunction', name: a.name });
              }
              break;
            }
          }
        } catch (err) {
          console.error(`Action ${a.action} failed:`, err.message);
        }
      }

      let modifiedPageHTML = null;
      const applied = [];

      for (const c of result.changes) {
        if (!c.file || !c.old || c.new === undefined) continue;

        if (c.file.startsWith('pages/') && c.file.endsWith('.html')) {
          const targetSlug = c.file.replace('pages/', '').replace('.html', '');
          if (targetSlug === pageSlug && pageHTML) {
            if (!modifiedPageHTML) modifiedPageHTML = pageHTML;
            if (modifiedPageHTML.includes(c.old)) {
              modifiedPageHTML = modifiedPageHTML.replace(c.old, c.new);
              applied.push(c.file);
            }
          } else {
            let targetHTML = getPageHTML(targetSlug);
            if (targetHTML && targetHTML.includes(c.old)) {
              targetHTML = targetHTML.replace(c.old, c.new);
              targetHTML = await localizeImages(targetHTML);
              savePageHTML(targetSlug, targetHTML);
              applied.push(c.file);
            }
          }
        } else if (c.file.startsWith('partials/') && c.file.endsWith('.html')) {
          const partialName = c.file.replace('partials/', '').replace('.html', '');
          let partialHTML = getPartialHTMLByName(partialName);
          if (partialHTML && partialHTML.includes(c.old)) {
            partialHTML = partialHTML.replace(c.old, c.new);
            savePartialHTMLByName(partialName, partialHTML);
            applied.push(c.file);
          }
        } else if (c.file === 'decisions.json') {
          let raw = JSON.stringify(listDecisions(), null, 2);
          if (raw.includes(c.old)) {
            raw = raw.replace(c.old, c.new);
            try { saveDecisions(JSON.parse(raw)); applied.push(c.file); }
            catch (_) { }
          }
        } else if (c.file === 'site.json') {
          let raw = JSON.stringify(getSite(), null, 2);
          if (raw.includes(c.old)) {
            raw = raw.replace(c.old, c.new);
            try { updateSite(JSON.parse(raw)); applied.push(c.file); }
            catch (_) { }
          }
        } else if (c.file.startsWith('functions/') && c.file.endsWith('.js')) {
          const fnName = c.file.replace('functions/', '').replace('.js', '');
          let code = getFunctionCode(fnName);
          if (code && code.includes(c.old)) {
            code = code.replace(c.old, c.new);
            saveFunctionCode(fnName, code);
            applied.push(c.file);
          }
        }
      }

      if (modifiedPageHTML && modifiedPageHTML !== pageHTML) {
        modifiedPageHTML = await localizeImages(modifiedPageHTML);
        savePageHTML(pageSlug, modifiedPageHTML);
        runHook(extensions.hooks, 'onContentChange', { type: 'page', slug: pageSlug, action: 'ai-edit' });
      }

      appendChat(chatSlug, { role: 'assistant', content: result.reply });

      await runHook(extensions.hooks, 'onAIResponse', { reply: result.reply, changes: result.changes, actions: result.actions, page: pageSlug });

      return send(res, 200, {
        reply: result.reply,
        html: modifiedPageHTML && modifiedPageHTML !== pageHTML ? modifiedPageHTML : null,
        applied,
        actionResults,
      });
    }

    // ── API: Chat history (per-slug) ──
    m = path.match(/^\/api\/chat\/([^/]+)$/);
    if (m && method === 'GET') return send(res, 200, getChat(m[1]));
    if (m && method === 'DELETE') { clearChat(m[1]); return send(res, 204, ''); }

    // ── API: Collections ──
    if (path === '/api/collections' && method === 'GET') return send(res, 200, listCollections());
    if (path === '/api/collections' && method === 'POST') return send(res, 201, createCollection(await jsonBody(req)));
    m = path.match(/^\/api\/collections\/([^/]+)$/);
    if (m && method === 'GET') {
      const c = getCollection(m[1]);
      return c ? send(res, 200, c) : send(res, 404, { error: 'Not found' });
    }
    if (m && method === 'PUT') {
      const r = updateCollection(m[1], await jsonBody(req));
      return r ? send(res, 200, r) : send(res, 404, { error: 'Not found' });
    }
    if (m && method === 'DELETE') { deleteCollection(m[1]); return send(res, 204, ''); }

    // Collection templates
    m = path.match(/^\/api\/collections\/([^/]+)\/(listing|detail)$/);
    if (m && method === 'GET') {
      const col = getCollection(m[1]);
      if (!col) return send(res, 404, { error: 'Not found' });
      const html = m[2] === 'listing' ? getCollectionListingHTML(col.slug) : getCollectionDetailHTML(col.slug);
      return send(res, 200, html || '', 'text/html');
    }
    if (m && method === 'PUT') {
      const col = getCollection(m[1]);
      if (!col) return send(res, 404, { error: 'Not found' });
      const html = await readBody(req);
      if (m[2] === 'listing') saveCollectionListingHTML(col.slug, html);
      else saveCollectionDetailHTML(col.slug, html);
      return send(res, 200, { ok: true });
    }

    // Generate collection templates
    m = path.match(/^\/api\/collections\/([^/]+)\/generate$/);
    if (m && method === 'POST') {
      const col = getCollection(m[1]);
      if (!col) return send(res, 404, { error: 'Not found' });
      const result = await generateCollectionTemplates(col);
      if (result.listing) result.listing = await localizeImages(result.listing);
      if (result.detail) result.detail = await localizeImages(result.detail);
      saveCollectionListingHTML(col.slug, result.listing);
      saveCollectionDetailHTML(col.slug, result.detail);
      return send(res, 200, { ok: true, listing: !!result.listing, detail: !!result.detail });
    }

    // ── API: Entries ──
    m = path.match(/^\/api\/collections\/([^/]+)\/entries$/);
    if (m && method === 'GET') {
      const col = getCollection(m[1]);
      if (!col) return send(res, 404, { error: 'Not found' });
      return send(res, 200, listEntries(col.slug));
    }
    if (m && method === 'POST') {
      const col = getCollection(m[1]);
      if (!col) return send(res, 404, { error: 'Not found' });
      return send(res, 201, createEntry(col.slug, await jsonBody(req)));
    }
    m = path.match(/^\/api\/collections\/([^/]+)\/entries\/([^/]+)$/);
    if (m && method === 'GET') {
      const col = getCollection(m[1]);
      if (!col) return send(res, 404, { error: 'Not found' });
      const e = getEntry(col.slug, m[2]);
      return e ? send(res, 200, e) : send(res, 404, { error: 'Not found' });
    }
    if (m && method === 'PUT') {
      const col = getCollection(m[1]);
      if (!col) return send(res, 404, { error: 'Not found' });
      const r = updateEntry(col.slug, m[2], await jsonBody(req));
      return r ? send(res, 200, r) : send(res, 404, { error: 'Not found' });
    }
    if (m && method === 'DELETE') {
      const col = getCollection(m[1]);
      if (!col) return send(res, 404, { error: 'Not found' });
      deleteEntry(col.slug, m[2]);
      return send(res, 204, '');
    }

    // ── API: Extension Manifest ──
    if (path === '/api/extensions/manifest' && method === 'GET') {
      return send(res, 200, extensions.manifests || []);
    }

    // ── API: Dashboard Functions ──
    m = path.match(/^\/api\/fn\/([a-z0-9-]+)$/);
    if (m) {
      const fnName = m[1];
      const query = Object.fromEntries(url.searchParams);
      let body = null;
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        try { body = await jsonBody(req); } catch { body = {}; }
      }
      const result = await executeFunction(fnName, method, { body, query, params: {} });
      return send(res, result.status, result.body);
    }

    // ── Extension routes (/x/*) ──
    if (path.startsWith('/x/')) {
      const extPath = path.slice(2);
      const match = matchRoute(extensions.routes, extPath);
      if (match) {
        const handler = match.handlers[method];
        if (!handler) return send(res, 405, { error: 'Method not allowed' });
        try {
          const query = Object.fromEntries(url.searchParams);
          let body = null;
          if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
            try { body = await jsonBody(req); } catch { body = {}; }
          }
          const result = await handler({ body, query, params: match.params, req, res });
          if (result && !res.writableEnded) {
            const contentType = result.type || (typeof result.body === 'string' && result.body.trimStart().startsWith('<') ? 'text/html' : 'application/json');
            return send(res, result.status || 200, result.body || result, contentType);
          }
          if (!res.writableEnded) return send(res, 200, { ok: true });
        } catch (err) {
          console.error(`[ext] ${extPath} error:`, err.message);
          if (!res.writableEnded) return send(res, 500, { error: err.message });
        }
        return;
      }
    }

    // ── Dashboard ──
    if (path === '/dashboard' || path === '/dashboard/') {
      return serveFile(res, join(__dirname, 'core', 'dashboard', 'index.html'));
    }
    if (path.startsWith('/dashboard/')) {
      try {
        const filePath = safePath(join(__dirname, 'core', 'dashboard'), path.slice('/dashboard/'.length));
        return serveFile(res, filePath);
      } catch { return send(res, 403, '{"error":"Forbidden"}'); }
    }

    // ── Overlay static files ──
    if (path.startsWith('/overlay/')) {
      try {
        const filePath = safePath(join(__dirname, 'core', 'overlay'), path.slice('/overlay/'.length));
        return serveFile(res, filePath);
      } catch { return send(res, 403, '{"error":"Forbidden"}'); }
    }

    // ── Media files ──
    if (path.startsWith('/media/')) {
      try {
        const mediaPath = safePath(join(__dirname, 'content', 'media'), path.slice('/media/'.length));
        if (existsSync(mediaPath)) {
          const ext = extname(mediaPath);
          const contentType = MIME[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          return res.end(readFileSync(mediaPath));
        }
      } catch { return send(res, 403, '{"error":"Forbidden"}'); }
    }

    // ── Serve Collection pages (/blog, /blog/my-post, etc.) ──
    const pathParts = path.slice(1).replace(/\/$/, '').split('/');
    if (pathParts.length <= 2 && pathParts[0]) {
      const col = getCollectionBySlug(pathParts[0]);
      if (col) {
        if (pathParts.length === 1) {
          let html = renderListing(col.slug, col.name);
          if (html) {
            html = resolveCollectionDirectives(html);
            html = injectOverlay(html, col.slug, col.name);
            return send(res, 200, html, 'text/html');
          }
        } else {
          let html = renderDetail(col.slug, pathParts[1], col.name);
          if (html) {
            html = resolveCollectionDirectives(html);
            html = injectOverlay(html, `${col.slug}/${pathParts[1]}`, pathParts[1]);
            return send(res, 200, html, 'text/html');
          }
        }
      }
    }

    // ── Redirect /home to / ──
    if (path === '/home') {
      res.writeHead(301, { Location: '/' });
      return res.end();
    }

    // ── Serve Pages (clean URLs: / = home, /about = about, etc.) ──
    const slug = (path === '/') ? 'home' : path.slice(1).replace(/\.html$/, '').replace(/\/$/, '');
    if (slug) {
      let html = getPageHTML(slug);
      if (html) {
        // Run extension middleware before rendering
        for (const mw of extensions.middleware) {
          if (matchPage(mw.pages, slug)) {
            try {
              const mwResult = await mw.before({ path, slug, method, headers: req.headers });
              if (mwResult?.redirect) {
                res.writeHead(302, { Location: mwResult.redirect });
                return res.end();
              }
              if (mwResult?.status) {
                return send(res, mwResult.status, mwResult.body || '', 'text/html');
              }
            } catch (err) {
              console.error(`[middleware] error for ${slug}:`, err.message);
            }
          }
        }

        const page = getPageBySlug(slug);
        html = resolvePartials(html, slug);
        html = resolveCollectionDirectives(html);

        html = await runTransformHook(extensions.hooks, 'onPageRender', html, slug);

        html = injectOverlay(html, slug, page?.title);
        return send(res, 200, html, 'text/html');
      }
    }

    // No page found at root → redirect to dashboard
    if (path === '/') {
      res.writeHead(302, { Location: '/dashboard' });
      return res.end();
    }

    send(res, 404, '<h1>Page not found</h1>', 'text/html');

  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Stablemount v0.1`);
  console.log(`  Dashboard:  http://localhost:${PORT}/dashboard`);
  console.log(`  Site root:  http://localhost:${PORT}/\n`);
});
