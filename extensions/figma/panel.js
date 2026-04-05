export function renderPanel() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; }

    .tabs { display: flex; border-bottom: 1px solid #1e293b; padding: 0 32px; }
    .tab { padding: 14px 20px; font-size: 14px; font-weight: 500; color: #64748b; cursor: pointer; border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s; }
    .tab:hover { color: #94a3b8; }
    .tab.active { color: #e2e8f0; border-bottom-color: #818cf8; }

    .panel { display: none; padding: 32px; }
    .panel.active { display: block; }

    h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; }
    .subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 28px; }
    .field { margin-bottom: 20px; }
    label { display: block; font-size: 13px; color: #94a3b8; margin-bottom: 6px; font-weight: 500; }
    input, select { width: 100%; background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 6px; padding: 10px 12px; font-size: 14px; font-family: inherit; }
    input:focus, select:focus { outline: none; border-color: #818cf8; }
    input::placeholder { color: #475569; }
    .btn { background: #4f46e5; color: #fff; border: none; border-radius: 6px; padding: 10px 20px; font-size: 14px; font-weight: 500; cursor: pointer; font-family: inherit; }
    .btn:hover { background: #4338ca; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: #334155; }
    .btn-secondary:hover { background: #475569; }
    .actions { display: flex; gap: 10px; margin-top: 24px; }
    .status { margin-top: 16px; padding: 12px; border-radius: 6px; font-size: 13px; display: none; }
    .status.info { display: block; background: #1e3a5f; color: #93c5fd; }
    .status.error { display: block; background: #3b1320; color: #fca5a5; }
    .status.success { display: block; background: #14332a; color: #86efac; }
    .results { margin-top: 24px; }
    .results h2 { font-size: 16px; margin-bottom: 12px; }
    .token-list { list-style: none; }
    .token-list li { padding: 6px 0; font-size: 13px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; gap: 10px; }
    .color-swatch { width: 16px; height: 16px; border-radius: 3px; border: 1px solid #475569; flex-shrink: 0; }
    .section-tree { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; background: #1e293b; padding: 12px; border-radius: 6px; white-space: pre; overflow-x: auto; max-height: 400px; overflow-y: auto; line-height: 1.6; }
    .help { color: #64748b; font-size: 12px; margin-top: 4px; }
    .divider { border: none; border-top: 1px solid #1e293b; margin: 24px 0; }
    .row { display: flex; gap: 12px; }
    .row .field { flex: 1; }
    .saved-indicator { display: inline-block; color: #86efac; font-size: 13px; margin-left: 12px; opacity: 0; transition: opacity 0.3s; }
    .saved-indicator.show { opacity: 1; }
    .settings-connected { padding: 10px 16px; background: #14332a; border-radius: 6px; color: #86efac; font-size: 13px; margin-bottom: 20px; display: none; }
    .settings-connected.show { display: flex; align-items: center; gap: 8px; }
    .settings-missing { padding: 10px 16px; background: #3b1320; border-radius: 6px; color: #fca5a5; font-size: 13px; margin-bottom: 20px; cursor: pointer; display: none; }
    .settings-missing.show { display: flex; align-items: center; gap: 8px; }
    @keyframes figma-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .status.info { animation: figma-pulse 1.5s ease-in-out infinite; }
  </style>
</head>
<body>

  <div class="tabs">
    <div class="tab active" data-tab="import">Import</div>
    <div class="tab" data-tab="settings">Settings</div>
  </div>

  <!-- ─── Import Tab ─── -->
  <div class="panel active" id="panel-import">
    <h1>Figma Import</h1>
    <p class="subtitle">Extract design tokens and structural layout from a Figma file, then apply them to your site through the AI.</p>

    <div class="settings-connected" id="settings-ok">Connected to Figma</div>
    <div class="settings-missing" id="settings-missing">Figma access token not set — click to configure in Settings</div>

    <div class="field">
      <label>Figma File URL</label>
      <input type="text" id="url" placeholder="https://www.figma.com/design/abc123/My-Design?node-id=1-2">
      <p class="help">Paste any Figma file or frame URL. If a specific frame is selected, only that frame is analyzed.</p>
    </div>

    <div class="row">
      <div class="field">
        <label>Target Page</label>
        <select id="page">
          <option value="">Loading pages...</option>
        </select>
      </div>
      <div class="field">
        <label>Mode</label>
        <select id="mode">
          <option value="apply">Apply to existing page</option>
          <option value="create">Create new page from design</option>
        </select>
      </div>
    </div>

    <div id="create-fields" style="display:none">
      <div class="row">
        <div class="field">
          <label>Page Title</label>
          <input type="text" id="create-title" placeholder="e.g. About Us">
        </div>
        <div class="field">
          <label>Slug</label>
          <input type="text" id="create-slug" placeholder="e.g. about">
          <p class="help">Auto-generated from title if left blank.</p>
        </div>
      </div>
      <div class="field">
        <label>Additional Instructions (optional)</label>
        <input type="text" id="create-intent" placeholder="e.g. Make it feel warm and inviting, emphasize the team photos">
        <p class="help">Extra guidance for the AI beyond what Figma provides.</p>
      </div>
    </div>

    <div class="actions">
      <button class="btn" id="extract-btn">Import from Figma</button>
    </div>

    <div class="status" id="import-status"></div>

    <div class="results" id="results" style="display:none">
      <hr class="divider">
      <h2>Extracted Tokens</h2>
      <ul class="token-list" id="token-list"></ul>

      <hr class="divider">
      <h2>Structure</h2>
      <div class="section-tree" id="structure-tree"></div>
    </div>
  </div>

  <!-- ─── Settings Tab ─── -->
  <div class="panel" id="panel-settings">
    <h1>Figma Settings</h1>
    <p class="subtitle">Configure your Figma connection. These settings are saved on the server and persist across sessions.</p>

    <div class="field">
      <label>Figma Personal Access Token</label>
      <input type="password" id="settings-token" placeholder="figd_xxxxxxxx">
      <p class="help">Generate at figma.com → Settings → Personal access tokens.</p>
    </div>

    <div class="field">
      <label>Default File URL (optional)</label>
      <input type="text" id="settings-default-url" placeholder="https://www.figma.com/design/abc123/My-Design">
      <p class="help">Pre-fills the file URL on the Import tab. Useful if you work from one main Figma file.</p>
    </div>

    <div class="actions">
      <button class="btn" id="settings-save-btn">Save Settings</button>
      <span class="saved-indicator" id="saved-indicator">Saved</span>
    </div>

    <div class="status" id="settings-status"></div>
  </div>

  <script>
    // ─── Tab switching ───
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.panel');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      });
    });

    // ─── Settings ───
    const settingsToken = document.getElementById('settings-token');
    const settingsDefaultUrl = document.getElementById('settings-default-url');
    const settingsSaveBtn = document.getElementById('settings-save-btn');
    const savedIndicator = document.getElementById('saved-indicator');
    const settingsStatus = document.getElementById('settings-status');
    const settingsOk = document.getElementById('settings-ok');
    const settingsMissing = document.getElementById('settings-missing');

    let currentSettings = {};

    settingsMissing.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="settings"]').classList.add('active');
      document.getElementById('panel-settings').classList.add('active');
      settingsToken.focus();
    });

    async function loadSettings() {
      try {
        const res = await fetch('/x/figma/settings');
        if (res.ok) {
          currentSettings = await res.json();
          if (currentSettings.hasToken) {
            settingsToken.value = '';
            settingsToken.placeholder = currentSettings.figmaToken + ' (saved — leave blank to keep)';
          }
          settingsDefaultUrl.value = currentSettings.defaultUrl || '';
          if (currentSettings.defaultUrl) {
            urlInput.value = urlInput.value || currentSettings.defaultUrl;
          }
        }
      } catch {}
      updateConnectionStatus();
    }

    function updateConnectionStatus() {
      const connected = !!currentSettings.hasToken;
      settingsOk.classList.toggle('show', connected);
      settingsMissing.classList.toggle('show', !connected);
      extractBtn.disabled = !connected;
    }

    settingsSaveBtn.addEventListener('click', async () => {
      settingsSaveBtn.disabled = true;
      try {
        const payload = { defaultUrl: settingsDefaultUrl.value.trim() };
        const newToken = settingsToken.value.trim();
        if (newToken) payload.figmaToken = newToken;
        const res = await fetch('/x/figma/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Save failed');
        currentSettings = await res.json();
        settingsToken.value = '';
        if (currentSettings.hasToken) {
          settingsToken.placeholder = currentSettings.figmaToken + ' (saved — leave blank to keep)';
        }
        savedIndicator.classList.add('show');
        setTimeout(() => savedIndicator.classList.remove('show'), 2000);
        updateConnectionStatus();
        if (currentSettings.defaultUrl && !urlInput.value) {
          urlInput.value = currentSettings.defaultUrl;
        }
      } catch (err) {
        settingsStatus.textContent = 'Error: ' + err.message;
        settingsStatus.className = 'status error';
      } finally {
        settingsSaveBtn.disabled = false;
      }
    });

    // ─── Import ───
    const urlInput = document.getElementById('url');
    const pageSelect = document.getElementById('page');
    const modeSelect = document.getElementById('mode');
    const createFields = document.getElementById('create-fields');
    const createTitle = document.getElementById('create-title');
    const createSlug = document.getElementById('create-slug');
    const createIntent = document.getElementById('create-intent');
    const extractBtn = document.getElementById('extract-btn');
    const importStatus = document.getElementById('import-status');
    const resultsEl = document.getElementById('results');
    const tokenList = document.getElementById('token-list');
    const structureTree = document.getElementById('structure-tree');

    modeSelect.addEventListener('change', () => {
      const isCreate = modeSelect.value === 'create';
      createFields.style.display = isCreate ? 'block' : 'none';
      pageSelect.closest('.field').style.display = isCreate ? 'none' : 'block';
    });

    createTitle.addEventListener('input', () => {
      if (!createSlug.dataset.manual) {
        createSlug.value = createTitle.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
    });
    createSlug.addEventListener('input', () => { createSlug.dataset.manual = '1'; });

    fetch('/api/pages').then(r => r.json()).then(pages => {
      pageSelect.innerHTML = '<option value="">— no page (site-level) —</option>' +
        pages.map(p => '<option value="' + p.slug + '">' + p.title + ' (' + p.slug + ')</option>').join('');
    });

    function setImportStatus(msg, type) {
      importStatus.textContent = msg;
      importStatus.className = 'status ' + type;
    }

    extractBtn.addEventListener('click', async () => {
      if (!currentSettings.hasToken) {
        setImportStatus('Figma token not configured. Go to Settings first.', 'error');
        return;
      }
      const url = urlInput.value.trim();
      if (!url) return setImportStatus('Please enter a Figma file URL.', 'error');

      const isCreate = modeSelect.value === 'create';
      if (isCreate && !createTitle.value.trim()) {
        return setImportStatus('Please enter a page title.', 'error');
      }

      extractBtn.disabled = true;
      setImportStatus('Extracting from Figma...', 'info');

      let extractedData;
      try {
        const res = await fetch('/x/figma/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ figmaUrl: url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Extract failed');

        extractedData = data;
        renderResults(data);
        const imgCount = data.imageMap ? Object.keys(data.imageMap).length : 0;
        const imgMsg = imgCount ? ', ' + imgCount + ' images' : '';
        setImportStatus('Extracted ' + data.tokens.colors.length + ' colors, ' + data.tokens.fonts.length + ' fonts, ' + data.structure.length + ' sections' + imgMsg + '. Sending to AI...', 'info');
      } catch (err) {
        setImportStatus('Error: ' + err.message, 'error');
        extractBtn.disabled = false;
        return;
      }

      const payload = {
        tokens: extractedData.tokens,
        structure: extractedData.structureDescription,
        decisions: extractedData.decisions,
        imageMap: extractedData.imageMap || {},
        mode: modeSelect.value,
      };

      if (isCreate) {
        payload.newPage = {
          title: createTitle.value.trim(),
          slug: createSlug.value.trim() || createTitle.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          intent: createIntent.value.trim(),
        };
      } else {
        payload.page = pageSelect.value || null;
      }

      try {
        let streamText = '';
        const applyRes = await fetch('/x/figma/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          body: JSON.stringify(payload),
        });
        if (!applyRes.ok) {
          const errData = await applyRes.json().catch(() => ({ error: applyRes.statusText }));
          throw new Error(errData.error || 'Apply failed');
        }
        const reader = applyRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let evtType = null;
        let finalData = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('event: ')) evtType = line.slice(7).trim();
            else if (line.startsWith('data: ') && evtType) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (evtType === 'token') { streamText += parsed; setImportStatus('AI is writing… (' + streamText.length + ' chars)', 'info'); }
                else if (evtType === 'done') finalData = parsed;
                else if (evtType === 'error') throw new Error(parsed);
              } catch (e) { if (evtType === 'error') throw e; }
              evtType = null;
            } else if (line === '') evtType = null;
          }
        }

        if (finalData) {
          setImportStatus(finalData.reply || 'Done. Check your pages.', 'success');
        } else {
          setImportStatus('Done. Check your pages.', 'success');
        }
      } catch (err) {
        setImportStatus('Error: ' + err.message, 'error');
      } finally {
        extractBtn.disabled = false;
      }
    });

    function renderResults(data) {
      resultsEl.style.display = 'block';
      tokenList.innerHTML = '';
      for (const c of data.tokens.colors) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="color-swatch" style="background:' + c.value + '"></span>' + c.value + ' <span style="color:#64748b">(' + c.source + ')</span>';
        tokenList.appendChild(li);
      }
      for (const f of data.tokens.fonts) {
        const li = document.createElement('li');
        li.textContent = f.family + ' ' + f.weight + ' ' + f.size + 'px';
        tokenList.appendChild(li);
      }
      if (data.imageMap && Object.keys(data.imageMap).length) {
        for (const [name, path] of Object.entries(data.imageMap)) {
          const li = document.createElement('li');
          const isSvg = path.endsWith('.svg');
          li.innerHTML = (isSvg ? '◇ ' : '▣ ') + '<strong>' + name + '</strong> <span style="color:#64748b">→ ' + path + '</span>';
          tokenList.appendChild(li);
        }
      }
      structureTree.textContent = data.structureDescription || '(no structure extracted)';
    }

    // ─── Init ───
    loadSettings();
  </script>
</body>
</html>`;
}
