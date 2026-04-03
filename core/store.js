import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, rmSync, renameSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT = join(__dirname, '..', 'content');

export const PATHS = {
  content: CONTENT,
  site: join(CONTENT, 'site.json'),
  decisions: join(CONTENT, 'decisions.json'),
  partials: join(CONTENT, 'partials.json'),
  pages: join(CONTENT, 'pages.json'),
  pagesDir: join(CONTENT, 'pages'),
  partialsDir: join(CONTENT, 'partials'),
  collectionsDir: join(CONTENT, 'collections'),
  mediaDir: join(CONTENT, 'media'),
  chatsDir: join(CONTENT, 'chats'),
  functionsDir: join(CONTENT, 'functions'),
  historyDir: join(CONTENT, 'history'),
  users: join(CONTENT, 'users.json'),
};

export function ensureDirs() {
  for (const dir of [CONTENT, PATHS.pagesDir, PATHS.partialsDir, PATHS.collectionsDir, PATHS.mediaDir, PATHS.chatsDir, PATHS.functionsDir, PATHS.historyDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
ensureDirs();

export function genId() {
  return randomBytes(12).toString('hex');
}

function readJSON(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, filePath);
}

function writeFileAtomic(filePath, content) {
  const tmp = filePath + '.tmp.' + process.pid;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, filePath);
}

export function safePath(base, ...segments) {
  const resolved = resolve(base, ...segments);
  const rel = relative(base, resolved);
  if (rel.startsWith('..') || resolve(base, rel) !== resolved) {
    throw new Error('Path traversal blocked');
  }
  return resolved;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Site ──

export function getSite() {
  return readJSON(PATHS.site, { name: 'My Website' });
}

export function updateSite(updates) {
  const site = getSite();
  Object.assign(site, updates);
  writeJSON(PATHS.site, site);
  return site;
}

// ── Users & Auth ──

const USERS_FILE = join(CONTENT, 'users.json');

function hashPassword(plaintext) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plaintext, salt, 64).toString('hex');
  return { passwordHash: hash, passwordSalt: salt };
}

function verifyHash(plaintext, hash, salt) {
  const derived = scryptSync(plaintext, salt, 64);
  return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}

function sanitizeUser(user) {
  const { passwordHash, passwordSalt, ...safe } = user;
  return safe;
}

export function listUsers() {
  return readJSON(USERS_FILE, []);
}

export function hasUsers() {
  return listUsers().length > 0;
}

export function getUser(id) {
  return listUsers().find(u => u.id === id) || null;
}

export function getUserByUsername(username) {
  return listUsers().find(u => u.username === username) || null;
}

export function createUser({ username, displayName, password, role = 'editor' }) {
  const users = listUsers();
  if (users.find(u => u.username === username)) {
    throw new Error('Username already exists');
  }
  const { passwordHash, passwordSalt } = hashPassword(password);
  const user = {
    id: genId(), username, displayName: displayName || username,
    role, passwordHash, passwordSalt,
    created: Date.now(), lastLogin: null,
  };
  users.push(user);
  writeJSON(USERS_FILE, users);
  return sanitizeUser(user);
}

export function updateUser(id, updates) {
  const users = listUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  if (updates.username && updates.username !== users[idx].username) {
    if (users.find(u => u.username === updates.username && u.id !== id)) {
      throw new Error('Username already exists');
    }
  }
  const allowed = ['username', 'displayName', 'role'];
  for (const key of allowed) {
    if (updates[key] !== undefined) users[idx][key] = updates[key];
  }
  writeJSON(USERS_FILE, users);
  return sanitizeUser(users[idx]);
}

export function deleteUser(id) {
  writeJSON(USERS_FILE, listUsers().filter(u => u.id !== id));
}

export function changePassword(id, newPassword) {
  const users = listUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  const { passwordHash, passwordSalt } = hashPassword(newPassword);
  users[idx].passwordHash = passwordHash;
  users[idx].passwordSalt = passwordSalt;
  writeJSON(USERS_FILE, users);
  return true;
}

export function verifyUserPassword(username, plaintext) {
  const user = getUserByUsername(username);
  if (!user || !user.passwordHash || !user.passwordSalt) return null;
  if (!verifyHash(plaintext, user.passwordHash, user.passwordSalt)) return null;
  const users = listUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx >= 0) { users[idx].lastLogin = Date.now(); writeJSON(USERS_FILE, users); }
  return sanitizeUser(user);
}

export function migrateAuth() {
  if (existsSync(USERS_FILE) && listUsers().length > 0) return;
  const site = getSite();
  if (site.passwordHash && site.passwordSalt) {
    const user = {
      id: genId(), username: 'admin', displayName: 'Admin',
      role: 'admin',
      passwordHash: site.passwordHash, passwordSalt: site.passwordSalt,
      created: Date.now(), lastLogin: null,
    };
    writeJSON(USERS_FILE, [user]);
    delete site.passwordHash;
    delete site.passwordSalt;
    writeJSON(PATHS.site, site);
    console.log('Migrated to multi-user auth. Default username: admin');
  }
}

const sessions = new Map();
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { userId, created: Date.now() });
  return token;
}

export function getSessionUser(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.created > SESSION_MAX_AGE) {
    sessions.delete(token);
    return null;
  }
  const user = getUser(session.userId);
  return user ? sanitizeUser(user) : null;
}

export function validateSession(token) {
  return !!getSessionUser(token);
}

export function destroySession(token) {
  sessions.delete(token);
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.created > SESSION_MAX_AGE) sessions.delete(token);
  }
}, 60 * 60 * 1000);

// ── Version History ──

const MAX_SNAPSHOTS = 50;

function snapshotDir(type, slug) {
  return join(PATHS.historyDir, type, slug);
}

export function saveSnapshot(type, slug, content) {
  const dir = snapshotDir(type, slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const id = `${ts}_${randomBytes(4).toString('hex')}`;
  writeFileAtomic(join(dir, `${id}.html`), content);

  const files = readdirSync(dir).filter(f => f.endsWith('.html')).sort();
  if (files.length > MAX_SNAPSHOTS) {
    for (const old of files.slice(0, files.length - MAX_SNAPSHOTS)) {
      unlinkSync(join(dir, old));
    }
  }
  return id;
}

export function listSnapshots(type, slug) {
  const dir = snapshotDir(type, slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.html'))
    .sort()
    .reverse()
    .map(f => {
      const name = f.replace('.html', '');
      const tsPart = name.split('_').slice(0, -1).join('_');
      const ts = tsPart.replace(/-/g, (m, i) => {
        if (i === 4 || i === 7) return '-';
        if (i === 13) return ':';
        if (i === 16) return ':';
        if (i === 19) return '.';
        return m;
      });
      return { id: name, filename: f, timestamp: ts };
    });
}

export function getSnapshot(type, slug, snapshotId) {
  const file = join(snapshotDir(type, slug), `${snapshotId}.html`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function restoreSnapshot(type, slug, snapshotId) {
  const content = getSnapshot(type, slug, snapshotId);
  if (!content) return null;
  if (type === 'pages') {
    const current = getPageHTML(slug);
    if (current) saveSnapshot('pages', slug, current);
    writeFileAtomic(join(PATHS.pagesDir, `${slug}.html`), content);
  } else if (type === 'partials') {
    const current = getPartialHTMLByName(slug);
    if (current) saveSnapshot('partials', slug, current);
    writeFileAtomic(join(PATHS.partialsDir, `${slug}.html`), content);
  }
  return content;
}

// ── Decisions ──

export function listDecisions() {
  return readJSON(PATHS.decisions, []);
}

export function saveDecisions(decisions) {
  writeJSON(PATHS.decisions, decisions);
}

export function getDecision(targetId) {
  return listDecisions().find(d => d.id === targetId) || null;
}

export function createDecision({ name, kind, weight = 'rule', scope = 'global', content = '', variable }) {
  const decisions = listDecisions();
  const decision = {
    id: genId(), name, kind, weight, scope, content,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  if (kind === 'token') decision.variable = variable || slugify(name);
  decisions.push(decision);
  writeJSON(PATHS.decisions, decisions);
  return decision;
}

export function updateDecision(targetId, updates) {
  const decisions = listDecisions();
  const idx = decisions.findIndex(d => d.id === targetId);
  if (idx === -1) return null;
  Object.assign(decisions[idx], updates, { updated: new Date().toISOString() });
  if (decisions[idx].kind === 'token' && !decisions[idx].variable) {
    decisions[idx].variable = slugify(decisions[idx].name);
  }
  writeJSON(PATHS.decisions, decisions);
  return decisions[idx];
}

export function deleteDecision(targetId) {
  writeJSON(PATHS.decisions, listDecisions().filter(d => d.id !== targetId));
}

// ── Partials ──

function partialSlug(name) {
  return slugify(name);
}

export function listPartials() {
  return readJSON(PATHS.partials, []);
}

export function getPartial(targetId) {
  return listPartials().find(c => c.id === targetId) || null;
}

export function getPartialHTML(targetId) {
  const p = getPartial(targetId);
  if (!p) return '';
  const file = join(PATHS.partialsDir, `${partialSlug(p.name)}.html`);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

export function getPartialByName(name) {
  return listPartials().find(c => c.name === name) || null;
}

export function getPartialHTMLByName(name) {
  const file = join(PATHS.partialsDir, `${partialSlug(name)}.html`);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

export function savePartialHTMLByName(name, html) {
  const slug = partialSlug(name);
  const existing = getPartialHTMLByName(name);
  if (existing && existing !== html) saveSnapshot('partials', slug, existing);
  writeFileAtomic(join(PATHS.partialsDir, `${slug}.html`), html);
  const partials = listPartials();
  const idx = partials.findIndex(c => c.name === name);
  if (idx >= 0) {
    partials[idx].version = (partials[idx].version || 1) + 1;
    partials[idx].updated = new Date().toISOString();
    writeJSON(PATHS.partials, partials);
  }
}

export function createPartial({ name, html, mode = 'global', weight = 'rule', scope = 'global', isPattern = false, preview }) {
  const partials = listPartials();
  const p = {
    id: genId(), name, mode, weight, scope, isPattern: !!isPattern,
    version: 1,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  if (preview && typeof preview === 'object') p.preview = preview;
  partials.push(p);
  writeJSON(PATHS.partials, partials);
  writeFileAtomic(join(PATHS.partialsDir, `${partialSlug(name)}.html`), html || '');
  return p;
}

export function updatePartial(targetId, updates) {
  const partials = listPartials();
  const idx = partials.findIndex(c => c.id === targetId);
  if (idx === -1) return null;
  const oldName = partials[idx].name;
  if (updates.html !== undefined) {
    const fileName = partialSlug(updates.name || oldName);
    writeFileAtomic(join(PATHS.partialsDir, `${fileName}.html`), updates.html);
    delete updates.html;
    updates.version = (partials[idx].version || 1) + 1;
  }
  if (updates.name && updates.name !== oldName) {
    const oldFile = join(PATHS.partialsDir, `${partialSlug(oldName)}.html`);
    const newFile = join(PATHS.partialsDir, `${partialSlug(updates.name)}.html`);
    if (existsSync(oldFile) && oldFile !== newFile) {
      writeFileAtomic(newFile, readFileSync(oldFile, 'utf8'));
      unlinkSync(oldFile);
    }
  }
  Object.assign(partials[idx], updates, { updated: new Date().toISOString() });
  writeJSON(PATHS.partials, partials);
  return partials[idx];
}

export function findPartialUsage(name) {
  const pages = listPages();
  const directive = `<!-- @partial:${name}`;
  const using = [];
  for (const page of pages) {
    const html = getPageHTML(page.slug);
    if (html && html.includes(directive)) {
      using.push({ slug: page.slug, title: page.title });
    }
  }
  return using;
}

export function inlinePartialIntoPages(name, html) {
  const pages = listPages();
  const directiveRegex = new RegExp(`<!-- @partial:${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->`, 'g');
  const resolvedRegex = new RegExp(
    `<!-- @partial:${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:begin -->[\\s\\S]*?<!-- @partial:${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:end -->`,
    'g'
  );
  let count = 0;
  for (const page of pages) {
    let pageHTML = getPageHTML(page.slug);
    if (!pageHTML) continue;
    const before = pageHTML;
    pageHTML = pageHTML.replace(resolvedRegex, html);
    pageHTML = pageHTML.replace(directiveRegex, html);
    if (pageHTML !== before) {
      savePageHTML(page.slug, pageHTML);
      count++;
    }
  }
  return count;
}

export function deletePartial(targetId, { inlineBack = false } = {}) {
  const p = getPartial(targetId);
  if (p && inlineBack) {
    const html = getPartialHTML(targetId);
    if (html) inlinePartialIntoPages(p.name, html);
  }
  writeJSON(PATHS.partials, listPartials().filter(c => c.id !== targetId));
  if (p) {
    const file = join(PATHS.partialsDir, `${partialSlug(p.name)}.html`);
    if (existsSync(file)) unlinkSync(file);
  }
}

// ── Pages ──

export function listPages() {
  return readJSON(PATHS.pages, []);
}

export function getPage(targetId) {
  return listPages().find(p => p.id === targetId) || null;
}

export function getPageBySlug(slug) {
  return listPages().find(p => p.slug === slug) || null;
}

export function getPageHTML(slug) {
  const file = join(PATHS.pagesDir, `${slug}.html`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function createPage({ title, slug, intent = '', status = 'draft' }) {
  const pages = listPages();
  const page = {
    id: genId(), title, slug, intent, status,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  pages.push(page);
  writeJSON(PATHS.pages, pages);
  return page;
}

export function updatePage(targetId, updates) {
  const pages = listPages();
  const idx = pages.findIndex(p => p.id === targetId);
  if (idx === -1) return null;
  if (updates.html !== undefined) {
    writeFileAtomic(join(PATHS.pagesDir, `${pages[idx].slug}.html`), updates.html);
    delete updates.html;
  }
  Object.assign(pages[idx], updates, { updated: new Date().toISOString() });
  writeJSON(PATHS.pages, pages);
  return pages[idx];
}

export function savePageHTML(slug, html) {
  const existing = getPageHTML(slug);
  if (existing && existing !== html) saveSnapshot('pages', slug, existing);
  writeFileAtomic(join(PATHS.pagesDir, `${slug}.html`), html);
}

export function deletePage(targetId) {
  const pages = listPages();
  const page = pages.find(p => p.id === targetId);
  if (!page) return;
  writeJSON(PATHS.pages, pages.filter(p => p.id !== targetId));
  const file = join(PATHS.pagesDir, `${page.slug}.html`);
  if (existsSync(file)) unlinkSync(file);
  const chatFile = join(PATHS.chatsDir, `${page.slug}.json`);
  if (existsSync(chatFile)) unlinkSync(chatFile);
}

// ── Chats ──

export function getChat(slug) {
  return readJSON(join(PATHS.chatsDir, `${slug}.json`), []);
}

export function appendChat(slug, message) {
  const messages = getChat(slug);
  messages.push({ ...message, timestamp: new Date().toISOString() });
  writeJSON(join(PATHS.chatsDir, `${slug}.json`), messages);
  return messages;
}

export function clearChat(slug) {
  const file = join(PATHS.chatsDir, `${slug}.json`);
  if (existsSync(file)) unlinkSync(file);
}

// ── Collections ──
// Each collection: content/collections/{slug}/collection.json

function collectionDir(slug) {
  return join(PATHS.collectionsDir, slug);
}

export function listCollections() {
  if (!existsSync(PATHS.collectionsDir)) return [];
  return readdirSync(PATHS.collectionsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => readJSON(join(PATHS.collectionsDir, d.name, 'collection.json'), null))
    .filter(Boolean);
}

export function getCollection(targetId) {
  return listCollections().find(c => c.id === targetId) || null;
}

export function getCollectionBySlug(slug) {
  return readJSON(join(collectionDir(slug), 'collection.json'), null);
}

export function createCollection({ name, slug, schema = [] }) {
  const col = {
    id: genId(), name, slug, schema,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  const dir = collectionDir(slug);
  mkdirSync(dir, { recursive: true });
  writeJSON(join(dir, 'collection.json'), col);
  writeJSON(join(dir, 'entries.json'), []);
  return col;
}

export function updateCollection(targetId, updates) {
  const col = getCollection(targetId);
  if (!col) return null;
  Object.assign(col, updates, { updated: new Date().toISOString() });
  writeJSON(join(collectionDir(col.slug), 'collection.json'), col);
  return col;
}

export function deleteCollection(targetId) {
  const col = getCollection(targetId);
  if (!col) return;
  const dir = collectionDir(col.slug);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

export function getCollectionListingHTML(slug) {
  const file = join(collectionDir(slug), 'listing.html');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function saveCollectionListingHTML(slug, html) {
  const dir = collectionDir(slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'listing.html'), html, 'utf8');
}

export function getCollectionDetailHTML(slug) {
  const file = join(collectionDir(slug), 'detail.html');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function saveCollectionDetailHTML(slug, html) {
  const dir = collectionDir(slug);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'detail.html'), html, 'utf8');
}

// ── Entries ──

export function listEntries(colSlug) {
  return readJSON(join(collectionDir(colSlug), 'entries.json'), []);
}

export function getEntry(colSlug, entryId) {
  return listEntries(colSlug).find(e => e.id === entryId) || null;
}

export function getEntryBySlug(colSlug, entrySlug) {
  return listEntries(colSlug).find(e => e.slug === entrySlug) || null;
}

export function createEntry(colSlug, { data = {}, slug }) {
  const entries = listEntries(colSlug);
  if (!slug) slug = slugify(data.title || 'entry');
  const existingSlugs = entries.map(e => e.slug);
  if (existingSlugs.includes(slug)) {
    let n = 2;
    while (existingSlugs.includes(`${slug}-${n}`)) n++;
    slug = `${slug}-${n}`;
  }
  const entry = {
    id: genId(), slug, data,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  entries.push(entry);
  writeJSON(join(collectionDir(colSlug), 'entries.json'), entries);
  return entry;
}

export function updateEntry(colSlug, entryId, updates) {
  const entries = listEntries(colSlug);
  const idx = entries.findIndex(e => e.id === entryId);
  if (idx === -1) return null;
  if (updates.data) entries[idx].data = { ...entries[idx].data, ...updates.data };
  if (updates.slug) entries[idx].slug = updates.slug;
  entries[idx].updated = new Date().toISOString();
  writeJSON(join(collectionDir(colSlug), 'entries.json'), entries);
  return entries[idx];
}

export function deleteEntry(colSlug, entryId) {
  const entries = listEntries(colSlug).filter(e => e.id !== entryId);
  writeJSON(join(collectionDir(colSlug), 'entries.json'), entries);
}

// ── Media ──

const MEDIA_META = join(CONTENT, 'media', 'media.json');

export function listMedia() {
  return readJSON(MEDIA_META, []);
}

export function addMedia({ path: mediaPath, originalName, size = 0, mimeType = '' }) {
  const media = listMedia();
  const item = {
    id: genId(),
    path: mediaPath,
    originalName: originalName || mediaPath.split('/').pop(),
    size,
    mimeType,
    created: new Date().toISOString(),
  };
  media.push(item);
  writeJSON(MEDIA_META, media);
  return item;
}

export function getMediaItem(id) {
  return listMedia().find(m => m.id === id) || null;
}

export function deleteMedia(id) {
  const media = listMedia();
  const item = media.find(m => m.id === id);
  if (!item) return;
  const filePath = join(CONTENT, item.path.startsWith('/media/') ? item.path.slice(1) : item.path);
  if (existsSync(filePath)) unlinkSync(filePath);
  writeJSON(MEDIA_META, media.filter(m => m.id !== id));
}

// ── Functions ──

export function listFunctions() {
  if (!existsSync(PATHS.functionsDir)) return [];
  return readdirSync(PATHS.functionsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace('.js', ''));
}

export function getFunctionCode(name) {
  const file = join(PATHS.functionsDir, `${name}.js`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function saveFunctionCode(name, code) {
  writeFileAtomic(join(PATHS.functionsDir, `${name}.js`), code);
}

export function deleteFunction(name) {
  const file = join(PATHS.functionsDir, `${name}.js`);
  if (existsSync(file)) unlinkSync(file);
}
