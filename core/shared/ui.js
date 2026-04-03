// Shared UI rendering logic used by both dashboard and overlay.
// Consumers must provide their own `esc(str)` function.
// All functions return HTML strings or perform DOM operations.

export function esc(s) {
  if (s == null) return '';
  const d = document.createElement('span');
  d.textContent = String(s);
  return d.innerHTML;
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

export async function mountComponentPreview(container, partialId, siteCSS) {
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
    iframe.sandbox = 'allow-same-origin';
    container.innerHTML = '';
    container.appendChild(iframe);
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head>${siteCSS}<style>body{margin:0;overflow:hidden;background:#fff;}</style></head><body>${html}</body></html>`);
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

// ── Decision Rendering ──

export function renderDecisionRow(d, opts = {}) {
  const { compact = false } = opts;
  const isColor = d.kind === 'token' && /^(#[0-9a-f]{3,8}|rgb|hsl)/i.test(d.content);
  return `<div class="sm-dec-row" data-dec-id="${esc(d.id)}">
    <div class="sm-dec-main">
      ${isColor ? `<span class="sm-dec-swatch" style="background:${esc(d.content)}"></span>` : ''}
      <span class="sm-dec-name">${esc(d.name)}</span>
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
