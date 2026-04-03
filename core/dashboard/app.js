const state = {
  view: 'pages',
  pages: [],
  decisions: [],
  partials: [],
  collections: [],
  site: {},
  user: null,
  decisionFilter: 'all',
  decisionSearch: '',
  activeCollection: null,
  media: [],
  extensionManifests: [],
  activeExtension: null,
};

// ── API ──

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  if (res.status === 204) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

async function load() {
  const el = document.getElementById('content');
  try {
    [state.site, state.pages, state.decisions, state.partials, state.collections, state.media, state.extensionManifests, state.user] = await Promise.all([
      api('GET', '/site'),
      api('GET', '/pages'),
      api('GET', '/decisions'),
      api('GET', '/partials'),
      api('GET', '/collections'),
      api('GET', '/media').catch(() => []),
      api('GET', '/extensions/manifest').catch(() => []),
      fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    renderUserBadge();
    renderSetupBanner();
    render();
  } catch (err) {
    el.innerHTML = `<div class="empty-state" role="alert">
      <p style="color:#dc2626;font-weight:500">Failed to load dashboard data</p>
      <p style="margin-top:8px">${esc(err.message)}</p>
      <button class="btn" onclick="load()" style="margin-top:16px">Retry</button>
    </div>`;
  }
}

// ── Navigation ──

document.querySelector('.nav').addEventListener('click', e => {
  const colItem = e.target.closest('[data-collection]');
  if (colItem) {
    state.view = 'collections';
    state.activeCollection = colItem.dataset.collection;
    state.activeExtension = null;
    renderNav();
    render();
    return;
  }
  const extItem = e.target.closest('[data-extension]');
  if (extItem) {
    state.view = 'extension';
    state.activeExtension = extItem.dataset.extension;
    renderNav();
    render();
    return;
  }
  const item = e.target.closest('[data-view]');
  if (!item) return;
  state.view = item.dataset.view;
  if (item.dataset.view === 'collections') state.activeCollection = null;
  state.activeExtension = null;
  renderNav();
  render();
});

function renderNav() {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (state.view !== 'extension') {
    const active = document.querySelector(`[data-view="${state.view}"]`);
    if (active) active.classList.add('active');
  }

  const sub = document.getElementById('nav-collections-sub');
  if (sub) {
    const isCollections = state.view === 'collections';
    sub.style.display = isCollections && state.collections.length ? 'block' : 'none';
    sub.innerHTML = state.collections.map(c =>
      `<a class="nav-sub-item${state.activeCollection === c.id ? ' active' : ''}" data-collection="${c.id}">${esc(c.name)}</a>`
    ).join('');
  }

  let extNav = document.getElementById('nav-extensions');
  if (!extNav) {
    extNav = document.createElement('div');
    extNav.id = 'nav-extensions';
    document.querySelector('.nav').appendChild(extNav);
  }

  const dashExts = (state.extensionManifests || []).filter(m => m.ui?.dashboard?.nav);
  if (dashExts.length) {
    extNav.innerHTML = '<div class="nav-divider"></div>' + dashExts.map(m =>
      `<a class="nav-item${state.activeExtension === m.id ? ' active' : ''}" data-extension="${m.id}">${esc(m.ui.dashboard.nav.label || m.id)}</a>`
    ).join('');
    extNav.style.display = 'block';
  } else {
    extNav.style.display = 'none';
  }
}

// ── Render ──

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function render() {
  document.getElementById('site-name').textContent = state.site?.name || 'My Website';
  renderNav();
  const el = document.getElementById('content');
  const banner = setupBannerHTML();
  switch (state.view) {
    case 'pages': el.innerHTML = banner + renderPages(); break;
    case 'collections': el.innerHTML = banner + (state.activeCollection ? renderEntries() : renderCollections()); break;
    case 'decisions': el.innerHTML = banner + renderDecisions(); break;
    case 'partials': el.innerHTML = banner + renderPartials(); break;
    case 'media': el.innerHTML = banner + renderMedia(); break;
    case 'settings': el.innerHTML = banner + renderSettings(); initSettings(); break;
    case 'extension': renderExtensionPanel(el); break;
  }
}

function renderExtensionPanel(container) {
  const manifest = (state.extensionManifests || []).find(m => m.id === state.activeExtension);
  if (!manifest || !manifest.ui?.dashboard?.panel) {
    container.innerHTML = '<p class="empty-state">Extension panel not available.</p>';
    return;
  }
  const panelUrl = manifest.ui.dashboard.panel;
  container.innerHTML = `<iframe class="ext-panel-frame" src="${esc(panelUrl)}" frameborder="0"></iframe>`;
}

// ── Pages View ──

function renderPages() {
  let h = `<div class="view-header"><h1>Pages</h1>
    <div class="view-header-actions">
      <button class="btn" onclick="publishSite()">Publish Site</button>
      <button class="btn btn-primary" onclick="showGenerateModal()">+ Generate Page</button>
    </div></div>`;
  if (!state.pages.length) {
    return h + '<p class="empty-state">No pages yet. Generate your first page — the AI will bootstrap your design system automatically.</p>';
  }
  h += '<div class="card-grid">';
  for (const p of state.pages) {
    const status = p.status || 'draft';
    const statusClass = status === 'published' ? 'tag-published' : 'tag-draft';
    h += `<div class="card">
      <div class="card-title-row">
        <h3>${esc(p.title)}</h3>
        <span class="tag ${statusClass}">${status}</span>
      </div>
      <p class="card-meta">/${esc(p.slug)}</p>
      ${p.intent ? `<p class="card-meta" style="margin-bottom:14px">${esc(p.intent).slice(0,80)}${p.intent.length>80?'...':''}</p>` : ''}
      <div class="card-actions">
        <a href="${p.slug === 'home' ? '/' : '/' + esc(p.slug)}" class="btn btn-sm" target="_blank">View & Edit</a>
        <button class="btn btn-sm" onclick="togglePageStatus('${p.id}', '${status}')">${status === 'published' ? 'Unpublish' : 'Publish'}</button>
        <button class="btn btn-sm" onclick="showChatLog('${esc(p.slug)}', '${esc(p.title)}')">Chat Log</button>
        <button class="btn btn-sm" onclick="showHistory('pages','${esc(p.slug)}','${esc(p.title)}')">History</button>
        <button class="btn btn-sm btn-danger" onclick="deletePage('${p.id}')">Delete</button>
      </div>
    </div>`;
  }
  return h + '</div>';
}

window.togglePageStatus = async function(id, currentStatus) {
  const newStatus = currentStatus === 'published' ? 'draft' : 'published';
  await api('PUT', '/pages/' + id, { status: newStatus });
  await load();
};

window.publishSite = async function() {
  if (!confirm('Export all pages to dist/ for deployment?')) return;
  showLoading('Publishing site…');
  try {
    const result = await api('POST', '/publish');
    hideLoading();
    showModal(`<h2>Site Published</h2>
      <pre style="background:#0f172a;padding:12px;border-radius:8px;font-size:12px;max-height:300px;overflow:auto;white-space:pre-wrap;color:#94a3b8">${esc(result.output || 'Done.')}</pre>
      <div class="form-actions"><button class="btn" onclick="hideModal()">Close</button></div>`);
  } catch (err) {
    hideLoading();
    alert('Publish failed: ' + err.message);
  }
};

window.showGenerateModal = function() {
  const enhancers = (state.extensionManifests || [])
    .filter(m => m.ui?.dashboard?.generateEnhancer)
    .map(m => ({ id: m.id, ...m.ui.dashboard.generateEnhancer }));

  const enhancerButtons = enhancers.map(e =>
    `<button type="button" class="btn btn-enhancer" data-enhancer="${esc(e.id)}" title="${esc(e.label)}">${esc(e.icon || e.label[0])}<span>${esc(e.label)}</span></button>`
  ).join('');

  showModal(`<h2>Generate Page</h2>
    <form id="gen-form">
      <div class="form-group"><label>Title</label>
        <input name="title" required placeholder="e.g. Home, About Us, Pricing"></div>
      <div class="form-group"><label>Slug <span style="font-weight:400;color:#9ca3af">— optional, derived from title if blank</span></label>
        <input name="slug" pattern="[a-z0-9][a-z0-9-]*" placeholder="e.g. home, about, pricing"></div>
      <div class="form-group"><label>Intent — describe the page you want</label>
        <textarea name="intent" rows="5" required placeholder="A landing page for a SaaS product that helps teams manage design tokens. Hero section with headline and CTA, features grid, testimonials, and a final call to action."></textarea></div>
      ${enhancers.length ? `<div class="gen-enhancers"><label>Enhance with</label><div class="gen-enhancer-buttons">${enhancerButtons}</div></div><div id="gen-enhancer-area"></div>` : ''}
      <div class="form-actions">
        <button type="button" class="btn" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Generate</button>
      </div>
    </form>`);

  const activeEnhancers = new Map();

  if (enhancers.length) {
    document.querySelectorAll('[data-enhancer]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.enhancer;
        const enhancer = enhancers.find(e => e.id === id);
        const area = document.getElementById('gen-enhancer-area');

        if (btn.classList.contains('active')) {
          btn.classList.remove('active');
          activeEnhancers.delete(id);
          area.innerHTML = '';
          return;
        }

        document.querySelectorAll('[data-enhancer]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (enhancer.fields) {
          try {
            const res = await fetch(enhancer.fields);
            area.innerHTML = await res.text();
          } catch { area.innerHTML = ''; }
        }

        activeEnhancers.set(id, enhancer);
      });
    });
  }

  document.getElementById('gen-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    showLoading('Generating page with AI…');
    try {
      let intent = f.intent.value;

      for (const [id, enhancer] of activeEnhancers) {
        if (enhancer.prepare) {
          const inputs = {};
          document.querySelectorAll('#gen-enhancer-area [data-enhancer-field]').forEach(el => {
            inputs[el.dataset.enhancerField] = el.value;
          });
          const res = await fetch(enhancer.prepare, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.context) intent = data.context + '\n\n' + intent;
          }
        }
      }

      const result = await api('POST', '/generate', {
        title: f.title.value,
        slug: f.slug.value,
        intent,
      });
      hideModal();
      await load();
      showGenerationSummary(result);
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
      btn.textContent = 'Generate';
    } finally {
      hideLoading();
    }
  };
};

function showGenerationSummary(result) {
  const nd = result.newDecisions || [];
  const np = result.newPartials || [];
  const slug = result.page?.slug || 'home';

  let h = '<h2>Page Generated</h2>';
  h += `<p style="margin-bottom:16px;color:#6b7280">The AI created the page and proposed the following:</p>`;

  if (nd.length) {
    h += '<h3 style="font-size:14px;margin-bottom:8px">New Decisions</h3><ul style="margin-bottom:16px;padding-left:20px">';
    for (const d of nd) {
      const isColor = d.kind === 'token' && /^#[0-9a-f]{3,8}$/i.test(d.content);
      h += `<li style="margin-bottom:4px"><span class="tag tag-${d.kind}">${d.kind}</span> <strong>${esc(d.name)}</strong>: ${isColor ? `<span class="color-swatch" style="background:${esc(d.content)}"></span>` : ''}${esc(d.content)}</li>`;
    }
    h += '</ul>';
  }

  if (np.length) {
    h += '<h3 style="font-size:14px;margin-bottom:8px">New Partials</h3><ul style="margin-bottom:16px;padding-left:20px">';
    for (const p of np) {
      h += `<li style="margin-bottom:4px"><span class="tag tag-partial">partial</span> <strong>${esc(p.name)}</strong></li>`;
    }
    h += '</ul>';
  }

  h += `<div class="form-actions">
    <a href="${slug === 'home' ? '/' : '/' + esc(slug)}" class="btn btn-primary" target="_blank">View Page</a>
    <button class="btn" onclick="hideModal()">Close</button>
  </div>`;
  showModal(h);
}

window.showChatLog = async function(slug, title) {
  const messages = await api('GET', '/chat/' + slug);
  let h = `<h2>Chat Log: ${esc(title)}</h2>`;
  if (!messages || !messages.length) {
    h += '<p class="empty-state">No chat history for this page yet. Open the page and use the AI chat to start a conversation.</p>';
  } else {
    h += '<div class="chat-log">';
    for (const msg of messages) {
      const roleLabel = msg.role === 'user' ? 'You' : 'AI';
      const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
      h += `<div class="chat-log-msg chat-log-${msg.role}">
        <div class="chat-log-meta"><strong>${roleLabel}</strong>${ts ? ` &middot; ${ts}` : ''}</div>
        <div class="chat-log-body">${esc(msg.content)}</div>
      </div>`;
    }
    h += '</div>';
  }
  h += `<div class="form-actions">
    <button type="button" class="btn btn-danger" onclick="clearPageChat('${esc(slug)}', '${esc(title)}')">Clear History</button>
    <button type="button" class="btn" onclick="hideModal()">Close</button>
  </div>`;
  showModal(h);
};

window.clearPageChat = async function(slug, title) {
  if (!confirm('Clear all chat history for this page?')) return;
  await api('DELETE', '/chat/' + slug);
  showChatLog(slug, title);
};

window.deletePage = async function(id) {
  if (!confirm('Delete this page?')) return;
  await api('DELETE', '/pages/' + id);
  await load();
};

// ── Decisions View ──

function renderDecisions() {
  const filter = state.decisionFilter;
  const search = (state.decisionSearch || '').toLowerCase();
  let list = filter === 'all' ? state.decisions : state.decisions.filter(d => d.kind === filter);
  if (search) list = list.filter(d => d.name.toLowerCase().includes(search) || (d.content || '').toLowerCase().includes(search));

  let h = `<div class="view-header"><h1>Decisions</h1>
    <button class="btn btn-primary" onclick="showDecisionModal()">+ Add Decision</button></div>`;

  h += `<div class="filter-bar">
    ${['all','token','instruction','asset'].map(f =>
      `<button class="filter-pill${filter===f?' active':''}" onclick="filterDecisions('${f}')">${f === 'all' ? 'All' : f.charAt(0).toUpperCase()+f.slice(1)+'s'}</button>`
    ).join('')}
    <input type="text" class="filter-search" placeholder="Search decisions…" value="${esc(state.decisionSearch || '')}" oninput="searchDecisions(this.value)">
  </div>`;

  if (!list.length) {
    return h + '<p class="empty-state">No decisions yet. Generate a page and the AI will propose tokens and instructions, or add them manually.</p>';
  }

  h += `<table class="data-table"><thead><tr>
    <th>Name</th><th>Kind</th><th>Weight</th><th>Scope</th><th>Value</th><th></th>
  </tr></thead><tbody>`;
  for (const d of list) {
    const isColor = d.kind === 'token' && /^#[0-9a-f]{3,8}$/i.test(d.content);
    const scopeLabel = d.scope === 'global' ? 'global' : d.scope;
    h += `<tr>
      <td><strong>${esc(d.name)}</strong></td>
      <td><span class="tag tag-${d.kind}">${d.kind}</span></td>
      <td><span class="tag tag-${d.weight}">${d.weight}</span></td>
      <td>${esc(scopeLabel)}</td>
      <td>${isColor ? `<span class="color-swatch" style="background:${esc(d.content)}"></span>` : ''}${esc(d.content).slice(0,50)}</td>
      <td style="text-align:right">
        <button class="btn btn-sm" onclick="showDecisionModal('${d.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteDecisionAction('${d.id}')">Delete</button>
      </td>
    </tr>`;
  }
  return h + '</tbody></table>';
}

window.filterDecisions = function(f) {
  state.decisionFilter = f;
  render();
};

window.searchDecisions = function(q) {
  state.decisionSearch = q;
  render();
};

window.showDecisionModal = function(editId) {
  const existing = editId ? state.decisions.find(d => d.id === editId) : null;
  const title = existing ? 'Edit Decision' : 'Add Decision';
  const existingScope = existing?.scope || 'global';
  const scopeBase = existingScope.startsWith('page:') ? 'page' : existingScope.startsWith('collection:') ? 'collection' : existingScope;
  const scopeTarget = existingScope.includes(':') ? existingScope.split(':').slice(1).join(':') : '';

  showModal(`<h2>${title}</h2>
    <form id="dec-form">
      <div class="form-group"><label>Name</label>
        <input name="name" required value="${esc(existing?.name)}" placeholder="e.g. Primary Color, Brand Voice"></div>
      <div class="form-row">
        <div class="form-group"><label>Kind</label>
          <select name="kind" id="dec-kind">
            <option value="token" ${existing?.kind==='token'?'selected':''}>Token</option>
            <option value="instruction" ${existing?.kind==='instruction'?'selected':''}>Instruction</option>
            <option value="asset" ${existing?.kind==='asset'?'selected':''}>Asset</option>
          </select></div>
        <div class="form-group"><label>Weight</label>
          <select name="weight">
            <option value="rule" ${existing?.weight==='rule'?'selected':''}>Rule</option>
            <option value="guide" ${existing?.weight==='guide'?'selected':''}>Guide</option>
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Scope</label>
          <select name="scope_base" id="dec-scope-base">
            <option value="global" ${scopeBase==='global'?'selected':''}>Global</option>
            <option value="page" ${scopeBase==='page'?'selected':''}>Page</option>
            <option value="collection" ${scopeBase==='collection'?'selected':''}>Collection</option>
          </select></div>
        <div class="form-group" id="dec-scope-target-group" style="display:${scopeBase !== 'global' ? 'block' : 'none'}">
          <label id="dec-scope-target-label">${scopeBase === 'page' ? 'Page slug' : scopeBase === 'collection' ? 'Collection slug' : 'Target'}</label>
          <input name="scope_target" id="dec-scope-target" value="${esc(scopeTarget)}" placeholder="${scopeBase === 'page' ? 'e.g. about' : 'e.g. blog'}">
        </div>
      </div>
      <div id="dec-content-area"></div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Add'}</button>
      </div>
    </form>`);

  const kindSelect = document.getElementById('dec-kind');
  const scopeBase$ = document.getElementById('dec-scope-base');
  const scopeTargetGroup = document.getElementById('dec-scope-target-group');
  const scopeTargetLabel = document.getElementById('dec-scope-target-label');
  const contentArea = document.getElementById('dec-content-area');

  function renderContentEditor(kind, value) {
    if (kind === 'token') {
      const isColor = /^#[0-9a-f]{3,8}$/i.test(value);
      contentArea.innerHTML = `<div class="form-group"><label>Value</label>
        <div class="dec-token-input">
          <input name="content" value="${esc(value)}" placeholder="CSS value: #hex, font name, px/rem…" required>
          <input type="color" id="dec-color-picker" value="${isColor ? esc(value) : '#000000'}" title="Pick color">
        </div></div>`;
      const textInput = contentArea.querySelector('input[name="content"]');
      const colorPicker = document.getElementById('dec-color-picker');
      colorPicker.addEventListener('input', () => { textInput.value = colorPicker.value; });
      textInput.addEventListener('input', () => {
        if (/^#[0-9a-f]{3,8}$/i.test(textInput.value)) colorPicker.value = textInput.value;
      });
    } else if (kind === 'instruction') {
      contentArea.innerHTML = `<div class="form-group"><label>Instruction</label>
        <textarea name="content" rows="4" placeholder="Prose guidance for the AI…">${esc(value)}</textarea></div>`;
    } else {
      contentArea.innerHTML = `<div class="form-group"><label>Asset path</label>
        <input name="content" value="${esc(value)}" placeholder="/media/uploads/logo.svg"></div>`;
    }
  }

  renderContentEditor(existing?.kind || 'token', existing?.content || '');

  kindSelect.addEventListener('change', () => {
    renderContentEditor(kindSelect.value, '');
  });

  scopeBase$.addEventListener('change', () => {
    const base = scopeBase$.value;
    if (base === 'global') {
      scopeTargetGroup.style.display = 'none';
    } else {
      scopeTargetGroup.style.display = 'block';
      scopeTargetLabel.textContent = base === 'page' ? 'Page slug' : 'Collection slug';
      document.getElementById('dec-scope-target').placeholder = base === 'page' ? 'e.g. about' : 'e.g. blog';
    }
  });

  document.getElementById('dec-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const base = f.scope_base.value;
    const target = f.scope_target?.value?.trim();
    const scope = base === 'global' ? 'global' : target ? `${base}:${target}` : base;
    const data = {
      name: f.name.value, kind: f.kind.value,
      weight: f.weight.value, scope, content: f.content.value,
    };
    if (existing) await api('PUT', '/decisions/' + editId, data);
    else await api('POST', '/decisions', data);
    hideModal();
    await load();
  };
};

window.deleteDecisionAction = async function(id) {
  if (!confirm('Delete this decision?')) return;
  await api('DELETE', '/decisions/' + id);
  await load();
};

// ── Partials View ──

function renderPartials() {
  const filter = state.componentFilter || 'all';
  let list = state.partials;
  if (filter === 'partial') list = list.filter(p => !p.isPattern);
  else if (filter === 'pattern') list = list.filter(p => p.isPattern);

  let h = `<div class="view-header"><h1>Components</h1>
    <button class="btn btn-primary" onclick="showPartialModal()">+ Add Component</button></div>`;

  h += `<div class="filter-bar">
    ${['all','partial','pattern'].map(f =>
      `<button class="filter-pill${filter===f?' active':''}" onclick="filterComponents('${f}')">${f === 'all' ? 'All' : f.charAt(0).toUpperCase()+f.slice(1)+'s'}</button>`
    ).join('')}</div>`;

  if (!list.length) {
    return h + '<p class="empty-state">No components yet. Generate a page and the AI will create header/footer partials, or save sections as components from the overlay.</p>';
  }

  h += '<div class="component-grid">';
  for (const p of list) {
    const typeLabel = p.isPattern ? 'pattern' : 'partial';
    const typeClass = p.isPattern ? 'guide' : 'rule';
    h += `<div class="component-card">
      <div class="component-preview" id="comp-preview-${p.id}"></div>
      <div class="component-info">
        <strong>${esc(p.name)}</strong>
        <div class="component-meta">
          <span class="tag tag-${typeClass}">${typeLabel}</span>
          <span class="tag tag-${p.weight || 'rule'}">${p.weight || 'rule'}</span>
          <span class="card-meta">v${p.version || 1}</span>
        </div>
      </div>
      <div class="component-actions">
        <button class="btn btn-sm" onclick="showPartialModal('${p.id}')">Edit</button>
        <button class="btn btn-sm" onclick="showHistory('partials','${esc(p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))}','${esc(p.name)}')">History</button>
        <button class="btn btn-sm btn-danger" onclick="deletePartialAction('${p.id}')">Delete</button>
      </div>
    </div>`;
  }
  h += '</div>';

  setTimeout(async () => {
    const siteCSS = await getSiteCSS();
    for (const p of list) {
      const container = document.getElementById(`comp-preview-${p.id}`);
      if (!container) continue;
      const iframe = document.createElement('iframe');
      iframe.className = 'component-preview-frame';
      iframe.sandbox = 'allow-same-origin';
      container.appendChild(iframe);
      fetch(`/api/partials/${p.id}/html`).then(r => r.ok ? r.text() : '').then(html => {
        iframe.srcdoc = `<!DOCTYPE html><html><head>${siteCSS}<style>body{margin:0;overflow:hidden;transform:scale(0.5);transform-origin:top left;width:200%;}</style></head><body>${html}</body></html>`;
      }).catch(() => {});
    }
  }, 0);

  return h;
}

window.filterComponents = function(f) {
  state.componentFilter = f;
  render();
};

async function getSiteCSS() {
  if (!state.pages.length) return '';
  const slug = state.pages[state.pages.length - 1].slug;
  try {
    const res = await fetch('/' + slug);
    const pageHTML = await res.text();
    const styles = [];
    const linkMatches = pageHTML.matchAll(/<link[^>]+href="([^"]*fonts\.googleapis\.com[^"]*)"[^>]*>/gi);
    for (const m of linkMatches) styles.push(m[0]);
    const styleMatches = pageHTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    for (const m of styleMatches) {
      if (!m[0].includes('data-sm-overlay')) styles.push(`<style>${m[1]}</style>`);
    }
    return styles.join('\n');
  } catch { return ''; }
}

window.showPartialModal = async function(editId) {
  const existing = editId ? state.partials.find(p => p.id === editId) : null;
  let html = '';
  let siteCSS = '';
  if (existing) {
    const [htmlRes, css] = await Promise.all([
      fetch('/api/partials/' + editId + '/html'),
      getSiteCSS(),
    ]);
    html = await htmlRes.text();
    siteCSS = css;
  }

  showModal(`<h2>${existing ? 'Edit Component' : 'Add Component'}</h2>
    <form id="partial-form">
      <div class="form-group"><label>Name</label>
        <input name="name" required value="${esc(existing?.name)}" placeholder="e.g. header, footer, hero-card"></div>
      <div class="form-row">
        <div class="form-group"><label>Type</label>
          <select name="isPattern">
            <option value="false" ${!existing?.isPattern?'selected':''}>Partial — server-injected via directive</option>
            <option value="true" ${existing?.isPattern?'selected':''}>Pattern — AI reference template</option>
          </select></div>
        <div class="form-group"><label>Mode</label>
          <select name="mode">
            <option value="global" ${(existing?.mode || 'global')==='global'?'selected':''}>Global</option>
            <option value="injectable" ${existing?.mode==='injectable'?'selected':''}>Injectable (slots)</option>
          </select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Weight</label>
          <select name="weight">
            <option value="rule" ${(existing?.weight || 'rule')==='rule'?'selected':''}>Rule — use exactly</option>
            <option value="guide" ${existing?.weight==='guide'?'selected':''}>Guide — preferred, can deviate</option>
          </select></div>
        <div class="form-group"><label>Scope</label>
          <select name="scope">
            <option value="global" ${(existing?.scope || 'global')==='global'?'selected':''}>Global</option>
            <option value="page" ${existing?.scope?.startsWith('page')?'selected':''}>Page</option>
            <option value="collection" ${existing?.scope?.startsWith('collection')?'selected':''}>Collection</option>
          </select></div>
      </div>
      ${html ? `<div class="form-group"><label>Preview</label>
        <div class="comp-preview-wrap">
          <iframe id="comp-preview" class="comp-preview" sandbox="allow-same-origin"></iframe>
        </div></div>` : ''}
      <div class="form-group">
        <div class="comp-source-header">
          <label>HTML Source</label>
          ${html ? '<button type="button" class="btn btn-sm" id="comp-toggle-source">Show Source</button>' : ''}
        </div>
        <div id="comp-source-wrap" ${html ? 'style="display:none"' : ''}>
          <textarea name="html" id="comp-html" class="code-textarea" rows="12" placeholder="<header>...</header>" spellcheck="false">${esc(html)}</textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Add'}</button>
      </div>
    </form>`);

  const previewFrame = document.getElementById('comp-preview');
  function renderPreview(content) {
    if (!previewFrame) return;
    let markup = content;
    let partialCSS = '';
    let partialJS = '';
    const styleRx = /<style>([\s\S]*?)<\/style>/gi;
    const scriptRx = /<script>([\s\S]*?)<\/script>/gi;
    for (const m of content.matchAll(styleRx)) { partialCSS += m[1]; markup = markup.replace(m[0], ''); }
    for (const m of content.matchAll(scriptRx)) { partialJS += m[1]; markup = markup.replace(m[0], ''); }
    previewFrame.srcdoc = `<!DOCTYPE html><html><head>${siteCSS}<style>body{margin:0;}${partialCSS}</style></head><body>${markup.trim()}${partialJS ? `<script>${partialJS}<\/script>` : ''}</body></html>`;
  }
  if (previewFrame && html) renderPreview(html);

  const toggleBtn = document.getElementById('comp-toggle-source');
  const sourceWrap = document.getElementById('comp-source-wrap');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const visible = sourceWrap.style.display !== 'none';
      sourceWrap.style.display = visible ? 'none' : 'block';
      toggleBtn.textContent = visible ? 'Show Source' : 'Hide Source';
    });
  }

  const textarea = document.getElementById('comp-html');
  if (textarea) {
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }
    });
    textarea.addEventListener('input', () => renderPreview(textarea.value));
  }

  document.getElementById('partial-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const data = {
      name: f.name.value,
      mode: f.mode.value,
      weight: f.weight.value,
      scope: f.scope.value,
      isPattern: f.isPattern.value === 'true',
      html: f.html.value,
    };
    if (existing) {
      const { html: htmlContent, ...meta } = data;
      await api('PUT', '/partials/' + editId, meta);
      await fetch('/api/partials/' + editId + '/html', {
        method: 'PUT', body: htmlContent,
        headers: { 'Content-Type': 'text/html' },
      });
    } else {
      await api('POST', '/partials', data);
    }
    hideModal();
    await load();
  };
};

window.deletePartialAction = async function(id) {
  if (!confirm('Delete this partial?')) return;
  await api('DELETE', '/partials/' + id);
  await load();
};

// ── Version History ──

window.showHistory = async function(type, slug, title) {
  const snapshots = await api('GET', `/history/${type}/${slug}`);
  let h = `<h2>History: ${esc(title)}</h2>`;
  if (!snapshots.length) {
    h += '<p class="empty-state">No version history yet. History is created automatically when you save changes.</p>';
  } else {
    h += '<div class="history-list">';
    for (const s of snapshots) {
      const date = new Date(s.timestamp).toLocaleString();
      h += `<div class="history-item">
        <span class="history-date">${date}</span>
        <div class="history-actions">
          <button class="btn btn-sm" onclick="previewSnapshot('${type}','${esc(slug)}','${esc(s.id)}')">Preview</button>
          <button class="btn btn-sm btn-primary" onclick="restoreSnapshotAction('${type}','${esc(slug)}','${esc(s.id)}','${esc(title)}')">Restore</button>
        </div>
      </div>`;
    }
    h += '</div>';
  }
  h += `<div class="form-actions"><button class="btn" onclick="hideModal()">Close</button></div>`;
  showModal(h);
};

window.previewSnapshot = async function(type, slug, id) {
  const res = await fetch(`/api/history/${type}/${slug}/${id}`);
  const html = await res.text();
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
};

window.restoreSnapshotAction = async function(type, slug, id, title) {
  if (!confirm(`Restore this version of "${title}"? The current version will be saved to history first.`)) return;
  await api('POST', `/history/${type}/${slug}/${id}/restore`);
  hideModal();
  await load();
};

// ── Media View ──

function renderMedia() {
  let h = `<div class="view-header"><h1>Media</h1>
    <button class="btn btn-primary" onclick="uploadMedia()">+ Upload</button></div>`;

  if (!state.media.length) {
    return h + '<p class="empty-state">No media uploaded yet. Upload images to use across your site.</p>';
  }

  h += '<div class="media-grid">';
  for (const m of state.media) {
    const isImage = (m.mimeType || '').startsWith('image/');
    const sizeKB = m.size ? Math.round(m.size / 1024) : '?';
    h += `<div class="media-card">
      <div class="media-thumb">${isImage ? `<img src="${esc(m.path)}" alt="${esc(m.originalName)}" loading="lazy">` : '<span class="media-file-icon">&#128196;</span>'}</div>
      <div class="media-info">
        <span class="media-name" title="${esc(m.originalName)}">${esc(m.originalName)}</span>
        <span class="media-meta">${sizeKB} KB</span>
      </div>
      <div class="media-actions">
        <button class="btn btn-sm" onclick="copyMediaPath('${esc(m.path)}')">Copy Path</button>
        <button class="btn btn-sm btn-danger" onclick="deleteMediaItem('${m.id}')">Delete</button>
      </div>
    </div>`;
  }
  return h + '</div>';
}

window.uploadMedia = function() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.svg,.pdf';
  input.multiple = true;
  input.onchange = async () => {
    for (const file of input.files) {
      const form = new FormData();
      form.append('file', file);
      await fetch('/api/media/upload', { method: 'POST', body: form });
    }
    await load();
  };
  input.click();
};

window.copyMediaPath = function(path) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(path).then(() => {
      showToast('Path copied');
    }).catch(() => fallbackCopy(path));
  } else {
    fallbackCopy(path);
  }
};

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  showToast('Path copied');
}

function showToast(msg) {
  const existing = document.getElementById('sm-dash-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'sm-dash-toast';
  t.style.cssText = 'position:fixed;bottom:80px;right:24px;background:#065f46;color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;z-index:2000;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

window.deleteMediaItem = async function(id) {
  if (!confirm('Delete this media file?')) return;
  await api('DELETE', '/media/' + id);
  await load();
};

// ── Collections View ──

function renderCollections() {
  let h = `<div class="view-header"><h1>Collections</h1>
    <button class="btn btn-primary" onclick="showCollectionModal()">+ New Collection</button></div>`;

  if (!state.collections.length) {
    return h + '<p class="empty-state">No collections yet. Create one to manage structured content like blog posts, products, or events.</p>';
  }

  h += '<div class="card-grid">';
  for (const c of state.collections) {
    const fieldCount = (c.schema || []).length;
    h += `<div class="card">
      <h3>${esc(c.name)}</h3>
      <p class="card-meta">/${esc(c.slug)} &middot; ${fieldCount} field${fieldCount !== 1 ? 's' : ''}</p>
      <div class="card-actions">
        <button class="btn btn-sm btn-primary" onclick="openCollection('${c.id}')">Manage</button>
        <button class="btn btn-sm" onclick="showCollectionModal('${c.id}')">Edit</button>
        <button class="btn btn-sm" onclick="generateCollectionTemplates('${c.id}')">Generate Templates</button>
        <button class="btn btn-sm btn-danger" onclick="deleteCollectionAction('${c.id}')">Delete</button>
      </div>
    </div>`;
  }
  return h + '</div>';
}

window.showCollectionModal = function(editId) {
  const existing = editId ? state.collections.find(c => c.id === editId) : null;
  const schema = existing?.schema || [];

  let schemaRows = '';
  for (let i = 0; i < schema.length; i++) {
    const f = schema[i];
    schemaRows += `<div class="schema-row" data-idx="${i}">
      <input name="field_name_${i}" value="${esc(f.name)}" placeholder="Field name" required>
      <select name="field_type_${i}">
        ${['text','richtext','number','date','image','url','boolean'].map(t =>
          `<option value="${t}" ${f.type===t?'selected':''}>${t}</option>`
        ).join('')}
      </select>
      <label class="schema-check"><input type="checkbox" name="field_req_${i}" ${f.required?'checked':''}> Required</label>
      <button type="button" class="btn btn-sm btn-danger" onclick="this.closest('.schema-row').remove()">×</button>
    </div>`;
  }

  showModal(`<h2>${existing ? 'Edit Collection' : 'New Collection'}</h2>
    <form id="col-form">
      <div class="form-group"><label>Name</label>
        <input name="name" required value="${esc(existing?.name)}" placeholder="e.g. Blog Posts, Products, Events"></div>
      <div class="form-group"><label>Slug</label>
        <input name="slug" ${existing ? 'disabled' : ''} value="${esc(existing?.slug)}" pattern="[a-z0-9][a-z0-9-]*" placeholder="e.g. blog, products, events"></div>
      <div class="form-group">
        <div class="comp-source-header"><label>Schema Fields</label>
          <button type="button" class="btn btn-sm" id="add-field">+ Add Field</button>
        </div>
        <div id="schema-fields">${schemaRows}</div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Create'}</button>
      </div>
    </form>`);

  let fieldIndex = schema.length;
  document.getElementById('add-field').addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'schema-row';
    row.dataset.idx = fieldIndex;
    row.innerHTML = `
      <input name="field_name_${fieldIndex}" placeholder="Field name" required>
      <select name="field_type_${fieldIndex}">
        ${['text','richtext','number','date','image','url','boolean'].map(t =>
          `<option value="${t}">${t}</option>`
        ).join('')}
      </select>
      <label class="schema-check"><input type="checkbox" name="field_req_${fieldIndex}"> Required</label>
      <button type="button" class="btn btn-sm btn-danger" onclick="this.closest('.schema-row').remove()">×</button>`;
    document.getElementById('schema-fields').appendChild(row);
    fieldIndex++;
  });

  document.getElementById('col-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const fields = [];
    document.querySelectorAll('.schema-row').forEach(row => {
      const i = row.dataset.idx;
      const nameInput = f[`field_name_${i}`];
      if (!nameInput || !nameInput.value) return;
      fields.push({
        name: nameInput.value,
        type: f[`field_type_${i}`].value,
        required: !!f[`field_req_${i}`]?.checked,
      });
    });
    const data = { name: f.name.value, schema: fields };
    if (!existing) {
      data.slug = f.slug.value || f.name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    if (existing) await api('PUT', '/collections/' + editId, data);
    else await api('POST', '/collections', data);
    hideModal();
    await load();
  };
};

window.openCollection = function(id) {
  state.activeCollection = id;
  renderNav();
  render();
};

window.backToCollections = function() {
  state.activeCollection = null;
  renderNav();
  render();
};

window.generateCollectionTemplates = async function(id) {
  const col = state.collections.find(c => c.id === id);
  if (!col) return;
  if (!confirm(`Generate listing and detail templates for "${col.name}"? This will overwrite existing templates.`)) return;
  showLoading('Generating collection templates with AI…');
  try {
    await api('POST', '/collections/' + id + '/generate');
    hideLoading();
    alert('Templates generated! Visit /' + col.slug + ' to see the listing page.');
  } catch (err) {
    hideLoading();
    alert('Error: ' + err.message);
  }
};

window.deleteCollectionAction = async function(id) {
  if (!confirm('Delete this collection and all its entries?')) return;
  await api('DELETE', '/collections/' + id);
  await load();
};

// ── Entries View ──

function renderEntries() {
  const col = state.collections.find(c => c.id === state.activeCollection);
  if (!col) { state.activeCollection = null; return renderCollections(); }

  let h = `<div class="view-header">
    <div><button class="btn btn-sm" onclick="backToCollections()">&larr; Collections</button>
    <h1 style="display:inline;margin-left:12px">${esc(col.name)}</h1>
    <span class="card-meta" style="margin-left:8px">/${esc(col.slug)}</span></div>
    <button class="btn btn-primary" onclick="showEntryModal('${col.id}')">+ New Entry</button></div>`;

  h += '<div id="entries-list"><p class="card-meta">Loading entries…</p></div>';

  loadEntries(col);
  return h;
}

async function loadEntries(col) {
  const entries = await api('GET', '/collections/' + col.id + '/entries');
  const el = document.getElementById('entries-list');
  if (!el) return;

  if (!entries.length) {
    el.innerHTML = '<p class="empty-state">No entries yet. Add your first entry.</p>';
    return;
  }

  const titleField = col.schema.find(f => f.name === 'title') ? 'title' : col.schema[0]?.name;
  let h = `<table class="data-table"><thead><tr>
    <th>${esc(titleField || 'Entry')}</th><th>Slug</th><th>Updated</th><th></th>
  </tr></thead><tbody>`;
  for (const e of entries) {
    const label = titleField ? (e.data[titleField] || '(untitled)') : e.slug;
    h += `<tr>
      <td><strong>${esc(String(label))}</strong></td>
      <td class="card-meta">/${esc(col.slug)}/${esc(e.slug)}</td>
      <td class="card-meta">${new Date(e.updated).toLocaleDateString()}</td>
      <td style="text-align:right">
        <a href="/${esc(col.slug)}/${esc(e.slug)}" class="btn btn-sm" target="_blank">View</a>
        <button class="btn btn-sm" onclick="showEntryModal('${col.id}','${e.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteEntryAction('${col.id}','${e.id}')">Delete</button>
      </td>
    </tr>`;
  }
  el.innerHTML = h + '</tbody></table>';
}

window.showEntryModal = async function(colId, entryId) {
  const col = state.collections.find(c => c.id === colId);
  if (!col) return;
  let entry = null;
  if (entryId) {
    entry = await api('GET', '/collections/' + colId + '/entries/' + entryId);
  }

  let fieldsHTML = '';
  for (const f of col.schema) {
    const val = entry ? (entry.data[f.name] ?? '') : '';
    if (f.type === 'richtext') {
      fieldsHTML += `<div class="form-group"><label>${esc(f.name)}${f.required ? ' *' : ''}</label>
        <textarea name="data_${esc(f.name)}" rows="6" class="code-textarea" ${f.required ? 'required' : ''}>${esc(String(val))}</textarea></div>`;
    } else if (f.type === 'boolean') {
      fieldsHTML += `<div class="form-group"><label class="schema-check">
        <input type="checkbox" name="data_${esc(f.name)}" ${val ? 'checked' : ''}> ${esc(f.name)}</label></div>`;
    } else {
      const inputType = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : f.type === 'url' || f.type === 'image' ? 'url' : 'text';
      fieldsHTML += `<div class="form-group"><label>${esc(f.name)}${f.required ? ' *' : ''}</label>
        <input type="${inputType}" name="data_${esc(f.name)}" value="${esc(String(val))}" ${f.required ? 'required' : ''}></div>`;
    }
  }

  showModal(`<h2>${entry ? 'Edit Entry' : 'New Entry'}</h2>
    <form id="entry-form">
      <div class="form-group"><label>Slug</label>
        <input name="slug" value="${esc(entry?.slug || '')}" placeholder="auto-generated from title if blank" pattern="[a-z0-9][a-z0-9-]*"></div>
      ${fieldsHTML}
      <div class="form-actions">
        <button type="button" class="btn" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${entry ? 'Save' : 'Create'}</button>
      </div>
    </form>`);

  document.getElementById('entry-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const data = {};
    for (const field of col.schema) {
      const input = f[`data_${field.name}`];
      if (field.type === 'boolean') data[field.name] = !!input?.checked;
      else data[field.name] = input?.value || '';
    }
    const payload = { data };
    if (f.slug.value) payload.slug = f.slug.value;
    if (entry) await api('PUT', '/collections/' + colId + '/entries/' + entryId, payload);
    else await api('POST', '/collections/' + colId + '/entries', payload);
    hideModal();
    loadEntries(col);
  };
};

window.deleteEntryAction = async function(colId, entryId) {
  if (!confirm('Delete this entry?')) return;
  const col = state.collections.find(c => c.id === colId);
  await api('DELETE', '/collections/' + colId + '/entries/' + entryId);
  if (col) loadEntries(col);
};

// ── Modal ──

function showModal(html) {
  document.getElementById('modal').innerHTML = html;
  document.getElementById('modal-backdrop').classList.add('visible');
}

window.hideModal = function() {
  document.getElementById('modal-backdrop').classList.remove('visible');
};

document.getElementById('modal-backdrop').addEventListener('click', e => {
  if (e.target === e.currentTarget) hideModal();
});

// ── Loading ──

function showLoading(msg) {
  const el = document.createElement('div');
  el.className = 'loading-overlay';
  el.id = 'loading';
  el.innerHTML = `<div><span class="spinner"></span>${esc(msg || 'Loading…')}</div>`;
  document.body.appendChild(el);
}

function hideLoading() {
  document.getElementById('loading')?.remove();
}

// ── Dashboard Site Chat ──

(function initDashChat() {
  const fab = document.getElementById('dash-chat-fab');
  const panel = document.getElementById('dash-chat-panel');
  const msgContainer = document.getElementById('dash-chat-messages');
  const input = document.getElementById('dash-chat-input');
  const sendBtn = document.getElementById('dash-chat-send');
  const clearBtn = document.getElementById('dash-chat-clear');
  const closeBtn = document.getElementById('dash-chat-close');

  let open = false;

  function toggle() {
    open = !open;
    panel.classList.toggle('open', open);
    fab.classList.toggle('hidden', open);
    if (open) input.focus();
  }

  fab.addEventListener('click', toggle);
  closeBtn.addEventListener('click', toggle);

  function addMsg(role, text) {
    const div = document.createElement('div');
    div.className = `dash-chat-msg dash-chat-${role === 'assistant' ? 'ai' : role}`;
    div.textContent = text;
    msgContainer.appendChild(div);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    return div;
  }

  function showWelcome() {
    msgContainer.innerHTML = '';
    const w = document.createElement('div');
    w.className = 'dash-chat-msg dash-chat-ai';
    w.textContent = 'What would you like to do? I can create pages, collections, entries, or modify anything on your site.';
    msgContainer.appendChild(w);
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/chat/site');
      const messages = await res.json();
      if (!messages.length) { showWelcome(); return; }
      msgContainer.innerHTML = '';
      for (const msg of messages) addMsg(msg.role, msg.content);
    } catch { showWelcome(); }
  }

  async function clearHistory() {
    try { await fetch('/api/chat/site', { method: 'DELETE' }); } catch {}
    showWelcome();
  }

  clearBtn.addEventListener('click', clearHistory);

  async function send() {
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    sendBtn.disabled = true;
    addMsg('user', message);
    const loading = addMsg('ai', '...');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      loading.textContent = data.reply || 'Done.';

      const summaryParts = [];
      if (data.applied && data.applied.length) {
        summaryParts.push('Modified: ' + data.applied.join(', '));
      }
      if (data.actionResults && data.actionResults.length) {
        for (const a of data.actionResults) {
          summaryParts.push(`${a.action}: ${a.slug}`);
        }
      }
      if (summaryParts.length) {
        const details = document.createElement('div');
        details.className = 'dash-chat-actions-list';
        details.innerHTML = '<ul>' + summaryParts.map(s => `<li>${esc(s)}</li>`).join('') + '</ul>';
        loading.appendChild(details);
      }

      if (data.actionResults && data.actionResults.length) {
        await load();
      }
    } catch (err) {
      loading.textContent = 'Error: ' + err.message;
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  loadHistory();
})();

// ── Setup Banner ──

function setupBannerHTML() {
  if (state.user) return '';
  return `<div class="setup-banner"><strong>No users configured.</strong> Anyone on this network can access the dashboard. <a href="#" onclick="event.preventDefault();document.querySelector('[data-view=settings]').click()">Go to Settings</a> to add users.</div>`;
}

function renderSetupBanner() {}

// ── User Badge ──

function renderUserBadge() {
  const el = document.getElementById('sidebar-user');
  if (!el) return;
  if (!state.user) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="user-badge"><strong>${esc(state.user.displayName)}</strong> <span class="tag tag-${state.user.role === 'admin' ? 'rule' : 'guide'}">${state.user.role}</span></span>`;
}

// ── Settings View ──

function renderSettings() {
  const isAdmin = state.user && state.user.role === 'admin';
  const noUsers = !state.user;

  let h = '<div class="view-header"><h1>Settings</h1></div>';
  h += '<div class="settings-panels">';

  if (isAdmin || noUsers) {
    h += `<div class="settings-panel">
      <h2>Users</h2>
      <div class="view-header" style="margin-bottom:16px"><div></div>
        <button class="btn btn-primary" onclick="showCreateUserModal()">+ Add User</button></div>
      <div id="users-list"><p class="card-meta">Loading…</p></div>
    </div>`;
  }

  if (state.user) {
    h += `<div class="settings-panel">
      <h2>Profile</h2>
      <form id="profile-form">
        <div class="form-group"><label>Display Name</label>
          <input name="displayName" value="${esc(state.user.displayName || '')}" required></div>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Save</button></div>
      </form>
    </div>`;

    h += `<div class="settings-panel">
      <h2>Change Password</h2>
      <form id="password-form">
        <div class="form-group"><label>Current Password</label>
          <input type="password" name="current" required autocomplete="current-password"></div>
        <div class="form-group"><label>New Password</label>
          <input type="password" name="password" required minlength="6" autocomplete="new-password"></div>
        <div class="form-group"><label>Confirm New Password</label>
          <input type="password" name="confirm" required autocomplete="new-password"></div>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Change Password</button></div>
      </form>
    </div>`;
  }

  h += '</div>';
  return h;
}

function initSettings() {
  const profileForm = document.getElementById('profile-form');
  if (profileForm) {
    profileForm.onsubmit = async e => {
      e.preventDefault();
      const displayName = profileForm.displayName.value.trim();
      if (!displayName) return;
      try {
        await api('PUT', '/users/' + state.user.id, { displayName });
        state.user.displayName = displayName;
        renderUserBadge();
        showToast('Profile updated');
      } catch (err) { alert(err.message); }
    };
  }

  const pwForm = document.getElementById('password-form');
  if (pwForm) {
    pwForm.onsubmit = async e => {
      e.preventDefault();
      const current = pwForm.current.value;
      const password = pwForm.password.value;
      const confirm = pwForm.confirm.value;
      if (password !== confirm) { alert('Passwords do not match'); return; }
      if (password.length < 6) { alert('Password must be at least 6 characters'); return; }
      try {
        const res = await fetch('/api/auth/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current, password }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Failed'); return; }
        pwForm.reset();
        showToast('Password changed');
      } catch (err) { alert(err.message); }
    };
  }

  if (state.user?.role === 'admin' || !state.user) loadUsersList();
}

async function loadUsersList() {
  const el = document.getElementById('users-list');
  if (!el) return;
  try {
    const users = await api('GET', '/users').catch(() => []);
    if (!users.length) { el.innerHTML = '<p class="empty-state">No users yet. Add your first user to enable authentication.</p>'; return; }
    let h = `<table class="data-table"><thead><tr>
      <th>Username</th><th>Display Name</th><th>Role</th><th>Last Login</th><th></th>
    </tr></thead><tbody>`;
    for (const u of users) {
      const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'Never';
      const isSelf = u.id === state.user?.id;
      h += `<tr>
        <td><strong>${esc(u.username)}</strong>${isSelf ? ' <span class="card-meta">(you)</span>' : ''}</td>
        <td>${esc(u.displayName)}</td>
        <td><span class="tag tag-${u.role === 'admin' ? 'rule' : 'guide'}">${u.role}</span></td>
        <td class="card-meta">${lastLogin}</td>
        <td style="text-align:right">
          ${!isSelf ? `<button class="btn btn-sm" onclick="showEditUserModal('${u.id}','${esc(u.username)}','${esc(u.displayName)}','${u.role}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteUserAction('${u.id}','${esc(u.username)}')">Delete</button>` : ''}
        </td>
      </tr>`;
    }
    el.innerHTML = h + '</tbody></table>';
  } catch (err) {
    el.innerHTML = `<p class="card-meta" style="color:#dc2626">${esc(err.message)}</p>`;
  }
}

window.showCreateUserModal = function() {
  const isFirstUser = !state.user;
  const defaultRole = isFirstUser ? 'admin' : 'editor';
  showModal(`<h2>Add User</h2>
    <form id="create-user-form">
      <div class="form-group"><label>Username</label>
        <input name="username" required minlength="2" placeholder="e.g. sarah"></div>
      <div class="form-group"><label>Display Name</label>
        <input name="displayName" placeholder="e.g. Sarah Chen"></div>
      <div class="form-group"><label>Password</label>
        <input type="password" name="password" required minlength="6" autocomplete="new-password"></div>
      <div class="form-group"><label>Role</label>
        <select name="role">
          <option value="editor" ${defaultRole === 'editor' ? 'selected' : ''}>Editor — can manage all content</option>
          <option value="admin" ${defaultRole === 'admin' ? 'selected' : ''}>Admin — full access including user management</option>
        </select></div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create User</button>
      </div>
    </form>`);
  document.getElementById('create-user-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const username = f.username.value.trim();
    const password = f.password.value;
    try {
      await api('POST', '/users', {
        username,
        displayName: f.displayName.value.trim() || username,
        password,
        role: f.role.value,
      });
      if (isFirstUser) {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (res.ok) {
          hideModal();
          await load();
          return;
        }
      }
      hideModal();
      loadUsersList();
    } catch (err) { alert(err.message); }
  };
};

window.showEditUserModal = function(id, username, displayName, role) {
  showModal(`<h2>Edit User: ${esc(username)}</h2>
    <form id="edit-user-form">
      <div class="form-group"><label>Display Name</label>
        <input name="displayName" value="${esc(displayName)}" required></div>
      <div class="form-group"><label>Role</label>
        <select name="role">
          <option value="editor" ${role === 'editor' ? 'selected' : ''}>Editor</option>
          <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
        </select></div>
      <div class="form-actions">
        <button type="button" class="btn" onclick="hideModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);
  document.getElementById('edit-user-form').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('PUT', '/users/' + id, {
        displayName: f.displayName.value.trim(),
        role: f.role.value,
      });
      hideModal();
      loadUsersList();
    } catch (err) { alert(err.message); }
  };
};

window.deleteUserAction = async function(id, username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  try {
    await api('DELETE', '/users/' + id);
    loadUsersList();
  } catch (err) { alert(err.message); }
};

// ── Logout ──

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = '/login';
});

// ── Init ──

load();
