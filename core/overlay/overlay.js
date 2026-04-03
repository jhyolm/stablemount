(function() {
  if (!window.__SM__) return;
  const { slug, title } = window.__SM__;

  let activeEl = null;
  let dirty = false;
  let toolbar = null;
  let chatOpen = false;
  let selectedSection = null;
  let contentIdCounter = 0;

  // ── Helpers ──

  function esc(s) {
    const d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'sm-toast';
    t.setAttribute('data-sm-overlay', '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function getChatHTML() {
    let html = getCleanHTML();
    html = html.replace(/<!-- @partial:([\w][\w-]*):begin -->[\s\S]*?<!-- @partial:\1:end -->/g, '<!-- @partial:$1 -->');
    html = html.replace(/<style data-partials>[\s\S]*?<\/style>\n?/g, '');
    html = html.replace(/<script data-partials>[\s\S]*?<\/script>\n?/g, '');
    html = html.replace(/<!-- @collection:([\w-]+):begin[^>]*-->\s*<!-- @collection-template:\1\n([\s\S]*?)-->\s*[\s\S]*?<!-- @collection:\1:end -->/g,
      (_, slug, preserved) => preserved.trim());
    return html;
  }

  function getCleanHTML() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-sm-overlay]').forEach(n => n.remove());
    clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
    clone.querySelectorAll('.sm-editing').forEach(n => n.classList.remove('sm-editing'));
    clone.querySelectorAll('.sm-selected').forEach(n => n.classList.remove('sm-selected'));
    clone.querySelectorAll('.sm-body-offset').forEach(n => n.classList.remove('sm-body-offset'));
    clone.querySelectorAll('[data-section], [data-partial]').forEach(n => {
      if (n.style.position === 'relative') n.style.removeProperty('position');
      if (!n.getAttribute('style')) n.removeAttribute('style');
    });
    clone.querySelectorAll('*').forEach(n => {
      if (n.style && n.style.top && n.closest('[data-sm-overlay]') === null) {
        const orig = n.getAttribute('data-sm-orig-top');
        if (orig !== null) { n.style.top = orig; n.removeAttribute('data-sm-orig-top'); }
      }
    });
    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function markDirty() {
    dirty = true;
    saveBtn.disabled = false;
    statusEl.innerHTML = '<span class="sm-badge">unsaved</span>';
  }

  // ── Top bar ──

  const topbar = document.createElement('div');
  topbar.className = 'sm-topbar';
  topbar.setAttribute('data-sm-overlay', '');
  topbar.innerHTML = `
    <div class="sm-topbar-left">
      <a href="/dashboard">&#9670; Dashboard</a>
      <span class="sm-topbar-title">Editing: <strong>${esc(title)}</strong></span>
    </div>
    <div class="sm-topbar-right">
      <span id="sm-status"></span>
      <button class="sm-btn sm-btn-save" id="sm-save" disabled>Save</button>
      <button class="sm-btn sm-btn-ai" id="sm-ai-toggle">AI</button>
      <button class="sm-btn sm-btn-images" id="sm-images-toggle">IMG</button>
      <button class="sm-btn sm-btn-site" id="sm-site-toggle">SITE</button>
    </div>`;
  document.body.prepend(topbar);
  document.body.classList.add('sm-body-offset');

  const saveBtn = document.getElementById('sm-save');
  const statusEl = document.getElementById('sm-status');

  // ── Toolbar ──

  function createToolbar() {
    const tb = document.createElement('div');
    tb.className = 'sm-toolbar';
    tb.setAttribute('data-sm-overlay', '');
    tb.innerHTML = `
      <button class="sm-toolbar-btn" data-cmd="bold" title="Bold"><b>B</b></button>
      <button class="sm-toolbar-btn" data-cmd="italic" title="Italic"><i>I</i></button>
      <button class="sm-toolbar-btn" data-cmd="createLink" title="Link">&#128279;</button>
      <div class="sm-toolbar-sep"></div>
      <select data-heading title="Heading level">
        <option value="">H</option>
        <option value="H1">H1</option>
        <option value="H2">H2</option>
        <option value="H3">H3</option>
        <option value="H4">H4</option>
        <option value="H5">H5</option>
        <option value="H6">H6</option>
        <option value="P">P</option>
      </select>
      <div class="sm-toolbar-sep"></div>
      <button class="sm-toolbar-btn" data-cmd="insertUnorderedList" title="Bullet list">&#8226;</button>
      <button class="sm-toolbar-btn" data-cmd="insertOrderedList" title="Numbered list">1.</button>`;
    tb.style.display = 'none';
    document.body.appendChild(tb);

    tb.addEventListener('mousedown', e => {
      e.preventDefault();
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = prompt('Enter URL:');
        if (url) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      markDirty();
    });

    tb.querySelector('[data-heading]').addEventListener('change', e => {
      const val = e.target.value;
      if (!val || !activeEl) return;
      const newEl = document.createElement(val);
      for (const attr of activeEl.attributes) {
        newEl.setAttribute(attr.name, attr.value);
      }
      newEl.innerHTML = activeEl.innerHTML;
      activeEl.replaceWith(newEl);
      activeEl = newEl;
      newEl.setAttribute('contenteditable', 'true');
      newEl.classList.add('sm-editing');
      newEl.focus();
      positionToolbar(newEl);
      markDirty();
      e.target.value = '';
    });

    return tb;
  }

  toolbar = createToolbar();

  function positionToolbar(el) {
    const rect = el.getBoundingClientRect();
    toolbar.style.display = 'flex';
    toolbar.style.top = Math.max(50, rect.top - 40) + 'px';
    toolbar.style.left = Math.max(8, rect.left) + 'px';
  }

  function hideToolbar() { toolbar.style.display = 'none'; }

  // ── Activation ──

  function activate(el) {
    if (activeEl === el) return;
    deactivate();
    activeEl = el;
    el.setAttribute('contenteditable', 'true');
    el.classList.add('sm-editing');
    el.focus();
    positionToolbar(el);
  }

  function deactivate() {
    if (!activeEl) return;
    activeEl.removeAttribute('contenteditable');
    activeEl.classList.remove('sm-editing');
    activeEl = null;
    hideToolbar();
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-sm-overlay]')) return;
    const content = e.target.closest('[data-content]');
    if (content && !content.closest('[data-partial]')) {
      deselectSection();
      activate(content);
      return;
    }
    const section = e.target.closest('[data-section], [data-partial]');
    if (section && !section.closest('[data-sm-overlay]')) {
      deactivate();
      selectSection(section);
      return;
    }
    deactivate();
    deselectSection();
  });

  document.addEventListener('paste', e => {
    if (!e.target.closest('[data-content]')) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    markDirty();
  });

  document.addEventListener('input', e => {
    if (e.target.closest('[data-content]')) markDirty();
  });

  document.addEventListener('scroll', () => {
    if (activeEl) positionToolbar(activeEl);
  }, { passive: true });

  // ── Content insertion (Enter / Backspace) ──

  function genContentId() {
    return 'c-' + Date.now().toString(36) + '-' + (++contentIdCounter);
  }

  document.addEventListener('keydown', e => {
    if (!activeEl || !activeEl.hasAttribute('data-content')) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);

      const afterRange = document.createRange();
      afterRange.selectNodeContents(activeEl);
      afterRange.setStart(range.endContainer, range.endOffset);
      const afterContent = afterRange.extractContents();

      const newEl = document.createElement('p');
      newEl.setAttribute('data-content', genContentId());

      if (afterContent.textContent.trim() || afterContent.querySelector('*')) {
        newEl.appendChild(afterContent);
      } else {
        newEl.innerHTML = '<br>';
      }

      activeEl.insertAdjacentElement('afterend', newEl);
      activate(newEl);

      const newRange = document.createRange();
      newRange.selectNodeContents(newEl);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      markDirty();
      return;
    }

    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (!sel.rangeCount || !sel.isCollapsed) return;
      const range = sel.getRangeAt(0);

      const atStart = range.startOffset === 0 &&
        (range.startContainer === activeEl || range.startContainer === activeEl.firstChild);

      if (!atStart) return;

      const prev = activeEl.previousElementSibling;
      if (!prev || !prev.hasAttribute('data-content')) return;

      e.preventDefault();

      const marker = document.createTextNode('\u200B');
      prev.appendChild(marker);

      while (activeEl.firstChild) {
        if (activeEl.firstChild.nodeName === 'BR' && activeEl.childNodes.length === 1) break;
        prev.appendChild(activeEl.firstChild);
      }

      activeEl.remove();
      activate(prev);

      const newRange = document.createRange();
      newRange.setStartAfter(marker);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);

      requestAnimationFrame(() => marker.remove());
      markDirty();
    }
  });

  // ── Section selection & contextual AI ──

  function selectSection(el) {
    deselectSection();
    selectedSection = el;
    el.classList.add('sm-selected');
    const name = el.getAttribute('data-section') || el.getAttribute('data-partial') || 'element';
    contextLabel.textContent = name;
    contextBar.style.display = 'flex';
    contextPrompt.value = '';
    contextPrompt.focus();
  }

  function deselectSection() {
    if (!selectedSection) return;
    selectedSection.classList.remove('sm-selected');
    selectedSection = null;
    contextBar.style.display = 'none';
  }

  function getCleanSectionHTML(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('[data-sm-overlay]').forEach(n => n.remove());
    clone.querySelectorAll('[contenteditable]').forEach(n => n.removeAttribute('contenteditable'));
    clone.classList.remove('sm-selected', 'sm-editing');
    return clone.outerHTML;
  }

  async function sendContextualPrompt() {
    const message = contextPrompt.value.trim();
    if (!message || !selectedSection) return;

    const name = selectedSection.getAttribute('data-section') || selectedSection.getAttribute('data-partial') || 'element';
    const sectionHTML = getCleanSectionHTML(selectedSection);

    contextPrompt.value = '';
    contextSendBtn.disabled = true;
    contextSendBtn.textContent = '...';

    addChatMessage('user', message);
    addChatMessage('ai', '...');
    const loadingMsg = chatMessages.lastChild;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          slug,
          html: getChatHTML(),
          selection: { name, html: sectionHTML },
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || `Server error (${res.status})`);
      }
      const data = await res.json();
      loadingMsg.textContent = data.reply || 'Done.';

      if (data.html) {
        applyNewHTML(data.html);
        const others = (data.applied || []).filter(f => !f.startsWith('pages/'));
        if (others.length) {
          toast('Updated: section + ' + others.join(', '));
        } else {
          toast('Section updated by AI');
        }
      } else {
        deselectSection();
        if (data.applied && data.applied.length) {
          toast('Updated: ' + data.applied.join(', '));
        }
      }

      if (data.actionResults && data.actionResults.length) {
        const summary = data.actionResults.map(a => `${a.action}: ${a.slug}`).join(', ');
        toast('Actions: ' + summary);
      }
    } catch (err) {
      loadingMsg.textContent = 'Error: ' + err.message;
    } finally {
      contextSendBtn.disabled = false;
      contextSendBtn.textContent = 'Go';
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && selectedSection) {
      deselectSection();
    }
  });

  // ── Chat Panel ──

  const chatPanel = document.createElement('div');
  chatPanel.className = 'sm-chat';
  chatPanel.setAttribute('data-sm-overlay', '');
  chatPanel.innerHTML = `
    <div class="sm-chat-header">
      <span>AI Chat</span>
      <div class="sm-chat-header-actions">
        <span class="sm-model-label" id="sm-model-label"></span>
        <button class="sm-chat-clear" id="sm-chat-clear" title="Clear history">Clear</button>
        <button class="sm-chat-close" id="sm-chat-close">&times;</button>
      </div>
    </div>
    <div class="sm-chat-messages" id="sm-chat-messages"></div>
    <div class="sm-chat-input">
      <textarea id="sm-chat-input" placeholder="e.g. Make the hero section darker, add a testimonials section..." rows="2"></textarea>
      <button class="sm-btn sm-btn-send" id="sm-chat-send">Send</button>
    </div>`;
  document.body.appendChild(chatPanel);

  const chatMessages = document.getElementById('sm-chat-messages');
  const chatInput = document.getElementById('sm-chat-input');
  const chatSendBtn = document.getElementById('sm-chat-send');
  const modelLabel = document.getElementById('sm-model-label');

  // ── Context bar (for section-level AI prompts) ──

  const contextBar = document.createElement('div');
  contextBar.className = 'sm-context-bar';
  contextBar.setAttribute('data-sm-overlay', '');
  contextBar.style.display = 'none';
  contextBar.innerHTML = `
    <span class="sm-context-label" id="sm-context-label"></span>
    <input type="text" class="sm-context-prompt" id="sm-context-prompt" placeholder="What should change here?">
    <button class="sm-btn sm-btn-send sm-context-send" id="sm-context-send">Go</button>
    <button class="sm-btn sm-btn-save-component" id="sm-save-component" title="Save as component">Save as Component</button>
    <button class="sm-context-dismiss" id="sm-context-dismiss">&times;</button>`;
  document.body.appendChild(contextBar);

  const contextLabel = document.getElementById('sm-context-label');
  const contextPrompt = document.getElementById('sm-context-prompt');
  const contextSendBtn = document.getElementById('sm-context-send');

  document.getElementById('sm-context-dismiss').addEventListener('click', deselectSection);
  contextSendBtn.addEventListener('click', sendContextualPrompt);
  contextPrompt.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendContextualPrompt();
    }
  });

  document.getElementById('sm-save-component').addEventListener('click', () => {
    if (!selectedSection) return;
    const sectionName = selectedSection.dataset.section || selectedSection.dataset.partial || 'component';
    const html = selectedSection.outerHTML;
    const name = prompt('Component name:', sectionName);
    if (!name) return;
    const isPattern = confirm('Save as pattern? (OK = Pattern for AI reference, Cancel = Partial for server injection)');
    fetch('/api/partials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, html, isPattern, mode: 'global' }),
    }).then(res => {
      if (res.ok) {
        const msg = isPattern ? 'Saved as pattern component' : 'Saved as partial component';
        addChatMessage('system', `${msg}: "${name}"`);
        toast(msg);
      } else {
        toast('Failed to save component');
      }
    }).catch(() => toast('Failed to save component'));
  });

  (async function loadModel() {
    try {
      const res = await fetch('/api/ai/model');
      const data = await res.json();
      const short = data.current.replace(/^claude-/, '').replace(/-\d{8}$/, '');
      modelLabel.textContent = short;
    } catch {}
  })();

  function toggleChat() {
    chatOpen = !chatOpen;
    chatPanel.classList.toggle('open', chatOpen);
    document.getElementById('sm-ai-toggle').classList.toggle('active', chatOpen);
    if (chatOpen) chatInput.focus();
  }

  document.getElementById('sm-ai-toggle').addEventListener('click', toggleChat);
  document.getElementById('sm-chat-close').addEventListener('click', toggleChat);

  // ── Image Panel ──

  let imagePanelOpen = false;
  const imagePanel = document.createElement('div');
  imagePanel.className = 'sm-image-panel';
  imagePanel.setAttribute('data-sm-overlay', '');
  imagePanel.innerHTML = `
    <div class="sm-image-panel-header">
      <span>Page Images</span>
      <button class="sm-image-panel-close" id="sm-images-close">&times;</button>
    </div>
    <div class="sm-image-panel-list" id="sm-image-list"></div>`;
  document.body.appendChild(imagePanel);

  const imageListEl = document.getElementById('sm-image-list');

  const imageHighlight = document.createElement('div');
  imageHighlight.className = 'sm-image-highlight';
  imageHighlight.setAttribute('data-sm-overlay', '');
  document.body.appendChild(imageHighlight);

  function toggleImagePanel() {
    imagePanelOpen = !imagePanelOpen;
    imagePanel.classList.toggle('open', imagePanelOpen);
    document.getElementById('sm-images-toggle').classList.toggle('active', imagePanelOpen);
    if (imagePanelOpen) scanPageImages();
  }

  document.getElementById('sm-images-toggle').addEventListener('click', toggleImagePanel);
  document.getElementById('sm-images-close').addEventListener('click', toggleImagePanel);

  function scanPageImages() {
    const items = [];
    const seen = new WeakSet();
    const bgCandidates = 'img, [data-section], [data-partial], section, header, footer, [class*="hero"], [class*="banner"], [style*="background"]';

    document.querySelectorAll(bgCandidates).forEach(el => {
      if (el.closest('[data-sm-overlay]') || seen.has(el)) return;
      seen.add(el);
      if (el.tagName === 'IMG') {
        const src = el.getAttribute('src') || '';
        if (!src) return;
        items.push({ type: 'img', src, element: el, label: el.alt || el.closest('[data-section]')?.dataset.section || 'image' });
      } else {
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none' || !bg.includes('url(')) return;
        const urlMatch = bg.match(/url\(["']?([^"')]+)["']?\)/);
        const src = urlMatch ? urlMatch[1] : bg;
        items.push({ type: 'bg', src, element: el, label: el.dataset.section || el.dataset.partial || el.tagName.toLowerCase() + ' background' });
      }
    });

    imageListEl.innerHTML = '';

    if (!items.length) {
      imageListEl.innerHTML = '<div class="sm-image-empty">No images found on this page.</div>';
      return;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'sm-image-row';

      const thumb = document.createElement('div');
      thumb.className = 'sm-image-thumb';
      if (item.type === 'bg') {
        thumb.style.backgroundImage = `url('${item.src}')`;
      } else {
        const tImg = document.createElement('img');
        tImg.src = item.src;
        thumb.appendChild(tImg);
      }

      const info = document.createElement('div');
      info.className = 'sm-image-info';

      const nameEl = document.createElement('div');
      nameEl.className = 'sm-image-name';
      nameEl.textContent = item.label;

      const srcEl = document.createElement('div');
      srcEl.className = 'sm-image-src';
      const shortSrc = item.src.length > 40 ? '…' + item.src.slice(-38) : item.src;
      srcEl.textContent = (item.type === 'bg' ? 'BG: ' : '') + shortSrc;

      const replaceBtn = document.createElement('button');
      replaceBtn.className = 'sm-btn sm-image-replace';
      replaceBtn.textContent = 'Replace';

      replaceBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        uploadAndReplace(path => {
          if (item.type === 'img') {
            item.element.src = path;
          } else {
            item.element.style.backgroundImage = `url('${path}')`;
          }
          item.src = path;
          srcEl.textContent = (item.type === 'bg' ? 'BG: ' : '') + path;
          if (thumb.querySelector('img')) thumb.querySelector('img').src = path;
          else thumb.style.backgroundImage = `url('${path}')`;
        });
      });

      row.addEventListener('mouseenter', () => {
        const rect = item.element.getBoundingClientRect();
        imageHighlight.style.display = 'block';
        imageHighlight.style.top = rect.top + 'px';
        imageHighlight.style.left = rect.left + 'px';
        imageHighlight.style.width = rect.width + 'px';
        imageHighlight.style.height = rect.height + 'px';
        item.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      row.addEventListener('mouseleave', () => {
        imageHighlight.style.display = 'none';
      });

      info.appendChild(nameEl);
      info.appendChild(srcEl);
      row.appendChild(thumb);
      row.appendChild(info);
      row.appendChild(replaceBtn);
      imageListEl.appendChild(row);
    }
  }

  // ── Site Panel (Decisions / Collections / Media) ──

  let sitePanelOpen = false;
  let sitePanelTab = 'decisions';
  const sitePanel = document.createElement('div');
  sitePanel.className = 'sm-site-panel';
  sitePanel.setAttribute('data-sm-overlay', '');
  sitePanel.innerHTML = `
    <div class="sm-site-panel-header">
      <div class="sm-site-tabs">
        <button class="sm-site-tab active" data-site-tab="decisions">Decisions</button>
        <button class="sm-site-tab" data-site-tab="components">Components</button>
        <button class="sm-site-tab" data-site-tab="media">Media</button>
      </div>
      <button class="sm-site-panel-close" id="sm-site-close">&times;</button>
    </div>
    <div class="sm-site-panel-body" id="sm-site-body"></div>`;
  document.body.appendChild(sitePanel);

  const siteBody = document.getElementById('sm-site-body');

  sitePanel.querySelectorAll('.sm-site-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      sitePanel.querySelectorAll('.sm-site-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      sitePanelTab = tab.dataset.siteTab;
      loadSiteTab();
    });
  });

  function toggleSitePanel() {
    sitePanelOpen = !sitePanelOpen;
    sitePanel.classList.toggle('open', sitePanelOpen);
    document.getElementById('sm-site-toggle').classList.toggle('active', sitePanelOpen);
    if (sitePanelOpen) {
      loadSiteTab();
    } else {
      sitePanel.classList.remove('sm-site-wide');
    }
  }

  document.getElementById('sm-site-toggle').addEventListener('click', toggleSitePanel);
  document.getElementById('sm-site-close').addEventListener('click', toggleSitePanel);

  function loadSiteTab() {
    sitePanel.classList.toggle('sm-site-wide', sitePanelTab === 'components');
    if (sitePanelTab === 'decisions') loadDecisionsTab();
    else if (sitePanelTab === 'components') loadComponentsTab();
    else if (sitePanelTab === 'media') loadMediaTab();
  }

  // ── Shared UI access (lazy - module may still be loading at parse time) ──

  function UI() { return window.__SM_UI__ || {}; }

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // ── Decisions Tab ──

  async function loadDecisionsTab() {
    siteBody.innerHTML = '<div class="sm-site-loading">Loading…</div>';
    try {
      const res = await fetch('/api/decisions');
      if (!res.ok) throw new Error('Failed to load');
      const decisions = await res.json();
      renderDecisions(decisions);
    } catch (err) {
      siteBody.innerHTML = `<div class="sm-site-empty">Error: ${err.message}</div>`;
    }
  }

  function renderDecisions(decisions) {
    if (!decisions.length) {
      siteBody.innerHTML = `
        <div class="sm-site-empty">No decisions yet.</div>
        <div class="sm-site-actions"><button class="sm-btn sm-site-add-btn" id="sm-add-decision">+ Add Decision</button></div>`;
      document.getElementById('sm-add-decision').addEventListener('click', showAddDecision);
      return;
    }

    const grouped = {};
    for (const d of decisions) {
      const k = d.kind || 'other';
      (grouped[k] = grouped[k] || []).push(d);
    }

    let html = '<div class="sm-site-actions"><button class="sm-btn sm-site-add-btn" id="sm-add-decision">+ Add</button></div>';
    for (const [kind, items] of Object.entries(grouped)) {
      html += `<div class="sm-decision-group"><div class="sm-decision-group-label">${esc(kind)}</div>`;
      for (const d of items) {
        html += (UI().renderDecisionRow || renderDecisionRowFallback)(d);
      }
      html += '</div>';
    }
    siteBody.innerHTML = html;

    document.getElementById('sm-add-decision').addEventListener('click', showAddDecision);
    wireDecisionRows(siteBody);
  }

  function renderDecisionRowFallback(d) {
    const isColor = d.kind === 'token' && /^(#[0-9a-f]{3,8}|rgb|hsl)/i.test(d.content);
    return `<div class="sm-dec-row" data-dec-id="${esc(d.id)}">
      <div class="sm-dec-main">
        ${isColor ? `<span class="sm-dec-swatch" style="background:${esc(d.content)}"></span>` : ''}
        <span class="sm-dec-name">${esc(d.name)}</span>
        <span class="sm-dec-kind">${esc(d.kind)}</span>
        <span class="sm-dec-weight">${esc(d.weight)}</span>
      </div>
      <input class="sm-dec-input" value="${esc(d.content)}" data-field="content">
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

  function wireDecisionRows(container) {
    container.querySelectorAll('.sm-dec-row').forEach(row => {
      const id = row.dataset.decId;

      const input = row.querySelector('.sm-dec-input');
      if (input) input.addEventListener('change', async (e) => {
        const val = e.target.value;
        await saveDecision(id, { content: val });
        const swatch = row.querySelector('.sm-dec-swatch');
        if (swatch) swatch.style.background = val;
        applyDecisionLive(row.querySelector('.sm-dec-name').textContent, val);
      });

      row.querySelectorAll('.sm-dec-select').forEach(sel => {
        sel.addEventListener('change', () => saveDecision(id, { [sel.dataset.field]: sel.value }));
      });

      const del = row.querySelector('.sm-dec-delete');
      if (del) del.addEventListener('click', async () => {
        await fetch(`/api/decisions/${id}`, { method: 'DELETE' });
        row.remove();
        toast('Decision deleted');
      });
    });
  }

  async function saveDecision(id, updates) {
    try {
      await fetch(`/api/decisions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      toast('Decision saved');
    } catch { toast('Save failed'); }
  }

  function applyDecisionLive(name, value) {
    if (!name.startsWith('color-') && !name.startsWith('font-')) return;
    document.documentElement.style.setProperty('--sm-' + name, value);
  }

  function showAddDecision() {
    const modal = document.createElement('div');
    modal.className = 'sm-site-modal';
    modal.setAttribute('data-sm-overlay', '');
    modal.innerHTML = `
      <div class="sm-site-modal-box">
        <h3>New Decision</h3>
        <label>Name<input type="text" id="sm-new-dec-name" placeholder="e.g. color-primary"></label>
        <label>Kind<select id="sm-new-dec-kind">
          <option value="token">token</option>
          <option value="instruction">instruction</option>
          <option value="asset">asset</option>
        </select></label>
        <label>Content<input type="text" id="sm-new-dec-content" placeholder="e.g. #3b82f6"></label>
        <label>Weight<select id="sm-new-dec-weight">
          <option value="guide">guide</option>
          <option value="rule">rule</option>
          <option value="absolute">absolute</option>
        </select></label>
        <div class="sm-site-modal-actions">
          <button class="sm-btn" id="sm-new-dec-save">Create</button>
          <button class="sm-btn sm-btn-cancel" id="sm-new-dec-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#sm-new-dec-name').focus();
    modal.querySelector('#sm-new-dec-cancel').addEventListener('click', () => modal.remove());
    modal.querySelector('#sm-new-dec-save').addEventListener('click', async () => {
      const name = modal.querySelector('#sm-new-dec-name').value.trim();
      const kind = modal.querySelector('#sm-new-dec-kind').value;
      const content = modal.querySelector('#sm-new-dec-content').value.trim();
      const weight = modal.querySelector('#sm-new-dec-weight').value;
      if (!name) { toast('Name required'); return; }
      try {
        await fetch('/api/decisions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, kind, content, weight, scope: 'global' }),
        });
        modal.remove();
        loadDecisionsTab();
        toast('Decision created');
      } catch { toast('Failed to create'); }
    });
  }

  // ── Components Tab ──

  function getPagePartialSlugs() {
    const slugs = new Set();
    document.querySelectorAll('[data-partial]').forEach(el => {
      if (!el.closest('[data-sm-overlay]')) slugs.add(el.getAttribute('data-partial'));
    });
    if (!slugs.size) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
      while (walker.nextNode()) {
        const m = walker.currentNode.nodeValue.match(/@partial:([\w][\w-]*):begin/);
        if (m) slugs.add(m[1]);
      }
    }
    return slugs;
  }

  async function loadComponentsTab() {
    siteBody.innerHTML = '<div class="sm-site-loading">Loading…</div>';
    try {
      const res = await fetch('/api/partials');
      if (!res.ok) throw new Error('Failed to load');
      const partials = await res.json();
      renderComponents(partials);
    } catch (err) {
      siteBody.innerHTML = `<div class="sm-site-empty">Error: ${err.message}</div>`;
    }
  }

  async function renderComponents(partials) {
    const usedOnPage = getPagePartialSlugs();

    if (!partials.length) {
      siteBody.innerHTML = '<div class="sm-site-empty">No components yet. Select a section on the page and click "Save as Component" to create one.</div>';
      return;
    }

    const siteCSS = await (UI().fetchSiteCSS || (async () => ''))();

    let html = '<div class="sm-component-grid">';
    for (const p of partials) {
      const isUsed = usedOnPage.has(p.name);
      html += (UI().renderComponentCard || renderComponentCardFallback)(p, { isUsed, showFind: true });
    }
    html += '</div>';
    siteBody.innerHTML = html;

    const mountPreview = UI().mountComponentPreview || null;
    for (const p of partials) {
      const previewEl = siteBody.querySelector(`[data-comp-preview="${p.id}"]`);
      if (!previewEl) continue;
      if (mountPreview) {
        await mountPreview(previewEl, p.id, siteCSS);
      }
    }

    siteBody.querySelectorAll('.sm-comp-card').forEach(card => {
      const compName = card.dataset.compName;
      const compId = card.dataset.compId;

      const findBtn = card.querySelector('.sm-comp-find');
      if (findBtn) findBtn.addEventListener('click', () => {
        let el = document.querySelector(`[data-partial="${compName}"]`);
        if (!el) {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
          while (walker.nextNode()) {
            if (walker.currentNode.nodeValue.includes(`@partial:${compName}:begin`)) {
              el = walker.currentNode.nextElementSibling;
              break;
            }
          }
        }
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.outline = '2px solid #0891b2';
          el.style.outlineOffset = '4px';
          setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 2000);
        }
      });

      card.querySelector('.sm-comp-edit').addEventListener('click', () => {
        showComponentEditor(compId);
      });

      card.querySelector('.sm-comp-delete').addEventListener('click', async () => {
        if (!confirm(`Delete component "${compName}"?`)) return;
        await fetch(`/api/partials/${compId}`, { method: 'DELETE' });
        card.remove();
        toast('Component deleted');
      });
    });
  }

  function renderComponentCardFallback(p, opts) {
    return (UI().renderComponentCard || function(partial, o) {
      const { isUsed = false, showFind = false } = o || {};
      return `<div class="sm-comp-card${isUsed ? ' sm-comp-card-used' : ''}" data-comp-name="${esc(partial.name)}" data-comp-id="${esc(partial.id)}">
        <div class="sm-comp-card-header">
          <span class="sm-comp-card-name">${esc(partial.name)}</span>
          ${isUsed ? '<span class="sm-comp-badge sm-comp-badge-active">ON PAGE</span>' : ''}
          ${partial.isPattern ? '<span class="sm-comp-badge sm-comp-badge-pattern">PATTERN</span>' : '<span class="sm-comp-badge sm-comp-badge-partial">PARTIAL</span>'}
        </div>
        <div class="sm-comp-card-preview" data-comp-preview="${esc(partial.id)}"></div>
        <div class="sm-comp-card-actions">
          ${showFind ? `<button class="sm-comp-btn sm-comp-find" ${!isUsed ? 'disabled' : ''}>Find</button>` : ''}
          <button class="sm-comp-btn sm-comp-edit">Edit</button>
          <button class="sm-comp-btn sm-comp-delete">&times;</button>
        </div>
      </div>`;
    })(p, opts);
  }

  function showComponentEditor(compId) {
    fetch('/api/partials').then(r => r.ok ? r.json() : []).then(list => {
      const partial = list.find(p => p.id === compId);
      const opener = UI().openComponentEditor;
      if (opener) {
        opener({
          partial: partial || { id: compId },
          onSave: () => { toast('Component saved'); loadComponentsTab(); },
        });
      } else {
        toast('Editor unavailable');
      }
    });
  }

  // ── Media Tab ──

  async function loadMediaTab() {
    siteBody.innerHTML = '<div class="sm-site-loading">Loading…</div>';
    try {
      const res = await fetch('/api/media');
      if (!res.ok) throw new Error('Failed to load');
      const media = await res.json();
      renderMediaGrid(media);
    } catch (err) {
      siteBody.innerHTML = `<div class="sm-site-empty">Error: ${err.message}</div>`;
    }
  }

  function renderMediaGrid(media) {
    let html = `<div class="sm-site-actions">
      <button class="sm-btn sm-site-add-btn" id="sm-upload-media">+ Upload</button>
    </div>`;

    if (!media.length) {
      html += '<div class="sm-site-empty">No media yet. Upload files to use on your site.</div>';
    } else {
      html += '<div class="sm-media-grid">';
      for (const item of media) {
        html += (UI().renderMediaCard || renderMediaCardFallback)(item);
      }
      html += '</div>';
    }

    siteBody.innerHTML = html;

    document.getElementById('sm-upload-media').addEventListener('click', () => {
      uploadAndReplace(path => {
        loadMediaTab();
        toast('Uploaded ' + path.split('/').pop());
      });
    });

    siteBody.querySelectorAll('.sm-media-item').forEach(card => {
      card.querySelector('.sm-media-copy').addEventListener('click', (e) => {
        e.stopPropagation();
        const p = card.dataset.mediaPath;
        navigator.clipboard.writeText(p).then(() => toast('Copied: ' + p)).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = p;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          toast('Copied: ' + p);
        });
      });

      card.querySelector('.sm-media-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this file?')) return;
        await fetch(`/api/media/${card.dataset.mediaId}`, { method: 'DELETE' });
        card.remove();
        toast('Deleted');
      });
    });
  }

  function renderMediaCardFallback(item) {
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(item.path) || (item.mimeType || '').startsWith('image/');
    const name = item.originalName || item.path.split('/').pop();
    return `<div class="sm-media-item" data-media-id="${esc(item.id)}" data-media-path="${esc(item.path)}">
      <div class="sm-media-thumb">
        ${isImage ? `<img src="${esc(item.path)}" loading="lazy">` : `<span class="sm-media-ext">${esc(item.path.split('.').pop().toUpperCase())}</span>`}
      </div>
      <div class="sm-media-info"><span class="sm-media-name">${esc(name)}</span></div>
      <div class="sm-media-actions">
        <button class="sm-media-copy">Copy</button>
        <button class="sm-media-del">&times;</button>
      </div>
    </div>`;
  }

  function addChatMessage(role, text) {
    const div = document.createElement('div');
    div.className = `sm-chat-msg sm-chat-${role === 'assistant' ? 'ai' : role}`;
    div.textContent = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function renderWelcome() {
    chatMessages.innerHTML = '';
    const w = document.createElement('div');
    w.className = 'sm-chat-msg sm-chat-ai';
    w.textContent = 'Describe what you\'d like to change on this page.';
    chatMessages.appendChild(w);
  }

  async function loadChatHistory() {
    try {
      const res = await fetch(`/api/chat/${slug}`);
      const messages = await res.json();
      if (messages.length === 0) {
        renderWelcome();
        return;
      }
      chatMessages.innerHTML = '';
      for (const msg of messages) addChatMessage(msg.role, msg.content);
    } catch {
      renderWelcome();
    }
  }

  async function clearChatHistory() {
    try {
      await fetch(`/api/chat/${slug}`, { method: 'DELETE' });
    } catch {}
    renderWelcome();
    toast('Chat cleared');
  }

  document.getElementById('sm-chat-clear').addEventListener('click', clearChatHistory);
  loadChatHistory();

  function applyNewHTML(newHTML) {
    deactivate();
    deselectSection();

    const parser = new DOMParser();
    const doc = parser.parseFromString(newHTML, 'text/html');

    document.querySelectorAll('head style:not([data-sm-overlay])').forEach(s => s.remove());
    doc.querySelectorAll('head style').forEach(s => {
      document.head.appendChild(document.importNode(s, true));
    });

    [...document.body.childNodes].forEach(node => {
      if (node.nodeType === 1 && node.hasAttribute('data-sm-overlay')) return;
      node.remove();
    });

    const ref = document.body.firstChild;
    [...doc.body.childNodes].forEach(node => {
      document.body.insertBefore(document.importNode(node, true), ref);
    });

    document.body.classList.add('sm-body-offset');
    injectLabels();
    markEditableImages();
    if (imagePanelOpen) scanPageImages();
    injectCollectionLabels();
    adjustFixedElements();
    markDirty();
  }

  async function sendChat() {
    const message = chatInput.value.trim();
    if (!message) return;

    chatInput.value = '';
    chatSendBtn.disabled = true;
    addChatMessage('user', message);
    addChatMessage('ai', '...');

    const loadingMsg = chatMessages.lastChild;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, slug, html: getChatHTML() }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error || `Server error (${res.status})`);
      }
      const data = await res.json();
      loadingMsg.textContent = data.reply || 'Done.';

      if (data.html) {
        applyNewHTML(data.html);
        const others = (data.applied || []).filter(f => !f.startsWith('pages/'));
        if (others.length) {
          toast('Updated: page + ' + others.join(', '));
        } else {
          toast('Page updated by AI');
        }
      } else if (data.applied && data.applied.length) {
        toast('Updated: ' + data.applied.join(', '));
      }

      if (data.actionResults && data.actionResults.length) {
        const summary = data.actionResults.map(a => `${a.action}: ${a.slug}`).join(', ');
        toast('Actions: ' + summary);
      }
    } catch (err) {
      loadingMsg.textContent = 'Error: ' + err.message;
    } finally {
      chatSendBtn.disabled = false;
      chatInput.focus();
    }
  }

  chatSendBtn.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  // ── Save ──

  saveBtn.addEventListener('click', async () => {
    if (!dirty) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const saveRes = await fetch('/api/pages/' + slug + '/html', {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: getCleanHTML(),
      });
      if (!saveRes.ok) throw new Error('Save failed (' + saveRes.status + ')');
      dirty = false;
      statusEl.textContent = '';
      toast('Page saved');
    } catch (err) {
      toast('Save failed: ' + err.message);
    } finally {
      saveBtn.textContent = 'Save';
      saveBtn.disabled = !dirty;
    }
  });

  // ── Section & partial labels (real DOM, no pseudo-elements) ──

  function injectLabels() {
    document.querySelectorAll('.sm-section-label, .sm-partial-label').forEach(el => el.remove());

    document.querySelectorAll('[data-section]').forEach(el => {
      if (el.closest('[data-sm-overlay]')) return;
      const style = getComputedStyle(el);
      if (style.position === 'static') el.style.position = 'relative';
      const label = document.createElement('span');
      label.className = 'sm-section-label';
      label.setAttribute('data-sm-overlay', '');
      label.textContent = el.getAttribute('data-section');
      el.appendChild(label);
    });

    document.querySelectorAll('[data-partial]').forEach(el => {
      if (el.closest('[data-sm-overlay]')) return;
      const style = getComputedStyle(el);
      if (style.position === 'static') el.style.position = 'relative';
      const label = document.createElement('span');
      label.className = 'sm-partial-label';
      label.setAttribute('data-sm-overlay', '');
      label.textContent = '\u29C9 Shared: ' + el.getAttribute('data-partial');
      el.appendChild(label);
    });
  }

  injectLabels();

  // ── Editable image badges ──

  function isLocalImage(src) {
    return src && (src.startsWith('/media/') || src.startsWith('/content/'));
  }

  function isExternalImage(src) {
    return src && (src.startsWith('http://') || src.startsWith('https://'));
  }

  function uploadAndReplace(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) { input.remove(); return; }
      const form = new FormData();
      form.append('image', file);
      try {
        const res = await fetch('/api/media/upload', { method: 'POST', body: form });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        callback(data.path);
        markDirty();
        toast('Image replaced');
      } catch(e) {
        toast('Upload failed');
      }
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  function makeBadge(label, title) {
    const badge = document.createElement('span');
    badge.className = 'sm-img-badge';
    badge.setAttribute('data-sm-overlay', '');
    badge.textContent = label;
    badge.title = title;
    return badge;
  }

  function markEditableImages() {
    document.querySelectorAll('.sm-img-badge').forEach(el => el.remove());

    document.querySelectorAll('img').forEach(img => {
      if (img.closest('[data-sm-overlay]')) return;
      const src = img.getAttribute('src') || '';
      if (!src) return;

      const isPlaceholder = src.startsWith('/media/placeholder/');
      const isExternal = isExternalImage(src);
      const label = isPlaceholder ? 'AI' : isExternal ? 'EXT' : 'IMG';
      const title = isPlaceholder ? 'AI placeholder — click to replace'
        : isExternal ? 'External image — click to replace with upload'
        : 'Click to replace image';

      const parent = img.parentElement;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

      const badge = makeBadge(label, title);
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        uploadAndReplace(path => { img.src = path; });
      });
      parent.appendChild(badge);
    });

    document.querySelectorAll('[data-section], [data-partial]').forEach(el => {
      if (el.closest('[data-sm-overlay]')) return;
      const style = getComputedStyle(el);
      const bg = style.backgroundImage;
      if (!bg || bg === 'none') return;
      if (!bg.includes('url(')) return;

      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

      const badge = makeBadge('BG', 'Background image — click to replace');
      badge.classList.add('sm-img-badge-bg');
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        uploadAndReplace(path => {
          el.style.backgroundImage = `url('${path}')`;
        });
      });
      el.appendChild(badge);
    });
  }

  markEditableImages();

  // ── Collection directive labels & popover ──

  let activePopover = null;

  function injectCollectionLabels() {
    document.querySelectorAll('.sm-collection-label').forEach(el => el.remove());

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT, null);
    const beginComments = [];
    while (walker.nextNode()) {
      const val = walker.currentNode.nodeValue.trim();
      if (val.match(/^@collection:[\w-]+:begin/)) {
        beginComments.push(walker.currentNode);
      }
    }

    for (const comment of beginComments) {
      const m = comment.nodeValue.trim().match(/^@collection:([\w-]+):begin\s*(.*)?$/);
      if (!m) continue;
      const colSlug = m[1];
      const paramStr = (m[2] || '').trim();

      let block = comment.nextSibling;
      while (block && (block.nodeType !== 1 || block.hasAttribute('data-sm-overlay'))) {
        if (block.nodeType === 8) {
          const cv = block.nodeValue.trim();
          if (cv.startsWith('@collection-template:') || cv.startsWith('@collection:' + colSlug + ':end')) {
            block = block.nextSibling;
            continue;
          }
        }
        block = block.nextSibling;
      }

      const parent = comment.parentElement;
      if (!parent) continue;
      const pStyle = getComputedStyle(parent);
      if (pStyle.position === 'static') parent.style.position = 'relative';

      const label = document.createElement('span');
      label.className = 'sm-collection-label';
      label.setAttribute('data-sm-overlay', '');
      label.setAttribute('data-col-slug', colSlug);
      label.setAttribute('data-col-params', paramStr);
      label.textContent = '\u25A6 ' + colSlug;
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        openCollectionPopover(label, colSlug, paramStr);
      });
      parent.appendChild(label);
    }
  }

  async function openCollectionPopover(labelEl, colSlug, paramStr) {
    closeCollectionPopover();

    const params = {};
    const rx = /(\w+)=([^\s]+)/g;
    let pm;
    while ((pm = rx.exec(paramStr)) !== null) params[pm[1]] = pm[2];

    const isCurated = !!params.entries;
    const mode = isCurated ? 'curated' : 'dynamic';

    let colData = null;
    let entries = [];
    try {
      const cols = await fetch('/api/collections').then(r => r.json());
      colData = cols.find(c => c.slug === colSlug);
      if (colData) {
        entries = await fetch('/api/collections/' + colData.id + '/entries').then(r => r.json());
      }
    } catch { }

    if (!colData) { toast('Collection not found: ' + colSlug); return; }

    const schemaFields = (colData.schema || []).map(f => f.name);
    const titleField = schemaFields.includes('title') ? 'title' : schemaFields[0] || 'slug';
    const selectedSlugs = isCurated ? params.entries.split(',').map(s => s.trim()) : [];

    const popover = document.createElement('div');
    popover.className = 'sm-col-popover';
    popover.setAttribute('data-sm-overlay', '');

    popover.innerHTML = `
      <div class="sm-col-popover-header">
        <strong>${esc(colSlug)}</strong>
        <button class="sm-col-popover-close" id="sm-col-pop-close">&times;</button>
      </div>
      <div class="sm-col-popover-body">
        <div class="sm-col-mode-toggle">
          <button class="sm-col-mode-btn ${mode === 'dynamic' ? 'active' : ''}" data-mode="dynamic">Dynamic</button>
          <button class="sm-col-mode-btn ${mode === 'curated' ? 'active' : ''}" data-mode="curated">Curated</button>
        </div>
        <div class="sm-col-panel" id="sm-col-dynamic" style="${mode === 'curated' ? 'display:none' : ''}">
          <div class="sm-col-controls">
            <div class="sm-col-row">
              <div>
                <label>Limit</label>
                <input type="number" id="sm-col-limit" min="1" value="${params.limit || ''}" placeholder="all">
              </div>
              <div>
                <label>Sort by</label>
                <select id="sm-col-sort">
                  <option value="created" ${(!params.sort || params.sort === 'created') ? 'selected' : ''}>Created</option>
                  ${schemaFields.map(f => `<option value="${f}" ${params.sort === f ? 'selected' : ''}>${f}</option>`).join('')}
                </select>
              </div>
              <div>
                <label>Order</label>
                <select id="sm-col-order">
                  <option value="desc" ${(!params.order || params.order === 'desc') ? 'selected' : ''}>Desc</option>
                  <option value="asc" ${params.order === 'asc' ? 'selected' : ''}>Asc</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div class="sm-col-panel" id="sm-col-curated" style="${mode === 'dynamic' ? 'display:none' : ''}">
          <ul class="sm-col-entry-list" id="sm-col-entries"></ul>
        </div>
      </div>
      <div class="sm-col-popover-footer">
        <button class="sm-col-apply-btn" id="sm-col-apply">Apply</button>
      </div>`;

    labelEl.parentElement.appendChild(popover);
    activePopover = popover;

    function renderEntryList() {
      const list = popover.querySelector('#sm-col-entries');
      const orderedEntries = [];
      for (const s of selectedSlugs) {
        const e = entries.find(en => en.slug === s);
        if (e) orderedEntries.push(e);
      }
      for (const e of entries) {
        if (!selectedSlugs.includes(e.slug)) orderedEntries.push(e);
      }

      list.innerHTML = orderedEntries.map(e => {
        const checked = selectedSlugs.includes(e.slug);
        const label = e.data[titleField] || e.slug;
        return `<li class="sm-col-entry-item" data-slug="${e.slug}" draggable="true">
          <span class="sm-col-drag-handle">&#9776;</span>
          <input type="checkbox" ${checked ? 'checked' : ''}>
          <span class="sm-col-entry-label">${esc(String(label))}</span>
        </li>`;
      }).join('');

      setupDragDrop(list);
    }

    renderEntryList();

    function setupDragDrop(list) {
      let dragItem = null;
      list.addEventListener('dragstart', e => {
        dragItem = e.target.closest('.sm-col-entry-item');
        if (dragItem) dragItem.classList.add('dragging');
      });
      list.addEventListener('dragend', () => {
        if (dragItem) dragItem.classList.remove('dragging');
        list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        dragItem = null;
      });
      list.addEventListener('dragover', e => {
        e.preventDefault();
        const target = e.target.closest('.sm-col-entry-item');
        list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (target && target !== dragItem) target.classList.add('drag-over');
      });
      list.addEventListener('drop', e => {
        e.preventDefault();
        const target = e.target.closest('.sm-col-entry-item');
        if (target && dragItem && target !== dragItem) {
          list.insertBefore(dragItem, target);
        }
        list.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
    }

    // Mode toggle
    popover.querySelectorAll('.sm-col-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        popover.querySelectorAll('.sm-col-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const m = btn.dataset.mode;
        popover.querySelector('#sm-col-dynamic').style.display = m === 'dynamic' ? '' : 'none';
        popover.querySelector('#sm-col-curated').style.display = m === 'curated' ? '' : 'none';
      });
    });

    // Close
    popover.querySelector('#sm-col-pop-close').addEventListener('click', closeCollectionPopover);

    // Apply
    popover.querySelector('#sm-col-apply').addEventListener('click', () => {
      const activeMode = popover.querySelector('.sm-col-mode-btn.active').dataset.mode;
      let newParams = '';

      if (activeMode === 'dynamic') {
        const limit = popover.querySelector('#sm-col-limit').value;
        const sort = popover.querySelector('#sm-col-sort').value;
        const order = popover.querySelector('#sm-col-order').value;
        if (limit) newParams += ` limit=${limit}`;
        if (sort && sort !== 'created') newParams += ` sort=${sort}`;
        if (order && order !== 'desc') newParams += ` order=${order}`;
      } else {
        const checked = [];
        popover.querySelectorAll('#sm-col-entries .sm-col-entry-item').forEach(item => {
          if (item.querySelector('input[type="checkbox"]').checked) {
            checked.push(item.dataset.slug);
          }
        });
        if (checked.length) newParams = ` entries=${checked.join(',')}`;
      }

      updateCollectionDirective(colSlug, paramStr, newParams.trim());
      closeCollectionPopover();
      markDirty();
      toast('Collection updated — save to apply');
    });
  }

  function updateCollectionDirective(colSlug, oldParams, newParams) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT, null);
    while (walker.nextNode()) {
      const val = walker.currentNode.nodeValue.trim();
      if (val.match(new RegExp('^@collection:' + colSlug + ':begin'))) {
        walker.currentNode.nodeValue = ` @collection:${colSlug}:begin ${newParams} `;
      }
      if (val.startsWith('@collection-template:' + colSlug)) {
        const oldDirective = walker.currentNode.nodeValue;
        const updatedDirective = oldDirective
          .replace(/<!-- @collection:[\w-]+((?:\s+\w+=\S+)*)\s*-->/, `<!-- @collection:${colSlug} ${newParams} -->`);
        walker.currentNode.nodeValue = updatedDirective;
      }
    }

    const label = document.querySelector(`.sm-collection-label[data-col-slug="${colSlug}"]`);
    if (label) label.setAttribute('data-col-params', newParams);
  }

  function closeCollectionPopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
  }

  document.addEventListener('click', e => {
    if (activePopover && !e.target.closest('.sm-col-popover') && !e.target.closest('.sm-collection-label')) {
      closeCollectionPopover();
    }
  });

  injectCollectionLabels();

  // ── Extension points ──

  const extState = { manifests: [], buttons: [] };

  window.__SM_EXTENSIONS__ = {
    getPage: () => ({ slug, title, html: getChatHTML() }),
    getSelection: () => selectedSection ? { name: selectedSection.getAttribute('data-section') || selectedSection.getAttribute('data-partial') || 'element', html: getCleanSectionHTML(selectedSection) } : null,
    markDirty,
    toast,
    on: (event, fn) => {
      window.addEventListener('sm:' + event, e => fn(e.detail));
    },
  };

  function fireExtEvent(name, detail) {
    window.dispatchEvent(new CustomEvent('sm:' + name, { detail }));
  }

  const origSelectSection = selectSection;
  selectSection = function(el) {
    origSelectSection(el);
    fireExtEvent('sectionSelect', {
      name: el.getAttribute('data-section') || el.getAttribute('data-partial') || 'element',
      html: getCleanSectionHTML(el),
    });
  };

  const origDeselect = deselectSection;
  deselectSection = function() {
    origDeselect();
    fireExtEvent('sectionDeselect', {});
  };

  const origSave = saveBtn.onclick;
  saveBtn.addEventListener('click', () => {
    fireExtEvent('pageSave', { slug, title });
  });

  (async function loadExtManifests() {
    try {
      const res = await fetch('/api/extensions/manifest');
      extState.manifests = await res.json();
    } catch { return; }

    const overlayExts = extState.manifests.filter(m => m.overlay);
    if (!overlayExts.length) return;

    let hasButtons = false;
    for (const ext of overlayExts) {
      if (ext.overlay.toolbar && ext.overlay.toolbar.length) {
        if (!hasButtons) {
          const sep = document.createElement('div');
          sep.className = 'sm-toolbar-sep';
          toolbar.appendChild(sep);
          hasButtons = true;
        }
        for (const btn of ext.overlay.toolbar) {
          const el = document.createElement('button');
          el.className = 'sm-toolbar-btn sm-toolbar-ext';
          el.title = btn.label || ext.id;
          el.textContent = btn.icon || btn.label?.[0] || '?';
          el.addEventListener('mousedown', async e => {
            e.preventDefault();
            const page = window.__SM_EXTENSIONS__.getPage();
            const selection = window.__SM_EXTENSIONS__.getSelection();
            try {
              const r = await fetch(btn.action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page, selection }),
              });
              const data = await r.json();
              if (data.html) { applyNewHTML(data.html); toast(btn.label + ': applied'); }
              else if (data.message) toast(data.message);
              else toast(btn.label + ': done');
            } catch (err) {
              toast('Error: ' + err.message);
            }
          });
          toolbar.appendChild(el);
        }
      }

      if (ext.overlay.contextMenu && ext.overlay.contextMenu.length) {
        for (const item of ext.overlay.contextMenu) {
          extState.buttons.push(item);
        }
      }
    }

    if (extState.buttons.length) {
      const origContextBarHTML = contextBar.innerHTML;
      const extBtnContainer = document.createElement('div');
      extBtnContainer.className = 'sm-context-ext-buttons';
      extBtnContainer.setAttribute('data-sm-overlay', '');
      for (const item of extState.buttons) {
        const btn = document.createElement('button');
        btn.className = 'sm-btn sm-context-ext-btn';
        btn.textContent = item.label;
        btn.title = item.label;
        btn.addEventListener('click', async () => {
          if (!selectedSection) return;
          const sectionHTML = getCleanSectionHTML(selectedSection);
          const name = selectedSection.getAttribute('data-section') || selectedSection.getAttribute('data-partial') || 'element';
          try {
            const r = await fetch(item.action, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ page: { slug, title, html: getChatHTML() }, selection: { name, html: sectionHTML } }),
            });
            const data = await r.json();
            if (data.html) { applyNewHTML(data.html); toast(item.label + ': applied'); }
            else if (data.message) toast(data.message);
            else toast(item.label + ': done');
          } catch (err) {
            toast('Error: ' + err.message);
          }
        });
        extBtnContainer.appendChild(btn);
      }
      contextBar.appendChild(extBtnContainer);
    }
  })();

  // ── Push fixed/sticky page elements below topbar ──

  function adjustFixedElements() {
    const offset = '42px';
    document.querySelectorAll('*:not([data-sm-overlay])').forEach(el => {
      const style = getComputedStyle(el);
      if ((style.position === 'fixed' || style.position === 'sticky') && el.getBoundingClientRect().top < 43) {
        if (!el.hasAttribute('data-sm-orig-top')) {
          el.setAttribute('data-sm-orig-top', el.style.top || '');
        }
        el.style.top = offset;
      }
    });
  }

  adjustFixedElements();

  // ── Warn on unsaved leave ──

  window.addEventListener('beforeunload', e => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
})();
