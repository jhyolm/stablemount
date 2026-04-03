import { listPartials, getPartialHTML, listPages } from './store.js';

export function parsePartial(raw) {
  let html = raw;
  let css = '';
  let js = '';

  const styleMatches = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)];
  for (const m of styleMatches) {
    css += m[1].trim() + '\n';
    html = html.replace(m[0], '');
  }

  const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  for (const m of scriptMatches) {
    js += m[1].trim() + '\n';
    html = html.replace(m[0], '');
  }

  return { html: html.trim(), css: css.trim(), js: js.trim() };
}

export function resolvePartials(html, currentSlug = '') {
  const pages = listPages();
  const partials = listPartials();
  const collectedCSS = [];
  const collectedJS = [];

  function resolveOne(name, slotJSON) {
    const partial = partials.find(c => c.name === name);
    if (!partial) return `<!-- partial "${name}" not found -->`;

    let raw = getPartialHTML(partial.id);
    if (!raw) return `<!-- partial "${name}" empty -->`;

    const parsed = parsePartial(raw);
    let markup = parsed.html;

    if (parsed.css) collectedCSS.push(`/* partial: ${name} */\n${parsed.css}`);
    if (parsed.js) collectedJS.push(`/* partial: ${name} */\n${parsed.js}`);

    const currentPage = pages.find(p => p.slug === currentSlug);
    markup = markup.replace(/\{\{year\}\}/g, String(new Date().getFullYear()));
    markup = markup.replace(/\{\{page\.title\}\}/g, currentPage?.title || '');
    markup = markup.replace(/\{\{page\.slug\}\}/g, currentSlug);

    markup = markup.replace(/data-nav-page="([^"]+)"/g, (m, pageSlug) => {
      return pageSlug === currentSlug
        ? `data-nav-page="${pageSlug}" class="active"`
        : m;
    });

    if (slotJSON) {
      try {
        const slots = JSON.parse(slotJSON);
        for (const [slotName, value] of Object.entries(slots)) {
          markup = markup.replace(
            new RegExp(`(<[^>]*data-slot="${slotName}"[^>]*>)[\\s\\S]*?(<\\/[^>]+>)`, 'g'),
            `$1${value}$2`
          );
        }
      } catch (_) { /* invalid slot JSON */ }
    }

    return `<!-- @partial:${name}:begin -->\n${markup}\n<!-- @partial:${name}:end -->`;
  }

  // Block directives first: <!-- @partial:name -->...<!-- @/partial:name -->
  html = html.replace(
    /<!--\s*@partial:([\w][\w-]*)\s*(\{[\s\S]*?\})?\s*-->[\s\S]*?<!--\s*@\/partial:\1\s*-->/g,
    (match, name, slotJSON) => resolveOne(name, slotJSON)
  );

  // Self-closing directives: <!-- @partial:name --> with no closing tag
  html = html.replace(
    /<!--\s*@partial:([\w][\w-]*)\s*(\{[\s\S]*?\})?\s*-->/g,
    (match, name, slotJSON) => resolveOne(name, slotJSON)
  );

  if (collectedCSS.length) {
    const styleBlock = `<style data-partials>\n${collectedCSS.join('\n\n')}\n</style>`;
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${styleBlock}\n</head>`);
    } else {
      html = styleBlock + '\n' + html;
    }
  }

  if (collectedJS.length) {
    const scriptBlock = `<script data-partials>\n${collectedJS.join('\n\n')}\n</script>`;
    if (html.includes('</body>')) {
      html = html.replace('</body>', `${scriptBlock}\n</body>`);
    } else {
      html = html + '\n' + scriptBlock;
    }
  }

  return html;
}

export function restorePartialDirectives(html) {
  html = html.replace(
    /<!-- @partial:([\w][\w-]*):begin -->[\s\S]*?<!-- @partial:\1:end -->/g,
    '<!-- @partial:$1 -->'
  );
  html = html.replace(/<style data-partials>[\s\S]*?<\/style>\n?/g, '');
  html = html.replace(/<script data-partials>[\s\S]*?<\/script>\n?/g, '');
  return html;
}
