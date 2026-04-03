// Shared UI rendering logic used by both dashboard and overlay.
// Consumers must provide their own `esc(str)` function.
// All functions return HTML strings or perform DOM operations.

export function esc(s) {
  if (s == null) return '';
  const d = document.createElement('span');
  d.textContent = String(s);
  return d.innerHTML;
}

// ── Preview Preparation ──

function detectPreviewWidth(partial) {
  if (partial.isPattern || partial.mode === 'injectable') return '350px';
  if (partial.mode === 'global') return '100%';
  return '600px';
}

function generatePlaceholderText(hint) {
  const h = (hint || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!h) return 'Sample content';
  return h.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function autoFillHTML(html, partialName) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  doc.querySelectorAll('img').forEach(img => {
    if (!img.getAttribute('src')) {
      const alt = img.getAttribute('alt') || partialName || 'placeholder';
      const kw = alt.toLowerCase().replace(/[^a-z0-9]+/g, ',').replace(/^,|,$/g, '').split(',').slice(0, 2).join(',') || 'abstract';
      img.setAttribute('src', `https://loremflickr.com/600/400/${kw}`);
      if (!img.getAttribute('alt')) img.setAttribute('alt', generatePlaceholderText(partialName));
    }
  });

  doc.querySelectorAll('[style]').forEach(el => {
    const bg = el.style.backgroundImage;
    if (bg && (bg === 'url("")' || bg === 'url()' || bg === 'none')) {
      const kw = partialName ? partialName.replace(/[^a-z0-9]+/g, ',') : 'abstract';
      el.style.backgroundImage = `url(https://loremflickr.com/800/600/${kw})`;
    }
  });

  const textTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'li', 'td', 'th', 'label', 'figcaption', 'blockquote'];
  doc.querySelectorAll(textTags.join(',')).forEach(el => {
    if (el.children.length === 0 && !el.textContent.trim()) {
      const hint = el.getAttribute('data-content') || el.className || el.tagName.toLowerCase();
      el.textContent = generatePlaceholderText(hint);
    }
  });

  let result = doc.body.innerHTML;
  result = result.replace(/\{\{(\w+)\}\}/g, (_, name) => generatePlaceholderText(name));
  return result;
}

function buildDataAttrs(data) {
  if (!data || typeof data !== 'object') return '';
  return Object.entries(data).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join('');
}

function extractJSDataKeys(html) {
  const keys = new Set();
  const patterns = [
    /\.dataset\.(\w+)/g,
    /data-(\w[\w-]*)/g,
  ];
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);
  if (scriptMatch) {
    const js = scriptMatch[1];
    for (const rx of patterns) {
      let m;
      while ((m = rx.exec(js)) !== null) {
        const key = m[1];
        if (!['smOverlay', 'partial', 'section', 'content', 'eachEntry', 'compPreview', 'compName', 'compId', 'decId', 'field', 'variable'].includes(key)) {
          keys.add(key);
        }
      }
    }
  }
  return keys;
}

function generateSampleDataForKeys(keys, partialName) {
  const data = {};
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (lower.includes('image') || lower.includes('img') || lower.includes('photo') || lower.includes('src')) {
      const kw = partialName ? partialName.replace(/[^a-z0-9]+/g, ',') : 'abstract';
      data[key] = `https://loremflickr.com/600/400/${kw}`;
    } else if (lower.includes('href') || lower.includes('url') || lower.includes('link')) {
      data[key] = '#';
    } else {
      data[key] = generatePlaceholderText(key.replace(/([A-Z])/g, ' $1'));
    }
  }
  return data;
}

export function preparePreviewHTML(rawHTML, partial, siteCSS) {
  const preview = partial.preview || {};
  const width = preview.width || detectPreviewWidth(partial);
  const explicitData = preview.data || {};

  let autoData = {};
  const jsKeys = extractJSDataKeys(rawHTML);
  if (jsKeys.size) {
    autoData = generateSampleDataForKeys(jsKeys, partial.name);
  }

  const mergedData = { ...autoData, ...explicitData };
  const dataAttrs = buildDataAttrs(mergedData);

  let bodyHTML = rawHTML;
  let partialCSS = '';
  let partialJS = '';
  const styleRx = /<style>([\s\S]*?)<\/style>/gi;
  const scriptRx = /<script>([\s\S]*?)<\/script>/gi;
  for (const m of rawHTML.matchAll(styleRx)) { partialCSS += m[1]; bodyHTML = bodyHTML.replace(m[0], ''); }
  for (const m of rawHTML.matchAll(scriptRx)) { partialJS += m[1]; bodyHTML = bodyHTML.replace(m[0], ''); }

  const needsAutoFill = partial.isPattern || partial.mode === 'injectable' || Object.keys(explicitData).length > 0;
  if (needsAutoFill) {
    bodyHTML = autoFillHTML(bodyHTML, partial.name);
  }

  const wrapStyle = width === '100%' ? '' : `max-width:${width};margin:0 auto;`;

  return '<!DOCTYPE html><html><head>' + siteCSS +
    '<style>body{margin:0;background:#fff;padding:' + (width === '100%' ? '0' : '16px') + ';}' +
    partialCSS + '</style></head><body>' +
    '<div class="preview-wrap" style="' + wrapStyle + '"' + dataAttrs + '>' +
    bodyHTML.trim() + '</div>' +
    (partialJS ? '<script>' + partialJS + '<\/script>' : '') +
    '</body></html>';
}

// ── Component Preview ──

export async function fetchSiteCSS(pages) {
  if (!pages || !pages.length) {
    try {
      const res = await fetch('/api/pages');
      if (res.ok) pages = await res.json();
    } catch { return ''; }
  }
  if (!pages.length) return '';
  const slug = pages[pages.length - 1].slug;
  try {
    const res = await fetch('/' + slug);
    const html = await res.text();
    const styles = [];
    const linkMatches = html.matchAll(/<link[^>]+href="([^"]*fonts\.googleapis\.com[^"]*)"[^>]*>/gi);
    for (const m of linkMatches) styles.push(m[0]);
    const styleMatches = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    for (const m of styleMatches) {
      if (!m[0].includes('data-sm-overlay')) styles.push(`<style>${m[1]}</style>`);
    }
    return styles.join('\n');
  } catch { return ''; }
}

export function renderComponentCard(partial, opts = {}) {
  const { isUsed = false, showFind = false } = opts;
  return `<div class="sm-comp-card${isUsed ? ' sm-comp-card-used' : ''}" data-comp-name="${esc(partial.name)}" data-comp-id="${esc(partial.id)}">
    <div class="sm-comp-card-header">
      <span class="sm-comp-card-name">${esc(partial.name)}</span>
      ${isUsed ? '<span class="sm-comp-badge sm-comp-badge-active">ON PAGE</span>' : ''}
      ${partial.isPattern ? '<span class="sm-comp-badge sm-comp-badge-pattern">PATTERN</span>' : '<span class="sm-comp-badge sm-comp-badge-partial">PARTIAL</span>'}
      ${partial.weight ? `<span class="sm-comp-badge sm-comp-badge-weight">${esc(partial.weight)}</span>` : ''}
    </div>
    <div class="sm-comp-card-preview" data-comp-preview="${esc(partial.id)}"></div>
    <div class="sm-comp-card-actions">
      ${showFind ? `<button class="sm-comp-btn sm-comp-find" ${!isUsed ? 'disabled' : ''}>Find</button>` : ''}
      <button class="sm-comp-btn sm-comp-edit">Edit</button>
      <button class="sm-comp-btn sm-comp-delete">&times;</button>
    </div>
  </div>`;
}

export async function mountComponentPreview(container, partial, siteCSS) {
  const partialId = typeof partial === 'string' ? partial : partial?.id;
  const partialMeta = typeof partial === 'object' ? partial : { id: partialId, name: '', mode: 'global', isPattern: false };
  try {
    const res = await fetch(`/api/partials/${partialId}/html`);
    if (!res.ok) return;
    const html = await res.text();
    if (!html.trim()) {
      container.innerHTML = '<div style="color:#64748b;font-size:11px;padding:8px;text-align:center;">Empty component</div>';
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.className = 'sm-comp-iframe';
    iframe.sandbox = 'allow-same-origin allow-scripts';
    container.innerHTML = '';
    container.appendChild(iframe);
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(preparePreviewHTML(html, partialMeta, siteCSS));
    doc.close();
    requestAnimationFrame(() => {
      const bodyW = doc.body.scrollWidth || 1;
      const bodyH = doc.body.scrollHeight || 80;
      const containerW = container.offsetWidth || 280;
      const scale = Math.min(1, containerW / bodyW);
      iframe.style.transform = `scale(${scale})`;
      iframe.style.transformOrigin = 'top left';
      iframe.style.width = (bodyW) + 'px';
      iframe.style.height = (bodyH) + 'px';
      container.style.height = Math.min(150, Math.ceil(bodyH * scale)) + 'px';
    });
  } catch {}
}

// ── Component Editor (full-window, shared between dashboard & overlay) ──

export async function openComponentEditor({ partial, onSave, onClose }) {
  const isNew = !partial;
  const existing = partial || {};

  let html = '';
  let siteCSS = '';
  if (existing.id) {
    const [htmlRes, css] = await Promise.all([
      fetch('/api/partials/' + existing.id + '/html').then(r => r.ok ? r.text() : ''),
      fetchSiteCSS(),
    ]);
    html = htmlRes;
    siteCSS = css;
  } else {
    siteCSS = await fetchSiteCSS();
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'sm-editor-backdrop';
  backdrop.setAttribute('data-sm-overlay', '');
  backdrop.innerHTML = `
    <div class="sm-editor">
      <div class="sm-editor-header">
        <h2 class="sm-editor-title">${isNew ? 'New Component' : esc(existing.name)}</h2>
        <div class="sm-editor-header-actions">
          <button class="sm-editor-btn sm-editor-save">Save</button>
          <button class="sm-editor-btn sm-editor-cancel">Cancel</button>
        </div>
      </div>
      <div class="sm-editor-body">
        <div class="sm-editor-left">
          <div class="sm-editor-meta">
            <div class="sm-editor-field">
              <label>Name</label>
              <input name="name" value="${esc(existing.name)}" placeholder="e.g. header, footer, hero-card" required>
            </div>
            <div class="sm-editor-row">
              <div class="sm-editor-field">
                <label>Type</label>
                <select name="isPattern">
                  <option value="false" ${!existing.isPattern ? 'selected' : ''}>Partial</option>
                  <option value="true" ${existing.isPattern ? 'selected' : ''}>Pattern</option>
                </select>
              </div>
              <div class="sm-editor-field">
                <label>Mode</label>
                <select name="mode">
                  <option value="global" ${(existing.mode || 'global') === 'global' ? 'selected' : ''}>Global</option>
                  <option value="injectable" ${existing.mode === 'injectable' ? 'selected' : ''}>Injectable</option>
                </select>
              </div>
              <div class="sm-editor-field">
                <label>Weight</label>
                <select name="weight">
                  <option value="rule" ${(existing.weight || 'rule') === 'rule' ? 'selected' : ''}>Rule</option>
                  <option value="guide" ${existing.weight === 'guide' ? 'selected' : ''}>Guide</option>
                </select>
              </div>
              <div class="sm-editor-field">
                <label>Scope</label>
                <select name="scope">
                  <option value="global" ${(existing.scope || 'global') === 'global' ? 'selected' : ''}>Global</option>
                  <option value="page" ${existing.scope === 'page' ? 'selected' : ''}>Page</option>
                  <option value="collection" ${existing.scope === 'collection' ? 'selected' : ''}>Collection</option>
                </select>
              </div>
            </div>
          </div>
          <div class="sm-editor-source">
            <div class="sm-editor-source-header">
              <label>HTML Source</label>
            </div>
            <textarea class="sm-editor-textarea" spellcheck="false" placeholder="<header>...</header>">${esc(html)}</textarea>
          </div>
        </div>
        <div class="sm-editor-right">
          <div class="sm-editor-preview-header"><label>Preview</label></div>
          <div class="sm-editor-preview-wrap">
            <iframe class="sm-editor-preview" sandbox="allow-same-origin allow-scripts"></iframe>
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(backdrop);

  const textarea = backdrop.querySelector('.sm-editor-textarea');
  const previewFrame = backdrop.querySelector('.sm-editor-preview');

  function getCurrentMeta() {
    return {
      name: backdrop.querySelector('[name="name"]')?.value || existing.name || '',
      mode: backdrop.querySelector('[name="mode"]')?.value || existing.mode || 'global',
      isPattern: (backdrop.querySelector('[name="isPattern"]')?.value === 'true') || existing.isPattern || false,
      preview: existing.preview,
    };
  }

  function renderPreview(content) {
    previewFrame.srcdoc = preparePreviewHTML(content, getCurrentMeta(), siteCSS);
  }

  if (html) renderPreview(html);

  let debounceTimer;
  textarea.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderPreview(textarea.value), 200);
  });

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = textarea.selectionStart, end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, s) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = s + 2;
    }
  });

  function close() {
    backdrop.remove();
    if (onClose) onClose();
  }

  backdrop.querySelector('.sm-editor-cancel').addEventListener('click', close);
  backdrop.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  backdrop.querySelector('.sm-editor-save').addEventListener('click', async () => {
    const name = backdrop.querySelector('[name="name"]').value.trim();
    if (!name) { backdrop.querySelector('[name="name"]').focus(); return; }

    const data = {
      name,
      mode: backdrop.querySelector('[name="mode"]').value,
      weight: backdrop.querySelector('[name="weight"]').value,
      scope: backdrop.querySelector('[name="scope"]').value,
      isPattern: backdrop.querySelector('[name="isPattern"]').value === 'true',
      html: textarea.value,
    };

    const saveBtn = backdrop.querySelector('.sm-editor-save');
    saveBtn.textContent = 'Saving…';
    saveBtn.disabled = true;

    try {
      if (existing.id) {
        const { html: htmlContent, ...meta } = data;
        await fetch('/api/partials/' + existing.id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(meta),
        });
        await fetch('/api/partials/' + existing.id + '/html', {
          method: 'PUT',
          headers: { 'Content-Type': 'text/html' },
          body: htmlContent,
        });
      } else {
        await fetch('/api/partials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      }
      close();
      if (onSave) onSave(data);
    } catch (err) {
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }
  });

  textarea.focus();
}

// ── Decision Rendering ──

export function renderDecisionRow(d, opts = {}) {
  const { compact = false } = opts;
  const isColor = d.kind === 'token' && /^(#[0-9a-f]{3,8}|rgb|hsl)/i.test(d.content);
  const varAttr = d.variable ? ` data-variable="${esc(d.variable)}"` : '';
  const varHint = d.variable ? `<span class="sm-dec-var">var(--${esc(d.variable)})</span>` : '';
  return `<div class="sm-dec-row" data-dec-id="${esc(d.id)}"${varAttr}>
    <div class="sm-dec-main">
      ${isColor ? `<span class="sm-dec-swatch" style="background:${esc(d.content)}"></span>` : ''}
      <span class="sm-dec-name">${esc(d.name)}</span>
      ${varHint}
      <span class="sm-dec-kind">${esc(d.kind)}</span>
      <span class="sm-dec-weight">${esc(d.weight)}</span>
    </div>
    ${compact ? `<div class="sm-dec-value">${esc((d.content || '').slice(0, 60))}</div>` : `<input class="sm-dec-input" value="${esc(d.content)}" data-field="content">`}
    <div class="sm-dec-meta">
      <select class="sm-dec-select" data-field="weight">
        <option value="rule"${d.weight === 'rule' ? ' selected' : ''}>rule</option>
        <option value="guide"${d.weight === 'guide' ? ' selected' : ''}>guide</option>
        <option value="absolute"${d.weight === 'absolute' ? ' selected' : ''}>absolute</option>
      </select>
      <select class="sm-dec-select" data-field="scope">
        <option value="global"${d.scope === 'global' ? ' selected' : ''}>global</option>
      </select>
      <button class="sm-dec-delete" title="Delete">&times;</button>
    </div>
  </div>`;
}

// ── Media Card Rendering ──

export function renderMediaCard(item) {
  const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(item.path) || (item.mimeType || '').startsWith('image/');
  const name = item.originalName || item.path.split('/').pop();
  const sizeKB = item.size ? Math.round(item.size / 1024) + ' KB' : '';
  return `<div class="sm-media-item" data-media-id="${esc(item.id)}" data-media-path="${esc(item.path)}">
    <div class="sm-media-thumb">
      ${isImage ? `<img src="${esc(item.path)}" loading="lazy" alt="${esc(name)}">` : `<span class="sm-media-ext">${esc(item.path.split('.').pop().toUpperCase())}</span>`}
    </div>
    <div class="sm-media-info">
      <span class="sm-media-name">${esc(name)}</span>
      ${sizeKB ? `<span class="sm-media-size">${sizeKB}</span>` : ''}
    </div>
    <div class="sm-media-actions">
      <button class="sm-media-copy">Copy</button>
      <button class="sm-media-del">&times;</button>
    </div>
  </div>`;
}
