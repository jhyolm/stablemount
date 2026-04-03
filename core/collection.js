import { listEntries, getEntryBySlug, getCollectionListingHTML, getCollectionDetailHTML, getCollectionBySlug } from './store.js';
import { resolvePartials } from './partial.js';

function resolveFields(html, data, extra = {}) {
  const vars = { ...data, ...extra };
  return html.replace(/\{\{(\w[\w.]*)\}\}/g, (match, key) => {
    if (key in vars) return vars[key] ?? '';
    return match;
  });
}

// ── Inline collection directives ──

function extractTemplateElement(html) {
  const openRx = /<([a-z][a-z0-9]*)\s[^>]*data-each-entry[^>]*>/i;
  const openMatch = openRx.exec(html);
  if (!openMatch) return null;

  const tag = openMatch[1];
  const startIdx = openMatch.index;
  let depth = 1;
  let cursor = startIdx + openMatch[0].length;

  const openTag = new RegExp(`<${tag}[\\s>/]`, 'gi');
  const closeTag = new RegExp(`</${tag}\\s*>`, 'gi');

  while (depth > 0 && cursor < html.length) {
    openTag.lastIndex = cursor;
    closeTag.lastIndex = cursor;
    const nextOpen = openTag.exec(html);
    const nextClose = closeTag.exec(html);
    if (!nextClose) break;

    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) {
        return html.slice(startIdx, nextClose.index + nextClose[0].length);
      }
      cursor = nextClose.index + nextClose[0].length;
    }
  }
  return null;
}

function parseDirectiveParams(paramStr) {
  const params = {};
  const rx = /(\w+)=([^\s]+)/g;
  let m;
  while ((m = rx.exec(paramStr)) !== null) {
    params[m[1]] = m[2];
  }
  return params;
}

function selectEntries(colSlug, params) {
  if (params.entries) {
    const slugs = params.entries.split(',').map(s => s.trim()).filter(Boolean);
    const results = [];
    for (const s of slugs) {
      const entry = getEntryBySlug(colSlug, s);
      if (entry) results.push(entry);
    }
    return results;
  }

  let entries = listEntries(colSlug);
  const sortField = params.sort || 'created';
  const order = params.order || 'desc';

  entries.sort((a, b) => {
    const av = a.data[sortField] ?? a[sortField] ?? '';
    const bv = b.data[sortField] ?? b[sortField] ?? '';
    if (av < bv) return order === 'asc' ? -1 : 1;
    if (av > bv) return order === 'asc' ? 1 : -1;
    return 0;
  });

  if (params.limit) {
    entries = entries.slice(0, parseInt(params.limit, 10) || entries.length);
  }

  return entries;
}

export function resolveCollectionDirectives(html) {
  const directiveRx = /<!-- @collection:([\w-]+)((?:\s+\w+=\S+)*)\s*-->([\s\S]*?)<!-- @\/collection:\1\s*-->/g;

  return html.replace(directiveRx, (fullMatch, colSlug, paramStr, templateBlock) => {
    const col = getCollectionBySlug(colSlug);
    if (!col) return `<!-- collection "${colSlug}" not found -->`;

    const params = parseDirectiveParams(paramStr.trim());

    const template = extractTemplateElement(templateBlock);
    if (!template) return fullMatch;

    const entries = selectEntries(colSlug, params);

    let rendered = '';
    for (const entry of entries) {
      let card = resolveFields(template, entry.data, {
        'entry.slug': `/${colSlug}/${entry.slug}`,
        'entry.id': entry.id,
        'entry.created': entry.created,
        'entry.updated': entry.updated,
        'collection.name': col.name || colSlug,
        'collection.slug': colSlug,
      });
      card = card.replace(/data-each-entry/g, 'data-entry');
      rendered += card + '\n';
    }

    const resolvedBlock = templateBlock.replace(template, rendered);

    const originalDirective = `<!-- @collection:${colSlug}${paramStr} -->`;
    const originalClose = `<!-- @/collection:${colSlug} -->`;
    const escaped = (originalDirective + templateBlock + originalClose)
      .replace(/<!--/g, '<!~~')
      .replace(/-->/g, '~~>');

    return `<!-- @collection:${colSlug}:begin ${paramStr.trim()} -->\n` +
      `<!-- @collection-template:${colSlug} ${escaped} -->\n` +
      resolvedBlock +
      `<!-- @collection:${colSlug}:end -->`;
  });
}

export function restoreCollectionDirectives(html) {
  const rx = /<!-- @collection:([\w-]+):begin[^>]*-->\s*<!-- @collection-template:\1\s([\s\S]*?)\s*-->\s*[\s\S]*?<!-- @collection:\1:end -->/g;
  return html.replace(rx, (_, colSlug, escaped) => {
    return escaped
      .replace(/<!~~/g, '<!--')
      .replace(/~~>/g, '-->');
  });
}

export function renderListing(colSlug, collectionName) {
  let html = getCollectionListingHTML(colSlug);
  if (!html) return null;

  const entries = listEntries(colSlug);

  html = resolveFields(html, {}, {
    'collection.name': collectionName || colSlug,
    'collection.slug': colSlug,
    'collection.count': String(entries.length),
  });

  const template = extractTemplateElement(html);
  if (template) {
    let rendered = '';
    for (const entry of entries) {
      let card = resolveFields(template, entry.data, {
        'entry.slug': `/${colSlug}/${entry.slug}`,
        'entry.id': entry.id,
        'entry.created': entry.created,
        'entry.updated': entry.updated,
      });
      card = card.replace(/data-each-entry/g, 'data-entry');
      rendered += card + '\n';
    }
    html = html.replace(template, rendered);
  }

  html = resolvePartials(html, colSlug);
  return html;
}

export function renderDetail(colSlug, entrySlug, collectionName) {
  let html = getCollectionDetailHTML(colSlug);
  if (!html) return null;

  const entry = getEntryBySlug(colSlug, entrySlug);
  if (!entry) return null;

  html = resolveFields(html, entry.data, {
    'entry.slug': `/${colSlug}/${entry.slug}`,
    'entry.id': entry.id,
    'entry.created': entry.created,
    'entry.updated': entry.updated,
    'collection.name': collectionName || colSlug,
    'collection.slug': colSlug,
  });

  html = resolvePartials(html, colSlug);
  return html;
}
