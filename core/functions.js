import vm from 'node:vm';
import { getFunctionCode } from './store.js';
import {
  listCollections, getCollectionBySlug, listEntries, getEntryBySlug,
  createEntry, updateEntry, deleteEntry, getSite,
} from './store.js';

const SYNC_TIMEOUT = 5000;
const ASYNC_TIMEOUT = 10000;

function createStoreAPI() {
  return {
    collections: () => listCollections().map(c => ({ name: c.name, slug: c.slug, schema: c.schema })),
    collection: (slug) => {
      const c = getCollectionBySlug(slug);
      return c ? { name: c.name, slug: c.slug, schema: c.schema } : null;
    },
    list: (colSlug) => listEntries(colSlug),
    get: (colSlug, entrySlug) => getEntryBySlug(colSlug, entrySlug),
    create: (colSlug, { slug, data }) => createEntry(colSlug, { slug, data }),
    update: (colSlug, entrySlug, updates) => {
      const entry = getEntryBySlug(colSlug, entrySlug);
      if (!entry) throw new Error(`Entry not found: ${colSlug}/${entrySlug}`);
      return updateEntry(colSlug, entry.id, updates);
    },
    delete: (colSlug, entrySlug) => {
      const entry = getEntryBySlug(colSlug, entrySlug);
      if (!entry) throw new Error(`Entry not found: ${colSlug}/${entrySlug}`);
      deleteEntry(colSlug, entry.id);
    },
    site: () => getSite(),
  };
}

const BLOCKED_URL = /^https?:\/\/(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i;

function createHttpAPI() {
  async function request(url, options = {}) {
    if (BLOCKED_URL.test(url)) throw new Error('Cannot access internal URLs');
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.includes('json') ? await res.json() : await res.text();
    return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), body };
  }

  return {
    get: (url, headers) => request(url, { method: 'GET', headers }),
    post: (url, body, headers) => request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    put: (url, body, headers) => request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    delete: (url, headers) => request(url, { method: 'DELETE', headers }),
  };
}

function createEnvAPI() {
  return { get: (key) => process.env[key] || null };
}

export async function executeFunction(name, method, { body, query, params }) {
  const code = getFunctionCode(name);
  if (!code) return { status: 404, body: { error: `Function not found: ${name}` } };

  // Run compilation + handler invocation in a single vm call.
  // This ensures the sync timeout catches infinite loops in handler bodies.
  const wrapped = `(function() {
    ${code}
    if (typeof ${method} === 'undefined') return { __noHandler: true };
    return ${method}(__reqData);
  })()`;

  const sandbox = vm.createContext({
    __reqData: { body, query, params },
    store: createStoreAPI(),
    http: createHttpAPI(),
    env: createEnvAPI(),
    console: { log: () => {}, warn: () => {}, error: () => {} },
  });

  let result;
  try {
    const script = new vm.Script(wrapped, { filename: `fn-${name}.js` });
    result = script.runInContext(sandbox, { timeout: SYNC_TIMEOUT });
  } catch (err) {
    console.error(`[fn:${name}] error:`, err.message);
    return { status: 500, body: { error: 'Function error', detail: err.message } };
  }

  if (result && result.__noHandler) {
    return { status: 405, body: { error: `Function "${name}" has no ${method} handler` } };
  }

  // result may be a Promise if the handler is async — await with timeout
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Function timed out')), ASYNC_TIMEOUT)
    );
    const resolved = await Promise.race([Promise.resolve(result), timeout]);

    if (resolved && typeof resolved === 'object' && resolved.status) {
      return { status: resolved.status, body: resolved.body || resolved };
    }
    return { status: 200, body: resolved ?? { ok: true } };
  } catch (err) {
    console.error(`[fn:${name}] runtime error:`, err.message);
    return { status: 500, body: { error: 'Function error', detail: err.message } };
  }
}
