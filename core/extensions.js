import { existsSync, readdirSync, statSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, '..', 'extensions');

let _loadCounter = 0;

const HOOK_NAMES = ['onRequest', 'onPageRender', 'onPageSave', 'onContentChange', 'onAIResponse'];

export async function loadExtensions() {
  const ext = {
    routes: new Map(),
    middleware: [],
    hooks: Object.fromEntries(HOOK_NAMES.map(n => [n, []])),
    manifests: [],
  };

  if (!existsSync(EXT_DIR)) return ext;

  const entries = readdirSync(EXT_DIR).filter(name => {
    const full = join(EXT_DIR, name);
    return statSync(full).isDirectory() && existsSync(join(full, 'extension.js'));
  });

  _loadCounter++;

  for (const folder of entries) {
    const entryFile = join(EXT_DIR, folder, 'extension.js');
    let mod;
    try {
      mod = await import(pathToFileURL(entryFile).href + '?v=' + _loadCounter);
    } catch (err) {
      console.error(`  Extension load error (${folder}):`, err.message);
      continue;
    }

    const id = mod.id || folder;
    console.log(`  Extension: ${id}`);

    // Routes
    const routes = Array.isArray(mod.routes) ? mod.routes : [];
    for (const route of routes) {
      const routePath = route.path || '/' + id;
      const handlers = {};
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
        if (typeof route[method] === 'function') handlers[method] = route[method];
      }
      if (Object.keys(handlers).length) {
        ext.routes.set(routePath, handlers);
        console.log(`    Route: /x${routePath} [${Object.keys(handlers).join(', ')}]`);
      }
    }

    // Middleware
    const middleware = Array.isArray(mod.middleware) ? mod.middleware : [];
    for (const mw of middleware) {
      if (typeof mw.before === 'function') {
        ext.middleware.push({ pages: mw.pages || '*', before: mw.before });
        console.log(`    Middleware: pages=${mw.pages || '*'}`);
      }
    }

    // Hooks
    const hooks = mod.hooks && typeof mod.hooks === 'object' ? mod.hooks : {};
    for (const name of HOOK_NAMES) {
      if (typeof hooks[name] === 'function') {
        ext.hooks[name].push(hooks[name]);
        console.log(`    Hook: ${name}`);
      }
    }

    // UI manifest
    if (mod.ui || mod.overlay) {
      ext.manifests.push({
        id,
        ui: mod.ui || null,
        overlay: mod.overlay || null,
      });
    }
  }

  return ext;
}

export async function runHook(hooks, name, ...args) {
  const fns = hooks[name];
  if (!fns || !fns.length) return undefined;
  let result;
  for (const fn of fns) {
    try {
      result = (await fn(...args)) ?? result;
    } catch (err) {
      console.error(`[hook:${name}] error:`, err.message);
    }
  }
  return result;
}

export async function runTransformHook(hooks, name, value, ...args) {
  const fns = hooks[name];
  if (!fns || !fns.length) return value;
  for (const fn of fns) {
    try {
      value = (await fn(value, ...args)) || value;
    } catch (err) {
      console.error(`[hook:${name}] error:`, err.message);
    }
  }
  return value;
}

export function matchRoute(routes, requestPath) {
  for (const [pattern, handlers] of routes) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (requestPath === prefix || requestPath.startsWith(prefix + '/')) {
        return { handlers, params: { path: requestPath.slice(prefix.length + 1) } };
      }
    } else if (requestPath === pattern) {
      return { handlers, params: {} };
    }
  }
  return null;
}

export function matchPage(pattern, slug) {
  if (pattern === '*') return true;
  const parts = pattern.split(',').map(p => p.trim());
  for (const p of parts) {
    if (p === slug) return true;
    if (p === '/' + slug) return true;
    if (p.endsWith('/*')) {
      const prefix = p.slice(0, -2).replace(/^\//, '');
      if (slug.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function watchExtensions(onReload) {
  if (!existsSync(EXT_DIR)) return;

  let debounce = null;

  function scheduleReload() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      debounce = null;
      console.log('  Extensions changed — reloading...');
      try {
        const ext = await loadExtensions();
        onReload(ext);
        console.log('  Extensions reloaded.');
      } catch (err) {
        console.error('  Extension reload failed:', err.message);
      }
    }, 500);
  }

  watch(EXT_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (filename.endsWith('.js')) scheduleReload();
  });
}
