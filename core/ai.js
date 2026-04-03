import Anthropic from '@anthropic-ai/sdk';
import { listDecisions, listPartials, getPartialHTML, listPages, getPageHTML, getSite, listCollections, listEntries, listFunctions, getFunctionCode } from './store.js';

let client = null;

const MODELS = {
  generate: 'claude-sonnet-4-6',
  chat: 'claude-sonnet-4-6',
};

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set. Add it to .env');
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

let chatModelOverride = null;

function getModel(task) {
  if (task === 'chat' && chatModelOverride) return chatModelOverride;
  const envKey = `AI_MODEL_${task.toUpperCase()}`;
  return process.env[envKey] || MODELS[task] || MODELS.generate;
}

export function setChatModel(model) { chatModelOverride = model || null; }
export function getChatModel() { return getModel('chat'); }
export { MODELS };

function scopeApplies(decision, pageSlug, collectionSlug) {
  const s = decision.scope || 'global';
  if (s === 'global') return true;
  if (s.startsWith('page:')) return s === `page:${pageSlug}`;
  if (s.startsWith('collection:')) return s === `collection:${collectionSlug}`;
  if (s === 'page') return !!pageSlug;
  if (s === 'collection') return !!collectionSlug;
  return true;
}

function buildConstraints(pageSlug = null, collectionSlug = null) {
  const allDecisions = listDecisions();
  const decisions = allDecisions.filter(d => scopeApplies(d, pageSlug, collectionSlug));
  const partials = listPartials();
  let hasTokens = false;
  let hasPartials = false;

  const rules = [];
  const guides = [];

  const tokens = decisions.filter(d => d.kind === 'token');
  if (tokens.length) hasTokens = true;

  for (const d of decisions) {
    const prefix = d.kind === 'token' ? `[token] ${d.name}: ${d.content}`
      : d.kind === 'instruction' ? `[instruction] ${d.name}: ${d.content}`
      : d.kind === 'asset' ? `[asset] ${d.name}: reference ${d.content}`
      : `${d.name}: ${d.content}`;
    if (d.weight === 'guide') guides.push(prefix);
    else rules.push(prefix);
  }

  let out = '';
  if (rules.length) {
    out += 'SITE RULES (must follow exactly — do NOT re-propose these):\n';
    for (const r of rules) out += `- ${r}\n`;
    out += '\n';
  }
  if (guides.length) {
    out += 'SITE GUIDELINES (follow unless you have good reason not to — do NOT re-propose these):\n';
    for (const g of guides) out += `- ${g}\n`;
    out += '\n';
  }

  const actualPartials = partials.filter(p => !p.isPattern);
  const patterns = partials.filter(p => p.isPattern);

  if (actualPartials.length) {
    hasPartials = true;
    out += 'EXISTING PARTIALS (use <!-- @partial:name --> directives for these — do NOT re-create them):\n';
    for (const p of actualPartials) {
      const html = getPartialHTML(p.id);
      if (html) out += `--- ${p.name} ---\n${html}\n\n`;
      else out += `- ${p.name}\n`;
    }
    out += '\n';
  }

  if (patterns.length) {
    out += 'PATTERN COMPONENTS (reference patterns — use these as templates when generating similar elements):\n';
    for (const p of patterns) {
      const html = getPartialHTML(p.id);
      const weightLabel = p.weight === 'rule' ? 'use exactly' : 'preferred, can deviate';
      if (html) out += `--- ${p.name} (${weightLabel}) ---\n${html}\n\n`;
      else out += `- ${p.name} (${weightLabel})\n`;
    }
    out += '\n';
  }

  return { text: out, hasTokens, hasPartials: hasPartials || patterns.length > 0 };
}

function buildSiteContext() {
  const site = getSite();
  const pages = listPages();
  if (!pages.length) return '';

  let out = `SITE: "${site.name || 'My Website'}"\n\n`;
  out += `EXISTING PAGES (${pages.length}):\n`;
  for (const p of pages) {
    out += `- /${p.slug} — "${p.title}"`;
    if (p.intent) out += ` (${p.intent.slice(0, 80)}${p.intent.length > 80 ? '…' : ''})`;
    out += '\n';
  }
  out += '\n';

  // Extract CSS from the most recent page as a style reference for consistency
  const recentPage = pages[pages.length - 1];
  const html = getPageHTML(recentPage.slug);
  if (html) {
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    if (styleMatch) {
      out += `EXISTING SITE CSS (from /${recentPage.slug} — use this as a style reference for visual consistency):\n`;
      out += styleMatch[1].trim() + '\n\n';
    }

    // Extract section structure so AI understands the site's patterns
    const sections = [];
    const sectionRegex = /data-section="([^"]+)"/g;
    let m;
    while ((m = sectionRegex.exec(html)) !== null) sections.push(m[1]);
    if (sections.length) {
      out += `SECTION STRUCTURE of /${recentPage.slug}: ${sections.join(', ')}\n\n`;
    }
  }

  return out;
}

function parseGenerationJSON(raw) {
  // Try clean parse first
  try { return JSON.parse(raw); } catch {}

  // Try extracting JSON object
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }

  // Truncation recovery: extract HTML even from broken JSON
  const htmlMatch = raw.match(/"html"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"decisions"|$)/);
  if (htmlMatch) {
    let html = htmlMatch[1];
    // Unescape JSON string escapes
    try { html = JSON.parse(`"${html}"`); } catch {
      html = html.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    // Close any unclosed HTML tags
    if (!html.includes('</html>')) html += '</html>';
    if (!html.includes('</body>')) html = html.replace('</html>', '</body></html>');
    console.warn('Recovered HTML from truncated JSON. Decisions/components may be lost.');
    return { html, decisions: [], components: [] };
  }

  // If it looks like HTML, use it directly
  if (raw.includes('<!DOCTYPE') || raw.includes('<html')) {
    return { html: raw, decisions: [], components: [] };
  }

  throw new Error('AI response could not be parsed. Try generating again.');
}

function buildTokenCSS(pageSlug = null, collectionSlug = null) {
  const tokens = listDecisions().filter(d => d.kind === 'token' && scopeApplies(d, pageSlug, collectionSlug));
  if (!tokens.length) return '';
  let css = ':root {\n';
  for (const t of tokens) {
    const varName = '--' + t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    css += `  ${varName}: ${t.content};\n`;
  }
  css += '}\n';
  return css;
}

export async function generatePage(intent, pageSlug = null) {
  const constraints = buildConstraints(pageSlug, null);
  const tokenCSS = buildTokenCSS(pageSlug, null);

  const systemPrompt = `You are a web designer building pages for Stablemount.

ARCHITECTURE:
- Flat-file storage: no database. Content lives in content/ (pages, partials, collections, decisions, site.json).
- Pages are .html files on disk. Partials live in content/partials/.
- The server resolves <!-- @partial:name --> and <!-- @collection:slug --> at browse time. Pages store directives only — never inline partial markup.

You MUST return a JSON object with this exact structure:
{
  "html": "<!DOCTYPE html>...complete page HTML...</html>",
  "decisions": [...array of proposed design decisions...],
  "components": [...array of proposed partials (header, footer, accordion, etc.)...]
}

DESIGN:
${constraints.hasTokens
  ? '- An existing design direction is established. Follow it. Strengthen it where you can, but stay consistent.'
  : '- This is an early page — you are setting the design direction for the entire site. Choose a strong, distinctive style that is effective for this type of site. Own it. This becomes the foundation everything else builds on.'}
- Use IMAGES. Use https://loremflickr.com/{width}/{height}/{keyword},{keyword} for contextual stock photos. Comma-separate 2-3 specific keywords that match the page topic. Examples:
  For a bakery: https://loremflickr.com/1200/600/bakery,bread
  For a tech company: https://loremflickr.com/1200/600/software,office
  For <img>: <img src="https://loremflickr.com/600/450/sourdough,bread" alt="descriptive alt text">
  For backgrounds: background-image: url('https://loremflickr.com/1400/800/bakery,artisan');
  IMPORTANT: Each image URL with the same keywords returns a DIFFERENT random photo, so you naturally get variety without changing keywords.
- Pages without images look unfinished. Use them for heroes, sections, features, wherever they serve the content.
- Write real, plausible content — never lorem ipsum. Copy should sound like a real business.
- Responsive design with mobile-first media queries.
- Interactive states on links and buttons (CSS :hover).
- No JavaScript.

PAGE HTML RULES:
1. Complete HTML document (<!DOCTYPE html> through </html>).
2. Add data-content="unique-id" to every editable text element. IDs should be descriptive: "hero-heading", "feature-1-title", etc.
3. Add data-section="section-name" to logical page sections.
4. Use <!-- @partial:name --> for partial components (existing or proposed).
5. Use <!-- @collection:slug limit=3 sort=created order=desc --> ... <!-- @/collection:slug --> to embed collection items. Template inside uses data-each-entry and {{field}} placeholders.
6. All CSS in a <style> tag in <head>. You may link ONE Google Fonts pairing.
7. Use CSS custom properties for design tokens.
${tokenCSS ? `\nEXISTING TOKEN CSS (include in your <style>):\n${tokenCSS}` : ''}

RULES FOR DECISIONS:
${constraints.hasTokens
  ? '- Design tokens already exist. Do NOT propose tokens that duplicate existing ones. Only propose NEW tokens if you used values not already covered.'
  : '- No design tokens exist yet. You MUST propose the core tokens you used: primary color, secondary color, accent color, text color, background color, font family, heading font (if different), border radius, and any other values you chose. These become the site\'s design system.'}
- Each decision: { "name": "Human Label", "kind": "token|instruction", "weight": "rule|guide", "scope": "global", "content": "the value" }
- For tokens: content is the CSS value (#hex, font name, px/rem value, etc.)
- For instructions: content is prose guidance the AI should follow on future pages
- Only propose decisions that genuinely constrain future generation. Don't propose trivial or obvious things.

RULES FOR PARTIALS:
${constraints.hasPartials
  ? '- Partials already exist. Use <!-- @partial:name --> directives for them. Only propose NEW partials if you created a distinct reusable pattern.'
  : '- No partials exist yet. You MUST create a header and footer as partials. The page HTML should use <!-- @partial:header --> and <!-- @partial:footer --> directives for them.'}
- Each partial: { "name": "lowercase-kebab", "html": "<bundled partial>", "mode": "global|injectable" }
- Partials are reusable HTML/CSS/JS bundles injected server-side via <!-- @partial:name --> directives.
- Global partials: same content everywhere (header, footer). Injectable partials: accept slot data per page (e.g. accordion with page-specific FAQ).
- The page HTML must NEVER contain partial markup inline — only the directive comment. The server injects the partial content at browse time.
- BUNDLED FORMAT: Each partial's "html" field must be a self-contained bundle in this exact order:
  1. The HTML markup FIRST
  2. A <style> block with ALL CSS rules the partial needs (scoped by class names)
  3. A <script> block ONLY if the partial requires interactivity. If no script is needed, omit it entirely.
- Partial CSS should use the same CSS custom properties (var(--token)) as the page — do NOT redefine :root tokens inside partials.
- Do NOT duplicate partial CSS in the page <style> — the partial carries its own styles.
- The page <style> should only contain page-level layout and section styles. Grid containers that arrange partials (e.g. .menu-grid) belong in the page. The partial's own appearance rules belong in the partial bundle.
- Only propose partials that are genuinely reusable. A one-off hero section is not a partial.

OUTPUT FORMAT:
Return ONLY valid JSON. No markdown, no code fences, no explanation outside the JSON.
EFFICIENCY: Be direct. Do not overthink. Generate confidently and move fast.
- Keep CSS concise — shorthand properties, no redundant rules, minimal comments.
- Propose 5-8 decisions max (only the essential tokens). Don't over-document.
- Propose 2-4 partials max (header, footer, maybe one pattern). Keep partial HTML tight.
- Page HTML should be complete but lean — don't pad with excessive sections. 3-5 sections is plenty for most pages.
- The response MUST complete within token limits. Prioritize finishing the HTML.`;

  const siteContext = buildSiteContext();
  const userPrompt = `${siteContext}${constraints.text ? `EXISTING SITE CONSTRAINTS:\n${constraints.text}\n` : 'This is the FIRST page for a brand new site. No decisions or components exist yet. Bootstrap the design system.\n\n'}Generate a complete page for this intent:\n\n${intent}`;

  const model = getModel('generate');
  const response = await getClient().messages.create({
    model,
    max_tokens: 16000,
    temperature: 0.7,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
  });

  if (response.stop_reason === 'max_tokens') {
    console.warn('Warning: AI response was truncated (hit max_tokens). Attempting recovery.');
  }

  let raw = response.content[0].text.trim();

  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) raw = fenceMatch[1].trim();

  const result = parseGenerationJSON(raw);

  return {
    html: result.html || '',
    decisions: Array.isArray(result.decisions) ? result.decisions : [],
    components: Array.isArray(result.components) ? result.components : [],
  };
}

const MAX_CONTEXT_CHARS = 80000;

function truncateHTML(html, max = 2000) {
  if (html.length <= max) return html;
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const css = styleMatch ? styleMatch[0] : '';
  const body = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').slice(0, max - css.length);
  return css + '\n' + body + '\n<!-- truncated -->';
}

function buildContentContext(pageHTML, pageSlug) {
  const partials = listPartials();
  const decisions = listDecisions();
  const collections = listCollections();
  let ctx = '';
  let budget = MAX_CONTEXT_CHARS;

  const site = getSite();
  if (site) {
    const siteJSON = `=== FILE: site.json ===\n${JSON.stringify(site, null, 2)}\n\n`;
    ctx += siteJSON;
    budget -= siteJSON.length;
  }

  if (decisions.length) {
    const decJSON = `=== FILE: decisions.json ===\n${JSON.stringify(decisions, null, 2)}\n\n`;
    ctx += decJSON;
    budget -= decJSON.length;
  }

  if (pageHTML && pageSlug) {
    const section = `=== FILE: pages/${pageSlug}.html ===\n${pageHTML}\n\n`;
    ctx += section;
    budget -= section.length;
  }

  for (const partial of partials) {
    if (budget <= 0) break;
    const html = getPartialHTML(partial.id);
    if (html) {
      const section = `=== FILE: partials/${partial.name}.html ===\n${truncateHTML(html, 3000)}\n\n`;
      ctx += section;
      budget -= section.length;
    }
  }

  const pages = listPages();
  for (const p of pages) {
    if (p.slug === pageSlug) continue;
    if (budget <= 0) break;
    const html = getPageHTML(p.slug);
    if (html) {
      const section = `=== FILE: pages/${p.slug}.html ===\n${truncateHTML(html)}\n\n`;
      ctx += section;
      budget -= section.length;
    }
  }

  if (collections.length) {
    let colCtx = `=== COLLECTIONS ===\n`;
    for (const col of collections) {
      const entries = listEntries(col.slug);
      colCtx += `- ${col.name} (slug: ${col.slug}, fields: ${col.schema.map(f => f.name).join(', ')}, ${entries.length} entries)\n`;
      for (const e of entries.slice(0, 10)) {
        const title = e.data.title || e.data[col.schema[0]?.name] || e.slug;
        colCtx += `  - ${e.slug}: "${title}"\n`;
      }
      if (entries.length > 10) colCtx += `  - ... and ${entries.length - 10} more\n`;
    }
    colCtx += '\n';
    if (budget > 0) { ctx += colCtx; budget -= colCtx.length; }
  }

  const fns = listFunctions();
  if (fns.length && budget > 0) {
    for (const name of fns) {
      if (budget <= 0) break;
      const code = getFunctionCode(name);
      if (code) {
        const section = `=== FILE: functions/${name}.js ===\n${code.slice(0, 2000)}\n\n`;
        ctx += section;
        budget -= section.length;
      }
    }
  }

  return ctx;
}

const MAX_HISTORY_MESSAGES = 20;

function trimHistory(history) {
  if (history.length <= MAX_HISTORY_MESSAGES) return history;
  return history.slice(-MAX_HISTORY_MESSAGES);
}

export async function chatSite(message, history = [], pageHTML = null, pageSlug = null) {
  const pageRef = pageSlug ? `pages/${pageSlug}.html` : 'any page';
  const rules = `You are Stablemount's AI assistant. You can modify files and create/delete content.

RESPONSE FORMAT (JSON only, no markdown fences):
{
  "reply": "brief explanation of what you did",
  "changes": [
    { "file": "pages/home.html", "old": "exact string to find", "new": "replacement string" }
  ],
  "actions": [
    { "action": "createCollection", "name": "Blog Posts", "slug": "blog", "schema": [{"name":"title","type":"text","required":true}] },
    { "action": "createEntry", "collection": "blog", "slug": "hello-world", "data": {"title":"Hello World"} },
    { "action": "createPage", "title": "About", "slug": "about", "intent": "An about page for the company" },
    { "action": "createPartial", "name": "hero-card", "html": "<div class='hero-card'>...</div><style>.hero-card{...}</style>", "mode": "global", "isPattern": false },
    { "action": "deletePartial", "name": "old-partial" },
    { "action": "deletePage", "slug": "old-page" },
    { "action": "deleteCollection", "slug": "old-collection" },
    { "action": "deleteEntry", "collection": "blog", "slug": "old-post" }
  ]
}

If no changes: { "reply": "your response", "changes": [], "actions": [] }

EDITABLE FILES (via "changes"):
${pageSlug ? `- pages/${pageSlug}.html — the current page being edited\n` : ''}- pages/*.html — site pages (HTML with inline <style>)
- partials/*.html — bundled partials (HTML, then <style>, then optional <script>)
- functions/*.js — sandboxed server functions (see FUNCTIONS below)
- decisions.json — design tokens and instructions
- site.json — site name and settings

PARTIAL PARADIGM:
- Pages use <!-- @partial:name --> directives. The server injects partial content at browse time. Never put partial markup inline in pages.
- Global partials: same content everywhere (header, footer). Injectable partials: accept slot data per page (e.g. accordion with page-specific FAQs).

AVAILABLE ACTIONS:
- createCollection: { name, slug, schema: [{name, type, required}] } — types: text, richtext, number, date, image, url, boolean
- createEntry: { collection (slug), slug, data: {field: value} }
- createPage: { title, slug, intent } — AI generates the page HTML from the intent
- createPartial: { name, html, mode, isPattern } — creates a reusable component (partial or pattern)
- deletePage: { slug }
- deletePartial: { name }
- deleteCollection: { slug }
- deleteEntry: { collection (slug), slug }
- createFunction: { name, code } — creates a sandboxed server function at /api/fn/{name}
- deleteFunction: { name }

CRITICAL — PAGES vs PARTIALS:
- A PAGE is a standalone URL route (/, /about, /contact). Use createPage for full navigable pages.
- A PARTIAL is a reusable HTML component (header, footer, card, hero-section). Use createPartial for components.
- NEVER create a page when the user asks for a "component", "partial", "pattern", "card", "section template", or reusable element.
- If the user asks you to "create a component" or "make a partial", use createPartial — NOT createPage.
- Partials are injected into pages via <!-- @partial:name --> directives. They are not pages.

Actions run BEFORE changes, so you can create a collection and then patch a page to reference it.

COLLECTION DIRECTIVES (for embedding collection items on pages):
Dynamic: <!-- @collection:slug limit=3 sort=created order=desc -->
Curated: <!-- @collection:slug entries=slug1,slug2,slug3 -->
Template inside: <div data-each-entry>{{title}} {{price}}</div>
Close with: <!-- @/collection:slug -->

FUNCTIONS (server-side logic):
- Functions live in content/functions/ and are served at /api/fn/{name}.
- They run in a sandbox with three APIs: store (read/write collections/entries), http (outbound GET/POST/PUT/DELETE), env (read environment variables).
- Define named handler functions for HTTP methods (GET, POST, PUT, DELETE). No export/import syntax.
- Example function file:
  async function POST({ body, query }) {
    await store.create('submissions', { slug: body.email, data: body });
    return { success: true };
  }
- To wire a form: <form method="POST" action="/api/fn/contact"> or use fetch('/api/fn/contact', ...) in a script.
- store API: store.list(collection), store.get(collection, slug), store.create(collection, {slug, data}), store.collections(), store.site()
- http API: http.get(url), http.post(url, body), http.put(url, body), http.delete(url)
- env API: env.get('KEY_NAME')
- Functions cannot access the filesystem, spawn processes, or import modules. They are safe by design.

CONTEXTUAL SELECTION:
- The user may select a specific section or element on the page. When the message starts with [SELECTED AREA: ...], focus your changes on that area.
- The HTML between [SELECTED AREA] and [/SELECTED] is the exact current markup of the selected region. Use it as the "old" value for your changes.
- Keep changes scoped to the selected area unless the instruction requires broader edits (e.g. adding CSS rules).

RULES:
- "old" must be an EXACT substring within the file. Include enough context for uniqueness.
- Multiple changes to multiple files allowed.
- Preserve data-content, data-section, <!-- @partial --> directives, CSS custom properties.
- Partial format: HTML, then <style>, then <script> (only if interactive).
- Do NOT include <style data-partials> / <script data-partials> (auto-injected).
- For images: https://loremflickr.com/{width}/{height}/{keyword},{keyword}
- Be concise. Respond with JSON only.`;

  const contentCtx = buildContentContext(pageHTML, pageSlug);

  const system = [
    { type: 'text', text: rules, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: contentCtx, cache_control: { type: 'ephemeral' } },
  ];

  const trimmed = trimHistory(history);
  const messages = [];
  for (const h of trimmed) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: 'user', content: message });

  const model = getModel('chat');
  const response = await getClient().messages.create({
    model,
    max_tokens: 16000,
    temperature: 0.5,
    system,
    messages,
  });

  let raw = response.content[0].text.trim();
  console.log('[ai:chatSite] raw response length:', raw.length);
  console.log('[ai:chatSite] raw first 500 chars:', raw.slice(0, 500));

  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) raw = fenceMatch[1].trim();

  let result;
  try {
    result = JSON.parse(raw);
  } catch (_) {
    console.log('[ai:chatSite] JSON parse failed, trying regex extraction');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { result = JSON.parse(jsonMatch[0]); }
      catch (_2) { result = { reply: 'Could not parse AI response.', changes: [], actions: [] }; }
    } else {
      result = { reply: raw, changes: [], actions: [] };
    }
  }

  console.log('[ai:chatSite] parsed actions:', (result.actions || []).length);
  console.log('[ai:chatSite] parsed changes:', (result.changes || []).length);

  return {
    reply: result.reply || '',
    changes: result.changes || [],
    actions: result.actions || [],
  };
}

// Keep backward-compatible alias
export async function chatModifyPage(pageHTML, message, history = [], pageSlug = 'home') {
  return chatSite(message, history, pageHTML, pageSlug);
}

export async function generateCollectionTemplates(collection) {
  const constraints = buildConstraints();
  const tokenCSS = buildTokenCSS();

  const schemaDesc = collection.schema.map(f =>
    `- ${f.name} (${f.type}${f.required ? ', required' : ''})`
  ).join('\n');

  const systemPrompt = `You are a web designer building collection templates for Stablemount.

You MUST return a JSON object with this exact structure:
{
  "listing": "<!DOCTYPE html>...complete listing page HTML...",
  "detail": "<!DOCTYPE html>...complete detail page HTML..."
}

COLLECTION: "${collection.name}" (slug: ${collection.slug})
SCHEMA:
${schemaDesc}

TEMPLATE SYNTAX:
- Use {{fieldName}} placeholders for entry data (e.g., {{title}}, {{body}}, {{author}}).
- Available variables: ${collection.schema.map(f => '{{' + f.name + '}}').join(', ')}, {{entry.slug}}, {{entry.created}}, {{entry.updated}}, {{collection.name}}, {{collection.slug}}, {{collection.count}}.
- For images: use <img src="https://loremflickr.com/{width}/{height}/{keyword},{keyword}"> as a FALLBACK. If the schema has an image field, use {{fieldName}} as the src.

LISTING PAGE:
- A full HTML page that displays all entries in the collection.
- Include ONE element with the attribute data-each-entry — this is the repeater template. The server clones it for each entry and fills in {{field}} placeholders.
- The data-each-entry element should link to {{entry.slug}} for the detail page.
- Use <!-- @partial:header --> and <!-- @partial:footer --> if partials exist.

DETAIL PAGE:
- A full HTML page that displays a single entry.
- Use {{field}} placeholders for all entry data.
- For richtext/body fields, output raw HTML: use {{{body}}} is NOT supported — just use {{body}} and the server will inject it.
- Use <!-- @partial:header --> and <!-- @partial:footer --> if partials exist.

BOTH PAGES:
- Add data-content attributes to editable text elements.
- Add data-section attributes to logical sections.
- All CSS in a <style> tag. Use CSS custom properties.
- Responsive design.
- Match the site's existing design direction.
${tokenCSS ? `\nEXISTING TOKEN CSS:\n${tokenCSS}` : ''}
${constraints.text ? `\nSITE CONSTRAINTS:\n${constraints.text}` : ''}
${buildSiteContext()}
EFFICIENCY: Be concise. Both templates together must fit within token limits. Keep CSS lean.
Return ONLY valid JSON. No markdown, no code fences.`;

  const model = getModel('generate');
  const response = await getClient().messages.create({
    model,
    max_tokens: 16000,
    temperature: 0.7,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Generate listing and detail templates for the "${collection.name}" collection.` }],
  });

  let raw = response.content[0].text.trim();
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) raw = fenceMatch[1].trim();

  let result;
  try {
    result = JSON.parse(raw);
  } catch (_) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { result = JSON.parse(jsonMatch[0]); }
      catch (_2) { result = {}; }
    } else {
      result = {};
    }
  }

  return {
    listing: result.listing || '',
    detail: result.detail || '',
  };
}
