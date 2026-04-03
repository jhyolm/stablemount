import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTokens, extractStructure, tokensToDecisions, structureToDescription } from './extract.js';
import { renderPanel } from './panel.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = join(__dir, 'settings.json');

function readSettings() {
  if (!existsSync(SETTINGS_PATH)) return {};
  try { return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')); } catch { return {}; }
}

function saveSettings(data) {
  writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
  return data;
}

export const id = 'figma';

// ─── Routes ─────────────────────────────────────────────────

export const routes = [
  {
    path: '/figma/*',

    async GET({ params }) {
      if (params.path === 'panel') {
        return { status: 200, body: renderPanel() };
      }
      if (params.path === 'settings') {
        const s = readSettings();
        return { status: 200, body: { figmaToken: s.figmaToken ? '••••' + s.figmaToken.slice(-4) : '', hasToken: !!s.figmaToken, defaultUrl: s.defaultUrl || '' } };
      }
      if (params.path === 'generate-fields') {
        const s = readSettings();
        if (!s.figmaToken) {
          return { status: 200, body: '<p class="enhancer-help" style="color:#fca5a5">Figma token not configured. Set it up in the Figma extension settings first.</p>' };
        }
        return { status: 200, body: `<div class="enhancer-field">
          <label>Figma File or Frame URL</label>
          <input type="text" data-enhancer-field="figmaUrl" placeholder="https://www.figma.com/design/abc123/My-Design?node-id=1-2" value="${s.defaultUrl ? s.defaultUrl.replace(/"/g, '&quot;') : ''}">
          <p class="enhancer-help">The AI will extract tokens and layout from this Figma file and use them when generating the page.</p>
        </div>` };
      }
      return { status: 404, body: { error: 'Not found' } };
    },

    async POST({ params, body, req }) {
      if (params.path === 'settings') {
        const current = readSettings();
        const update = {};
        if (body.figmaToken !== undefined) update.figmaToken = body.figmaToken;
        if (body.defaultUrl !== undefined) update.defaultUrl = body.defaultUrl;
        const merged = saveSettings({ ...current, ...update });
        return { status: 200, body: { figmaToken: merged.figmaToken ? '••••' + merged.figmaToken.slice(-4) : '', hasToken: !!merged.figmaToken, defaultUrl: merged.defaultUrl || '' } };
      }

      if (params.path === 'generate-prepare') {
        return handleGeneratePrepare(body);
      }

      if (params.path === 'extract') {
        return handleExtract(body);
      }

      if (params.path === 'apply') {
        const cookie = req?.headers?.cookie || '';
        return handleApply(body, cookie);
      }

      return { status: 404, body: { error: 'Not found' } };
    },
  },
];

// ─── Dashboard UI ───────────────────────────────────────────

export const ui = {
  dashboard: {
    nav: { label: 'Figma' },
    panel: '/x/figma/panel',
    generateEnhancer: {
      label: 'Figma',
      icon: '◈',
      fields: '/x/figma/generate-fields',
      prepare: '/x/figma/generate-prepare',
    },
  },
};

// ─── Overlay UI ─────────────────────────────────────────────

export const overlay = {
  contextMenu: [
    { label: 'Import from Figma', action: '/x/figma/apply-section' },
  ],
};

// ─── Route Handlers ─────────────────────────────────────────

async function handleGeneratePrepare({ figmaUrl }) {
  if (!figmaUrl || !figmaUrl.trim()) {
    return { status: 200, body: { context: '' } };
  }

  const settings = readSettings();
  if (!settings.figmaToken) {
    return { status: 400, body: { error: 'Figma token not configured' } };
  }

  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  if (!fileKey) {
    return { status: 400, body: { error: 'Could not parse Figma URL' } };
  }

  let apiUrl = `https://api.figma.com/v1/files/${fileKey}`;
  if (nodeId) apiUrl += `?ids=${nodeId}`;

  try {
    const res = await fetch(apiUrl, { headers: { 'X-Figma-Token': settings.figmaToken } });
    if (!res.ok) return { status: 200, body: { context: '' } };
    const figmaData = await res.json();

    const tokens = extractTokens(figmaData);
    const structure = extractStructure(figmaData, nodeId);
    const decisions = tokensToDecisions(tokens);
    const structureDesc = structureToDescription(structure);
    const context = buildFigmaPrompt(tokens, structureDesc, decisions, 'create');

    return { status: 200, body: { context } };
  } catch {
    return { status: 200, body: { context: '' } };
  }
}

async function handleExtract({ figmaUrl }) {
  const settings = readSettings();
  const figmaToken = settings.figmaToken;
  if (!figmaToken) {
    return { status: 400, body: { error: 'Figma access token not configured. Go to Settings.' } };
  }
  if (!figmaUrl) {
    return { status: 400, body: { error: 'figmaUrl is required' } };
  }

  const { fileKey, nodeId } = parseFigmaUrl(figmaUrl);
  if (!fileKey) {
    return { status: 400, body: { error: 'Could not parse Figma file URL. Use a URL like https://www.figma.com/design/FILE_KEY/...' } };
  }

  let apiUrl = `https://api.figma.com/v1/files/${fileKey}`;
  if (nodeId) apiUrl += `?ids=${nodeId}`;

  let figmaData;
  try {
    const res = await fetch(apiUrl, {
      headers: { 'X-Figma-Token': figmaToken },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { status: res.status, body: { error: err.err || err.message || `Figma API returned ${res.status}` } };
    }
    figmaData = await res.json();
  } catch (err) {
    return { status: 502, body: { error: 'Failed to reach Figma API: ' + err.message } };
  }

  const tokens = extractTokens(figmaData);
  const structure = extractStructure(figmaData, nodeId);
  const decisions = tokensToDecisions(tokens);
  const structureDescription = structureToDescription(structure);

  return {
    status: 200,
    body: { tokens, structure, decisions, structureDescription },
  };
}

async function handleApply({ tokens, structure, decisions, page, mode, newPage }, cookie) {
  const base = `http://localhost:${process.env.PORT || 3000}`;
  const authHeaders = cookie ? { Cookie: cookie } : {};

  if (mode === 'create' && newPage) {
    const intent = buildFigmaPrompt(tokens, structure, decisions, mode, newPage.intent);

    try {
      const res = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          title: newPage.title,
          slug: newPage.slug,
          intent,
        }),
      });
      const data = await res.json();
      if (!res.ok) return { status: res.status, body: data };
      return { status: 200, body: { reply: `Created page "${newPage.title}" (/${newPage.slug}) from Figma design.`, page: data.page } };
    } catch (err) {
      return { status: 500, body: { error: 'Failed to generate page: ' + err.message } };
    }
  }

  const figmaContext = buildFigmaPrompt(tokens, structure, decisions, mode);

  const chatPayload = {
    message: figmaContext,
    slug: page || null,
    html: null,
  };

  if (page) {
    try {
      const pageRes = await fetch(`${base}/api/pages/${page}/html`, { headers: authHeaders });
      if (pageRes.ok) chatPayload.html = await pageRes.text();
    } catch {}
  }

  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(chatPayload),
    });
    const data = await res.json();
    return { status: 200, body: data };
  } catch (err) {
    return { status: 500, body: { error: 'Failed to send to AI: ' + err.message } };
  }
}

// ─── Figma URL Parsing ──────────────────────────────────────

function parseFigmaUrl(url) {
  // Handles: figma.com/design/KEY/..., figma.com/file/KEY/...
  const fileMatch = url.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
  const fileKey = fileMatch ? fileMatch[1] : null;

  // node-id can be in query param or URL path
  let nodeId = null;
  const nodeMatch = url.match(/node-id=([^&]+)/);
  if (nodeMatch) nodeId = decodeURIComponent(nodeMatch[1]);

  return { fileKey, nodeId };
}

// ─── AI Prompt Construction ─────────────────────────────────

function buildFigmaPrompt(tokens, structureDesc, decisions, mode, additionalIntent) {
  let prompt = `FIGMA DESIGN IMPORT\n\n`;

  prompt += `This content is being imported from a Figma design file. IMPORTANT INSTRUCTIONS:\n`;
  prompt += `1. Before creating ANY new elements, CHECK if partials already exist on this site that match or closely resemble the Figma content. REUSE existing partials first — adapt them if needed rather than duplicating.\n`;
  prompt += `2. If a Figma component has no existing partial match AND it looks reusable (headers, footers, cards, buttons, feature grids, testimonials, CTAs, etc.), CREATE it as a new partial so it can be shared across pages.\n`;
  prompt += `3. Apply the extracted design tokens as decisions (color tokens, font tokens) to establish or refine the site's design system. If tokens conflict with existing decisions, prefer the Figma values — the designer is updating the direction.\n`;
  prompt += `4. Interpret the structural layout from Figma into clean, semantic HTML with CSS. You are NOT doing pixel-perfect reproduction — you are interpreting the design intent and translating it into well-structured web content that matches the spirit of the design.\n`;
  prompt += `5. Use real CSS (flexbox, grid, custom properties) to achieve the layout. Do not over-engineer. Keep it simple and maintainable.\n\n`;

  if (decisions && decisions.length) {
    prompt += `EXTRACTED DESIGN TOKENS (apply as decisions):\n`;
    for (const d of decisions) {
      prompt += `  ${d.name}: ${d.content}\n`;
    }
    prompt += `\n`;
  }

  if (tokens) {
    if (tokens.colors && tokens.colors.length) {
      prompt += `ALL COLORS FOUND IN FIGMA:\n`;
      for (const c of tokens.colors.slice(0, 20)) {
        prompt += `  ${c.value} (from: ${c.source})\n`;
      }
      prompt += `\n`;
    }

    if (tokens.fonts && tokens.fonts.length) {
      prompt += `TYPOGRAPHY FROM FIGMA:\n`;
      for (const f of tokens.fonts.slice(0, 10)) {
        prompt += `  ${f.family} weight:${f.weight} size:${f.size}px${f.lineHeight ? ' line-height:' + Math.round(f.lineHeight) + 'px' : ''} (from: ${f.source})\n`;
      }
      prompt += `\n`;
    }
  }

  if (structureDesc) {
    prompt += `FIGMA LAYOUT STRUCTURE:\n`;
    prompt += `The following is a tree describing the Figma frames, components, and text layers. Interpret this as sections and content for the page. Items marked [COMPONENT] are reusable elements in Figma — check if a matching partial exists before creating new ones.\n\n`;
    prompt += structureDesc + '\n\n';
  }

  if (mode === 'create') {
    prompt += `MODE: Create a new page based on this Figma design. Generate complete HTML that interprets the layout structure above into a real web page. Use the extracted tokens for colors, fonts, and spacing.\n`;
  } else {
    prompt += `MODE: Apply the Figma design to the current page. Update the page's styles, structure, and tokens to match the design intent. Preserve existing content where it aligns with the Figma structure; reshape sections that don't.\n`;
  }

  if (additionalIntent) {
    prompt += `\nADDITIONAL INSTRUCTIONS FROM THE USER:\n${additionalIntent}\n`;
  }

  return prompt;
}
