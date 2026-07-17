//! Bridge script builder - generates window.app Runtime Adapter (Sparo OS Hosted) for iframe.

use crate::product_app_runtime_host_engine::types::{EsmDep, ProductAppRuntimeHostPermissions};
use serde_json;

/// Build the Runtime Adapter script (JS) to inject into the iframe.
/// Exposes window.app with call(), fs.*, shell.*, net.*, os.*, storage.*, dialog.*,
/// ai.*, backend.*, clipboard.*, lifecycle, events.
pub fn build_bridge_script(
    app_id: &str,
    app_data_dir: &str,
    workspace_dir: &str,
    theme: &str,
    platform: &str,
    i18n_messages_json: &str,
    source_revision: &str,
    deps_revision: &str,
    deps_dirty: bool,
    worker_restart_required: bool,
) -> String {
    let app_id_esc = escape_js_str(app_id);
    let app_data_esc = escape_js_str(app_data_dir);
    let workspace_esc = escape_js_str(workspace_dir);
    let theme_esc = escape_js_str(theme);
    let platform_esc = escape_js_str(platform);
    let source_revision_esc = escape_js_str(source_revision);
    let deps_revision_esc = escape_js_str(deps_revision);
    // Product identity is owned by the validated runtime context, not by this host-surface id.
    // Keep the adapter methods generic and enforce the PPT capability in the desktop host.
    let manuscript_api = r#"manuscript: {
        get: (opts) => _call('deck.manuscript.get', { documentId: 'manuscript', ...(opts || {}) }),
        commit: (content, opts) => _call('deck.manuscript.commit', { documentId: 'manuscript', content, ...(opts || {}) }),
      },"#;
    let ppt_backend_api = r#"cancelStaleRuns: () => _rpc('backend.cancelStaleRuns', {}),
      turnText: (sessionId, turnId, opts) => _rpc('backend.turnText', { sessionId, turnId, ...(opts || {}) }),"#;

    format!(
        r#"
(function() {{
  const _rpc = (method, params) => {{
    return new Promise((resolve, reject) => {{
      const id = 'rpc-' + Math.random().toString(36).slice(2) + '-' + Date.now();
      const handler = (e) => {{
        if (!e.data || e.data.id !== id) return;
        window.removeEventListener('message', handler);
        if (e.data.error) {{
          const error = new Error(e.data.error.message || 'RPC error');
          error.source = method;
          error.rpcParams = params;
          reject(error);
        }} else resolve(e.data.result);
      }};
      window.addEventListener('message', handler);
      window.parent.postMessage({{ jsonrpc: '2.0', id, method, params }}, '*');
    }});
  }};

  const _call = (method, params) => _rpc('worker.call', {{ method, params: params || {{}} }});

  function _reportRuntimeIssue(issue) {{
    try {{
      window.parent.postMessage({{
        method: 'sparo/runtime-error',
        params: {{
          appId: {app_id_esc},
          severity: issue && issue.severity ? issue.severity : 'fatal',
          message: issue && issue.message ? String(issue.message) : 'Unknown runtime error',
          source: issue && issue.source ? String(issue.source) : undefined,
          stack: issue && issue.stack ? String(issue.stack) : undefined,
          category: issue && issue.category ? String(issue.category) : 'runtime',
          timestampMs: Date.now(),
        }},
      }}, '*');
    }} catch (_) {{}}
  }}

  function _safeJson(value) {{
    try {{
      return JSON.stringify(value);
    }} catch (_) {{
      return String(value);
    }}
  }}

  function _formatConsoleArgs(args) {{
    return Array.from(args || []).map((arg) => {{
      if (arg instanceof Error) return arg.stack || arg.message || String(arg);
      if (typeof arg === 'string') return arg;
      return _safeJson(arg);
    }}).join(' ');
  }}

  function _reportRuntimeLog(entry) {{
    try {{
      window.parent.postMessage({{
        method: 'sparo/runtime-log',
        params: {{
          appId: {app_id_esc},
          level: entry && entry.level ? entry.level : 'info',
          category: entry && entry.category ? String(entry.category) : 'runtime',
          message: entry && entry.message ? String(entry.message) : '',
          source: entry && entry.source ? String(entry.source) : undefined,
          stack: entry && entry.stack ? String(entry.stack) : undefined,
          details: entry && entry.details !== undefined ? entry.details : undefined,
          timestampMs: Date.now(),
        }},
      }}, '*');
    }} catch (_) {{}}
  }}

  if (!window.console) window.console = {{}};
  const _console = window.console;
  for (const level of ['warn', 'error']) {{
    const original = typeof _console[level] === 'function' ? _console[level].bind(_console) : null;
    window.console[level] = function(...args) {{
      if (original) original(...args);
      _reportRuntimeLog({{
        level: level === 'error' ? 'error' : 'warn',
        category: 'console',
        message: _formatConsoleArgs(args),
      }});
    }};
  }}

  window.addEventListener('error', (event) => {{
    _reportRuntimeIssue({{
      severity: 'fatal',
      message: event && event.message ? event.message : 'Uncaught error',
      source: event && event.filename ? event.filename + ':' + event.lineno + ':' + event.colno : undefined,
      stack: event && event.error && event.error.stack ? event.error.stack : undefined,
      category: 'window.error',
    }});
  }});

  window.addEventListener('unhandledrejection', (event) => {{
    const reason = event && event.reason;
    _reportRuntimeIssue({{
      severity: 'fatal',
      message: reason && reason.message ? reason.message : String(reason || 'Unhandled promise rejection'),
      stack: reason && reason.stack ? reason.stack : undefined,
      category: 'unhandledrejection',
    }});
  }});

  function _applyThemeVars(vars) {{
    if (!vars || typeof vars !== 'object') return;
    const root = document.documentElement.style;
    for (const k of Object.keys(vars)) root.setProperty(k, vars[k]);
  }}

  let _theme = {theme_esc};
  // Default to en-US until the host pushes the real locale via 'sparo:event'.
  // The script below proactively requests it on startup.
  let _locale = 'en-US';
  const _i18nMessagesRaw = {i18n_messages_json};
  let _i18nMessages = (_i18nMessagesRaw && typeof _i18nMessagesRaw === 'object' && !Array.isArray(_i18nMessagesRaw)) ? _i18nMessagesRaw : {{}};

  function _i18nLookup(messages, locale, key) {{
    if (!messages || typeof messages !== 'object' || !key) return undefined;
    const table = messages[locale] || messages['en-US'] || messages['zh-CN'];
    if (!table || typeof table !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    return key.split('.').reduce((cursor, part) => {{
      if (cursor && typeof cursor === 'object' && Object.prototype.hasOwnProperty.call(cursor, part)) return cursor[part];
      return undefined;
    }}, table);
  }}

  function _formatI18n(value, params) {{
    if (value == null) return undefined;
    let text = String(value);
    if (!params || typeof params !== 'object') return text;
    return text.replace(/\{{\{{\s*([\w.-]+)\s*\}}\}}/g, (_, key) => {{
      const replacement = params[key];
      return replacement == null ? '' : String(replacement);
    }});
  }}

  function _translate(key, params, fallback) {{
    const value = _i18nLookup(_i18nMessages, _locale, key);
    if (value != null) return _formatI18n(value, params);
    return fallback != null ? String(fallback) : String(key || '');
  }}

  const app = {{
    get theme() {{ return _theme; }},
    get locale() {{ return _locale; }},
    appId: {app_id_esc},
    appDataDir: {app_data_esc},
    workspaceDir: {workspace_esc},
    platform: {platform_esc},
    mode: 'hosted',

    call: _call,

    fs: {{
      readFile:   (p, opts) => _call('fs.readFile', {{ path: p, ...(opts||{{}}) }}),
      writeFile:  (p, data, opts) => _call('fs.writeFile', {{ path: p, data: typeof data === 'string' ? data : (data && data.toString ? data.toString() : ''), ...(opts||{{}}) }}),
      readdir:    (p, opts) => _call('fs.readdir', {{ path: p, ...(opts||{{}}) }}),
      stat:       (p) => _call('fs.stat', {{ path: p }}),
      mkdir:      (p, opts) => _call('fs.mkdir', {{ path: p, ...(opts||{{}}) }}),
      rm:         (p, opts) => _call('fs.rm', {{ path: p, ...(opts||{{}}) }}),
      copyFile:   (s, d) => _call('fs.copyFile', {{ src: s, dst: d }}),
      rename:     (o, n) => _call('fs.rename', {{ oldPath: o, newPath: n }}),
      appendFile: (p, data) => _call('fs.appendFile', {{ path: p, data: typeof data === 'string' ? data : String(data) }}),
    }},
    shell: {{ exec: (cmd, opts) => _call('shell.exec', {{ command: cmd, ...(opts||{{}}) }}) }},
    net:   {{ fetch: (url, opts) => _call('net.fetch', {{ url: typeof url === 'string' ? url : (url && url.url), ...(opts||{{}}) }}) }},
    os:    {{ info: () => _call('os.info', {{}}) }},
    storage: {{
      get: (key) => _call('storage.get', {{ key }}),
      set: (key, value) => _call('storage.set', {{ key, value }}),
    }},

    log: {{
      debug: (message, details) => _reportRuntimeLog({{ level: 'debug', category: 'app', message, details }}),
      info:  (message, details) => _reportRuntimeLog({{ level: 'info', category: 'app', message, details }}),
      warn:  (message, details) => _reportRuntimeLog({{ level: 'warn', category: 'app', message, details }}),
      error: (message, details) => _reportRuntimeLog({{ level: 'error', category: 'app', message, details }}),
    }},

    dialog: {{
      open:    (opts) => _rpc('dialog.open', opts || {{}}),
      save:    (opts) => _rpc('dialog.save', opts || {{}}),
      message: (opts) => _rpc('dialog.message', opts || {{}}),
    }},

    // AI namespace - proxies to host application AI client (no API key exposure).
    _aiStreams: {{}},
    ai: {{
      complete: (prompt, opts) => _rpc('ai.complete', {{ prompt, ...(opts || {{}}) }}),
      chat: (messages, opts) => {{
        const streamId = 'ai-stream-' + Math.random().toString(36).slice(2) + '-' + Date.now();
        const handlers = {{
          onChunk: opts && opts.onChunk,
          onDone:  opts && opts.onDone,
          onError: opts && opts.onError,
        }};
        app._aiStreams[streamId] = handlers;
        const rpcOpts = {{}};
        if (opts) {{
          if (opts.systemPrompt !== undefined) rpcOpts.systemPrompt = opts.systemPrompt;
          if (opts.model !== undefined) rpcOpts.model = opts.model;
          if (opts.maxTokens !== undefined) rpcOpts.maxTokens = opts.maxTokens;
          if (opts.temperature !== undefined) rpcOpts.temperature = opts.temperature;
        }}
        return _rpc('ai.chat', {{ messages, streamId, ...rpcOpts }}).then((result) => ({{
          streamId: result && result.streamId ? result.streamId : streamId,
          cancel: () => _rpc('ai.cancel', {{ streamId }}),
        }}));
      }},
      cancel:    (streamId) => _rpc('ai.cancel', {{ streamId }}),
      getModels: () => _rpc('ai.getModels', {{}}),
    }},

    // Backend namespace - invokes declared Agent Component service actions.
    backend: {{
      call: (target, input, opts) => _rpc('backend.call', {{ target, input, ...(opts || {{}}) }}),
      cancel: (sessionId, turnId) => _rpc('backend.cancel', {{ sessionId, turnId }}),
      status: (actionRunId, opts) => _rpc('backend.status', {{ actionRunId, ...(opts || {{}}) }}),
      cancelRun: (actionRunId, opts) => _rpc('backend.cancelRun', {{ actionRunId, ...(opts || {{}}) }}),
      {ppt_backend_api}
      onEvent: (fn) => app.on('backend:event', fn),
      offEvent: (fn) => app.off('backend:event', fn),
    }},
    host: {{
      fillChatInput: (text) => _rpc('host.fillChatInput', {{ text }}),
      syncSpreadsheetFocus: (payload) => _rpc('host.syncSpreadsheetFocus', {{ payload: payload || {{}} }}),
      addContext: (payload) => _rpc('host.addContext', {{ payload: payload || {{}} }}),
      setPanelMode: (mode) => _rpc('host.setPanelMode', {{ mode }}),
    }},
    deck: {{
      renderPage: (opts) => _rpc('sparo.deck.renderPage', opts || {{}}),
      {manuscript_api}
    }},
    // Clipboard namespace - proxies to host navigator.clipboard (bypasses sandbox restriction).
    clipboard: {{
      writeText: (text) => _rpc('clipboard.writeText', {{ text }}),
      readText:  () => _rpc('clipboard.readText', {{}}),
    }},

    _lifecycleHandlers: {{ activate: [], deactivate: [], themeChange: [], localeChange: [] }},
    onActivate:    (fn) => app._lifecycleHandlers.activate.push(fn),
    onDeactivate:  (fn) => app._lifecycleHandlers.deactivate.push(fn),
    onThemeChange: (fn) => app._lifecycleHandlers.themeChange.push(fn),
    /// Subscribe to host locale changes. Callback receives the locale id (e.g. "zh-CN").
    onLocaleChange: (fn) => app._lifecycleHandlers.localeChange.push(fn),

    i18n: {{
      get locale() {{ return _locale; }},
      get messages() {{ return _i18nMessages; }},
      setMessages: (messages) => {{
        if (messages && typeof messages === 'object') {{
          for (const locale of Object.keys(messages)) _i18nMessages[locale] = messages[locale];
        }}
      }},
      t: (key, params, fallback) => _translate(key, params, fallback),
      onChange: (fn) => app.onLocaleChange(fn),
    }},

    /// Pick the best-matching string from an i18n table for the current locale.
    /// Resolution: current -> en-US -> zh-CN -> first value -> fallback.
    /// Usage: app.t({{'en-US':'Hello','zh-CN':'Hello'}}, 'Hello')
    t: (table, fallback) => {{
      if (!table || typeof table !== 'object') return fallback != null ? fallback : '';
      if (table[_locale]) return table[_locale];
      if (table['en-US']) return table['en-US'];
      if (table['zh-CN']) return table['zh-CN'];
      const keys = Object.keys(table);
      if (keys.length) return table[keys[0]];
      return fallback != null ? fallback : '';
    }},

    _eventHandlers: {{}},
    on:  (event, fn) => {{ (app._eventHandlers[event] = app._eventHandlers[event] || []).push(fn); }},
    off: (event, fn) => {{
      if (app._eventHandlers[event])
        app._eventHandlers[event] = app._eventHandlers[event].filter(f => f !== fn);
    }},
  }};

  function _parentOriginFromReferrer() {{
    try {{
      if (!document.referrer) return null;
      const referrer = new URL(document.referrer);
      return referrer.origin !== 'null'
        ? referrer.origin
        : referrer.protocol + '//' + referrer.host;
    }} catch (_) {{
      return null;
    }}
  }}

  function _isTrustedHostEvent(e) {{
    if (e.source === window.parent) return true;
    const parentOrigin = _parentOriginFromReferrer();
    return Boolean(parentOrigin && e.origin === parentOrigin);
  }}

  window.addEventListener('message', (e) => {{
    if (!_isTrustedHostEvent(e)) return;
    if (e.data?.type === 'sparo:event') {{
      const {{ event, payload }} = e.data;
      if (event === 'runtimeReadyProbe') {{
        _reportRuntimeReady();
        return;
      }}
      if (event === 'runtimeInteractionProbe') {{
        _reportRuntimeInteractionProbe();
        return;
      }}
      if (event === 'runtimeUserPathRehearsal') {{
        _reportRuntimeUserPathRehearsal(payload);
        return;
      }}
      if (event === 'activate')    app._lifecycleHandlers.activate.forEach(f => f());
      if (event === 'deactivate')  app._lifecycleHandlers.deactivate.forEach(f => f());
      if (event === 'themeChange') {{
        if (payload && typeof payload === 'object') {{
          if (payload.vars) _applyThemeVars(payload.vars);
          if (payload.type) {{ _theme = payload.type; document.documentElement.setAttribute('data-theme-type', _theme); }}
        }}
        app._lifecycleHandlers.themeChange.forEach(f => f(payload));
        (app._eventHandlers[event] || []).forEach(f => f(payload));
      }} else if (event === 'localeChange') {{
        if (payload && typeof payload === 'object' && typeof payload.locale === 'string') {{
          _locale = payload.locale;
          document.documentElement.setAttribute('lang', _locale);
        }}
        app._lifecycleHandlers.localeChange.forEach(f => f(_locale));
        (app._eventHandlers[event] || []).forEach(f => f(_locale));
      }} else if (event === 'ai:stream') {{
        // Route AI stream chunks to the registered callbacks
        if (payload && payload.streamId) {{
          const h = app._aiStreams[payload.streamId];
          if (h) {{
            if (payload.type === 'chunk' && h.onChunk) h.onChunk(payload.data || {{}});
            if (payload.type === 'done') {{
              if (h.onDone) h.onDone(payload.data || {{}});
              delete app._aiStreams[payload.streamId];
            }}
            if (payload.type === 'error') {{
              if (h.onError) h.onError(payload.data || {{}});
              delete app._aiStreams[payload.streamId];
            }}
          }}
        }}
      }} else if (event === 'worker:event') {{
        // Forward Worker push events to registered app.on('worker:*', ...) handlers
        if (payload && payload.event) {{
          const evtKey = 'worker:' + payload.event;
          (app._eventHandlers[evtKey] || []).forEach(f => f(payload.data));
          (app._eventHandlers['worker:*'] || []).forEach(f => f(payload.event, payload.data));
        }}
      }} else {{
        (app._eventHandlers[event] || []).forEach(f => f(payload));
      }}
    }}
  }});

  function _collectRuntimeReadyMetrics() {{
    try {{
      const body = document.body;
      const root = document.documentElement;
      const visibleElementCount = body ? Array.from(body.querySelectorAll('*')).filter((el) => {{
        if (!el.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }}).length : 0;
      return {{
        bodyChildCount: body ? body.children.length : 0,
        visibleElementCount,
        interactiveElementCount: body ? body.querySelectorAll(_interactiveElementSelector()).length : 0,
        viewportWidth: window.innerWidth || (root ? root.clientWidth : 0) || 0,
        viewportHeight: window.innerHeight || (root ? root.clientHeight : 0) || 0,
        scrollWidth: root ? root.scrollWidth : 0,
        scrollHeight: root ? root.scrollHeight : 0,
      }};
    }} catch (_) {{
      return null;
    }}
  }}

  function _interactiveElementSelector() {{
    return 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="menuitem"],[tabindex]:not([tabindex="-1"]),[data-action],[data-click]';
  }}

  function _isVisibleInteractionCandidate(el) {{
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  }}

  function _isDisabledInteractionCandidate(el) {{
    return !!(el && (el.disabled || el.getAttribute('aria-disabled') === 'true'));
  }}

  function _runRuntimeInteractionProbe() {{
    const result = {{
      candidateCount: 0,
      probed: false,
      focused: false,
      restoredFocus: false,
    }};
    try {{
      const body = document.body;
      if (!body) return result;
      const candidates = Array.from(body.querySelectorAll(_interactiveElementSelector()))
        .filter((el) => _isVisibleInteractionCandidate(el) && !_isDisabledInteractionCandidate(el));
      result.candidateCount = candidates.length;
      const target = candidates[0];
      if (!target) return result;
      result.probed = true;
      result.targetTag = target.tagName ? target.tagName.toLowerCase() : undefined;
      result.targetRole = target.getAttribute ? target.getAttribute('role') || undefined : undefined;
      result.targetType = target.getAttribute ? target.getAttribute('type') || undefined : undefined;
      const previous = document.activeElement && document.activeElement.focus ? document.activeElement : null;
      if (target.focus) {{
        target.focus({{ preventScroll: true }});
        result.focused = document.activeElement === target || (target.contains && target.contains(document.activeElement));
      }}
      if (previous && previous !== target && previous.focus) {{
        previous.focus({{ preventScroll: true }});
        result.restoredFocus = document.activeElement === previous;
      }} else if (target.blur) {{
        target.blur();
        result.restoredFocus = document.activeElement !== target;
      }}
      return result;
    }} catch (error) {{
      result.error = error && error.message ? String(error.message) : String(error);
      return result;
    }}
  }}

  function _sleep(ms) {{
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }}

  function _cssEscape(value) {{
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }}

  function _querySafe(selector) {{
    try {{
      return document.querySelector(selector);
    }} catch (_) {{
      return null;
    }}
  }}

  function _visibleInteractiveCandidates() {{
    const body = document.body;
    if (!body) return [];
    return Array.from(body.querySelectorAll(_interactiveElementSelector()))
      .filter((el) => _isVisibleInteractionCandidate(el) && !_isDisabledInteractionCandidate(el));
  }}

  function _elementSummary(el) {{
    if (!el) return {{}};
    const attributes = {{}};
    for (const name of [
      'data-preview-phase',
      'data-project-phase',
      'data-detection-status',
      'data-error',
      'data-actual-frame',
      'data-actual-playing',
      'data-frame-state',
      'data-inspect-mode',
      'data-buffering',
      'data-seeking',
      'data-player-host-ready',
      'data-player-connection-state',
      'data-player-channel-connected',
      'aria-pressed',
      'aria-busy',
    ]) {{
      if (el.hasAttribute && el.hasAttribute(name)) attributes[name] = el.getAttribute(name);
    }}
    return {{
      targetTag: el.tagName ? el.tagName.toLowerCase() : undefined,
      targetRole: el.getAttribute ? el.getAttribute('role') || undefined : undefined,
      targetType: el.getAttribute ? el.getAttribute('type') || undefined : undefined,
      value: 'value' in el ? String(el.value ?? '') : undefined,
      attributes,
    }};
  }}

  function _normalizeExpectationText(value) {{
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }}

  function _elementText(el) {{
    if (!el) return '';
    const aria = el.getAttribute ? el.getAttribute('aria-label') || '' : '';
    const text = typeof el.innerText === 'string' ? el.innerText : (el.textContent || '');
    return _normalizeExpectationText(aria + ' ' + text);
  }}

  function _expectationEvidenceText(target) {{
    return _normalizeExpectationText([
      _elementText(target),
      document.body ? _elementText(document.body) : '',
      document.title || '',
    ].join(' '));
  }}

  function _evaluateStepExpectations(step, target) {{
    const expectations = step && Array.isArray(step.expect)
      ? step.expect.filter((value) => typeof value === 'string' && value.trim().length > 0)
      : [];
    const result = {{
      expectationCount: expectations.length,
      verifiedExpectationCount: 0,
      failedExpectations: [],
    }};
    if (expectations.length === 0) return result;
    const evidenceText = _expectationEvidenceText(target);
    for (const expectation of expectations) {{
      const normalized = _normalizeExpectationText(expectation);
      if (normalized && evidenceText.includes(normalized)) {{
        result.verifiedExpectationCount += 1;
      }} else {{
        result.failedExpectations.push(expectation);
      }}
    }}
    return result;
  }}

  function _applyStepExpectationEvidence(step, target, result) {{
    const evidence = _evaluateStepExpectations(step, target);
    result.expectationCount = evidence.expectationCount;
    result.verifiedExpectationCount = evidence.verifiedExpectationCount;
    if (evidence.failedExpectations.length > 0) {{
      result.failedExpectations = evidence.failedExpectations;
    }}
    if (result.status === 'passed' && evidence.expectationCount > evidence.verifiedExpectationCount) {{
      result.status = 'notVerified';
      result.detail = (result.detail ? result.detail + ' ' : '') +
        'Expectations verified ' + evidence.verifiedExpectationCount + '/' + evidence.expectationCount + '.';
    }} else if (evidence.expectationCount > 0) {{
      result.detail = (result.detail ? result.detail + ' ' : '') +
        'Expectations verified ' + evidence.verifiedExpectationCount + '/' + evidence.expectationCount + '.';
    }}
    return result;
  }}

  function _findRehearsalTarget(target, action) {{
    const normalized = typeof target === 'string' ? target.trim() : '';
    const lower = normalized.toLowerCase();
    if (!normalized || lower === 'first interactive control' || lower === 'first-interactive-control') {{
      const interactive = _visibleInteractiveCandidates();
      if (action === 'type') {{
        return interactive.find((el) => {{
          const tag = el.tagName ? el.tagName.toLowerCase() : '';
          return tag === 'input' || tag === 'textarea' || el.isContentEditable;
        }}) || interactive[0] || null;
      }}
      return interactive[0] || null;
    }}
    if (lower === 'primary-surface' || lower === 'app' || lower === 'root') {{
      return _querySafe('[data-sparo-root],main,#app,#root') || document.body || document.documentElement;
    }}
    if (normalized.startsWith('css:')) {{
      const byCss = _querySafe(normalized.slice(4).trim());
      if (byCss) return byCss;
    }}
    const escaped = _cssEscape(normalized);
    return _querySafe('[data-testid="' + escaped + '"]')
      || _querySafe('[data-action="' + escaped + '"]')
      || _querySafe('#' + escaped)
      || _querySafe('[name="' + escaped + '"]')
      || _querySafe('[aria-label="' + escaped + '"]');
  }}

  function _statusFromBoolean(ok) {{
    return ok ? 'passed' : 'failed';
  }}

  async function _runRehearsalStep(step) {{
    const action = step && typeof step.action === 'string' ? step.action : 'observe';
    const targetName = step && typeof step.target === 'string' ? step.target : undefined;
    const result = {{
      id: step && typeof step.id === 'string' ? step.id : action,
      action,
      target: targetName,
      status: 'notVerified',
    }};
    try {{
      if (action === 'open') {{
        const metrics = _collectRuntimeReadyMetrics();
        const opened = !!(document.body && metrics && (metrics.bodyChildCount > 0 || metrics.visibleElementCount > 0));
        const openTarget = _findRehearsalTarget(targetName, action) || document.body || document.documentElement;
        Object.assign(result, _elementSummary(openTarget));
        result.status = _statusFromBoolean(opened);
        result.detail = opened ? 'Runtime document is open with a visible root.' : 'Runtime document did not expose a visible root.';
        if (opened) _applyStepExpectationEvidence(step, openTarget, result);
        return result;
      }}

      const target = _findRehearsalTarget(targetName, action);
      Object.assign(result, _elementSummary(target));
      if (!target) {{
        result.status = 'failed';
        result.detail = 'Target was not found in the runtime DOM.';
        return result;
      }}

      if (action === 'observe') {{
        const visible = _isVisibleInteractionCandidate(target);
        result.status = _statusFromBoolean(visible);
        result.detail = visible ? 'Target is visible in the runtime DOM.' : 'Target is not visible in the runtime DOM.';
      }} else if (action === 'wait') {{
        const durationMs = Math.max(0, Math.min(10_000, Number(step && step.durationMs) || 0));
        await _sleep(durationMs);
        result.status = 'passed';
        result.detail = 'Waited ' + durationMs + 'ms.';
        Object.assign(result, _elementSummary(target));
      }} else if (action === 'focus') {{
        if (!target.focus) {{
          result.status = 'failed';
          result.detail = 'Target does not support focus.';
        }} else {{
          target.focus({{ preventScroll: true }});
          result.focused = document.activeElement === target || (target.contains && target.contains(document.activeElement));
          result.status = _statusFromBoolean(result.focused);
          result.detail = result.focused ? 'Target accepted focus.' : 'Target did not become focused.';
        }}
      }} else if (action === 'click') {{
        if (!target.click) {{
          result.status = 'failed';
          result.detail = 'Target does not support click.';
        }} else {{
          target.click();
          result.status = 'passed';
          result.detail = 'Target click was dispatched.';
        }}
      }} else if (action === 'type') {{
        const value = step && typeof step.value === 'string' ? step.value : '';
        const tag = target.tagName ? target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea') {{
          target.focus && target.focus({{ preventScroll: true }});
          target.value = value;
          target.dispatchEvent(new Event('input', {{ bubbles: true }}));
          target.dispatchEvent(new Event('change', {{ bubbles: true }}));
          result.status = 'passed';
          result.detail = 'Text input events were dispatched.';
        }} else if (target.isContentEditable) {{
          target.focus && target.focus({{ preventScroll: true }});
          target.textContent = value;
          target.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: value }}));
          result.status = 'passed';
          result.detail = 'Contenteditable input event was dispatched.';
        }} else {{
          result.status = 'failed';
          result.detail = 'Target is not text-editable.';
        }}
      }} else if (action === 'submit') {{
        const form = target.tagName && target.tagName.toLowerCase() === 'form'
          ? target
          : (target.closest ? target.closest('form') : null) || document.querySelector('form');
        if (form) {{
          if (form.requestSubmit) form.requestSubmit();
          else form.dispatchEvent(new Event('submit', {{ bubbles: true, cancelable: true }}));
          result.status = 'passed';
          result.detail = 'Form submit was dispatched.';
        }} else {{
          const submitTarget = target.matches && target.matches('button,input,[role="button"]') ? target : _visibleInteractiveCandidates()[0];
          if (submitTarget && submitTarget.click) {{
            submitTarget.click();
            Object.assign(result, _elementSummary(submitTarget));
            result.status = 'passed';
            result.detail = 'Submit fallback click was dispatched.';
          }} else {{
            result.status = 'failed';
            result.detail = 'No form or submit target was available.';
          }}
        }}
      }} else {{
        result.status = 'failed';
        result.detail = 'Unsupported rehearsal action.';
      }}
      await _sleep(16);
      if (result.status === 'passed') _applyStepExpectationEvidence(step, target, result);
      return result;
    }} catch (error) {{
      result.status = 'failed';
      result.error = error && error.message ? String(error.message) : String(error);
      return result;
    }}
  }}

  async function _runRuntimeUserPathRehearsal(plan) {{
    const scenarios = plan && Array.isArray(plan.scenarios) ? plan.scenarios : [];
    const selected = scenarios.filter((scenario) => {{
      const kind = scenario && typeof scenario.kind === 'string' ? scenario.kind : 'user-path';
      return kind === 'user-path';
    }});
    const summary = {{
      scenarioCount: selected.length,
      stepCount: 0,
      passedStepCount: 0,
      failedStepCount: 0,
      notVerifiedStepCount: 0,
      expectationCount: 0,
      verifiedExpectationCount: 0,
      failedExpectationCount: 0,
    }};
    const scenarioResults = [];
    for (const scenario of selected) {{
      const steps = scenario && Array.isArray(scenario.steps) ? scenario.steps : [];
      const stepResults = [];
      for (const step of steps) {{
        const result = await _runRehearsalStep(step);
        stepResults.push(result);
        summary.stepCount += 1;
        if (result.status === 'passed') summary.passedStepCount += 1;
        else if (result.status === 'failed' || result.status === 'blocked') summary.failedStepCount += 1;
        else summary.notVerifiedStepCount += 1;
        summary.expectationCount += result.expectationCount || 0;
        summary.verifiedExpectationCount += result.verifiedExpectationCount || 0;
        summary.failedExpectationCount += result.failedExpectations && result.failedExpectations.length
          ? result.failedExpectations.length
          : Math.max(0, (result.expectationCount || 0) - (result.verifiedExpectationCount || 0));
      }}
      scenarioResults.push({{
        id: scenario && typeof scenario.id === 'string' ? scenario.id : 'scenario',
        kind: scenario && typeof scenario.kind === 'string' ? scenario.kind : 'user-path',
        stepCount: steps.length,
        steps: stepResults,
      }});
    }}
    summary.status = summary.scenarioCount > 0
      && summary.stepCount > 0
      && summary.expectationCount > 0
      && summary.verifiedExpectationCount === summary.expectationCount
      && summary.failedExpectationCount === 0
      && summary.failedStepCount === 0
      && summary.notVerifiedStepCount === 0
      ? 'passed'
      : summary.failedStepCount > 0
        ? 'failed'
        : 'notVerified';
    return {{
      status: summary.status,
      summary,
      scenarios: scenarioResults,
    }};
  }}

  async function _reportRuntimeUserPathRehearsal(plan) {{
    try {{
      const result = await _runRuntimeUserPathRehearsal(plan);
      window.parent.postMessage({{
        method: 'sparo/user-path-rehearsal',
        params: {{
          appId: {app_id_esc},
          requestId: plan && typeof plan.requestId === 'string' ? plan.requestId : undefined,
          route: window.location && window.location.hash ? window.location.hash : undefined,
          result,
          timestampMs: Date.now(),
        }},
      }}, '*');
    }} catch (error) {{
      window.parent.postMessage({{
        method: 'sparo/user-path-rehearsal',
        params: {{
          appId: {app_id_esc},
          requestId: plan && typeof plan.requestId === 'string' ? plan.requestId : undefined,
          route: window.location && window.location.hash ? window.location.hash : undefined,
          result: {{
            status: 'failed',
            summary: {{ scenarioCount: 0, stepCount: 0, passedStepCount: 0, failedStepCount: 1, notVerifiedStepCount: 0, expectationCount: 0, verifiedExpectationCount: 0, failedExpectationCount: 0 }},
            error: error && error.message ? String(error.message) : String(error),
          }},
          timestampMs: Date.now(),
        }},
      }}, '*');
    }}
  }}

  function _reportRuntimeInteractionProbe() {{
    try {{
      window.parent.postMessage({{
        method: 'sparo/interaction-probe',
        params: {{
          appId: {app_id_esc},
          route: window.location && window.location.hash ? window.location.hash : undefined,
          probe: _runRuntimeInteractionProbe(),
          timestampMs: Date.now(),
        }},
      }}, '*');
    }} catch (_) {{}}
  }}

  function _reportRuntimeReady() {{
    try {{
      window.parent.postMessage({{
        method: 'sparo/runtime-ready',
        params: {{
          appId: {app_id_esc},
          hostSurfaceId: {app_id_esc},
          sourceRevision: {source_revision_esc},
          depsRevision: {deps_revision_esc},
          depsDirty: {deps_dirty},
          workerRestartRequired: {worker_restart_required},
          readyState: document.readyState,
          route: window.location && window.location.hash ? window.location.hash : undefined,
          metrics: _collectRuntimeReadyMetrics(),
          timestampMs: Date.now(),
        }},
      }}, '*');
    }} catch (_) {{}}
  }}

  window.app = app;
  document.documentElement.setAttribute('data-theme-type', _theme);
  window.parent.postMessage({{ method: 'sparo/request-theme' }}, '*');
  window.parent.postMessage({{ method: 'sparo/request-locale' }}, '*');
  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', _reportRuntimeReady, {{ once: true }});
  }} else {{
    _reportRuntimeReady();
  }}
}})();
"#,
        app_id_esc = app_id_esc,
        app_data_esc = app_data_esc,
        workspace_esc = workspace_esc,
        theme_esc = theme_esc,
        platform_esc = platform_esc,
        source_revision_esc = source_revision_esc,
        deps_revision_esc = deps_revision_esc,
        deps_dirty = deps_dirty,
        worker_restart_required = worker_restart_required,
        manuscript_api = manuscript_api,
        ppt_backend_api = ppt_backend_api,
        i18n_messages_json = i18n_messages_json
    )
}

fn escape_js_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Build Import Map script tag from ESM dependencies (esm.sh URLs).
pub fn build_import_map(deps: &[EsmDep]) -> String {
    let mut imports = serde_json::Map::new();
    for dep in deps {
        let url = dep.url.clone().unwrap_or_else(|| match &dep.version {
            Some(v) => format!("https://esm.sh/{}@{}", dep.name, v),
            None => format!("https://esm.sh/{}", dep.name),
        });
        imports.insert(dep.name.clone(), serde_json::Value::String(url));
    }
    let json = serde_json::json!({ "imports": imports });
    format!(r#"<script type="importmap">{}</script>"#, json)
}

/// Build CSP meta content from permissions (net.allow → connect-src).
pub fn build_csp_content(permissions: &ProductAppRuntimeHostPermissions) -> String {
    let net_allow = permissions
        .net
        .as_ref()
        .and_then(|n| n.allow.as_ref())
        .map(|v| v.iter().map(|d| d.as_str()).collect::<Vec<_>>())
        .unwrap_or_default();

    let external_src = if net_allow.is_empty() {
        "'self'".to_string()
    } else if net_allow.contains(&"*") {
        "'self' *".to_string()
    } else {
        let safe: Vec<String> = net_allow
            .iter()
            .map(|d| {
                d.replace('&', "&amp;")
                    .replace('<', "&lt;")
                    .replace('>', "&gt;")
                    .replace('"', "&quot;")
            })
            .collect();
        format!("'self' https://esm.sh {}", safe.join(" "))
    };

    format!(
        "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: https:; style-src 'self' 'unsafe-inline' https:; connect-src {}; frame-src {}; child-src {}; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data: https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self';",
        external_src, external_src, external_src
    )
}

/// Scroll boundary script (reuse same logic as MCP App).
pub fn scroll_boundary_script() -> &'static str {
    r#"<script>(()=>{const d=()=>document.documentElement?.dataset?.sparoScrollBoundary==='none'||document.body?.dataset?.sparoScrollBoundary==='none';const s=(e)=>{for(let n=e.target;n;n=n.parentNode){if(!(n instanceof Element))continue;if(n===document.documentElement||n===document.body)continue;const o=window.getComputedStyle(n).overflowY;if(o==='hidden'||o==='visible')continue;if(e.deltaY<0&&n.scrollTop>0)return false;if(e.deltaY>0&&n.scrollTop+n.clientHeight<n.scrollHeight)return false;}return true};window.addEventListener('wheel',e=>{if(d())return;if(!e.defaultPrevented&&s(e))window.parent.postMessage({jsonrpc:'2.0',method:'sparo/sandbox-wheel',params:{deltaX:e.deltaX,deltaY:e.deltaY,deltaZ:e.deltaZ,deltaMode:e.deltaMode}},'*')},{passive:true});})();</script>"#
}

/// Preview element inspector script.
///
/// Runs inside the sandboxed iframe and implements a DevTools-like element
/// picker: hover/click are measured against the iframe DOM itself, while the
/// host only receives bounded, redacted element summaries.
pub fn preview_element_inspector_script(app_id: &str) -> String {
    let app_id_esc = escape_js_str(app_id);
    r#"<script id="sparo-preview-element-inspector-script">
(()=> {
  const APP_ID = __APP_ID__;
  const MAX_TEXT = 180;
  const MAX_ATTR = 140;
  const SAFE_ATTRS = new Set(['id','class','role','aria-label','aria-description','title','alt','type','name','placeholder','href','data-testid','data-name']);
  const SENSITIVE_ATTRS = new Set(['value','password','token','secret','apikey','api-key','authorization','cookie','set-cookie']);
  const BLOCKED_TAGS = new Set(['html','body','head','script','style','meta','link','noscript','template']);
  const OVERLAY_ID = 'sparo-preview-element-inspector-overlay';
  let enabled = false;
  let listenersAttached = false;
  let currentRoute = '/';
  let currentElement = null;
  let lastHoverKey = '';
  let overlayRoot = null;
  let overlayBox = null;
  let overlayTooltip = null;

  function trimText(value, max = MAX_TEXT) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function isSensitiveAttribute(name) {
    const lower = String(name || '').toLowerCase();
    if (SENSITIVE_ATTRS.has(lower)) return true;
    return lower.includes('password') || lower.includes('token') || lower.includes('secret') || lower.includes('key');
  }

  function attributeSummary(element) {
    const summary = {};
    for (const name of element.getAttributeNames ? element.getAttributeNames() : []) {
      const lower = name.toLowerCase();
      if (isSensitiveAttribute(lower)) continue;
      if (!SAFE_ATTRS.has(lower) && !lower.startsWith('aria-')) continue;
      const value = element.getAttribute(name);
      if (!value) continue;
      if (lower === 'href' && /^\s*javascript:/i.test(value)) continue;
      summary[name] = trimText(value, MAX_ATTR);
    }
    return summary;
  }

  function inferredRole(element) {
    const explicit = element.getAttribute('role');
    if (explicit) return trimText(explicit, 48);
    const tag = element.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && element.getAttribute('href')) return 'link';
    if (tag === 'input') return `${element.getAttribute('type') || 'text'} input`;
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    return undefined;
  }

  function elementLabel(element) {
    const direct = element.getAttribute('aria-label')
      || element.getAttribute('title')
      || element.getAttribute('alt')
      || element.getAttribute('data-name')
      || element.getAttribute('data-testid')
      || element.getAttribute('placeholder')
      || element.getAttribute('name');
    return trimText(direct || element.textContent || element.tagName.toLowerCase(), MAX_TEXT);
  }

  function selectorPart(element) {
    const tag = element.tagName.toLowerCase();
    const id = element.getAttribute('id');
    if (id) return `${tag}#${cssEscape(id)}`;
    const classes = typeof element.className === 'string'
      ? element.className.split(/\s+/).filter(Boolean).slice(0, 2)
      : [];
    let part = tag + classes.map((item) => `.${cssEscape(item)}`).join('');
    const parent = element.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(element) + 1})`;
    }
    return part;
  }

  function selectorPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 8) {
      const tag = current.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') break;
      parts.unshift(selectorPart(current));
      if (current.getAttribute('id')) break;
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function ancestorPath(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 8) {
      const tag = current.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') break;
      parts.unshift({
        tagName: tag,
        selectorPart: selectorPart(current),
        role: inferredRole(current),
        label: elementLabel(current),
      });
      current = current.parentElement;
    }
    return parts;
  }

  function normalizedBox(rect) {
    const width = window.innerWidth || 1;
    const height = window.innerHeight || 1;
    const left = Math.max(0, Math.min(width, rect.left));
    const top = Math.max(0, Math.min(height, rect.top));
    const right = Math.max(0, Math.min(width, rect.right));
    const bottom = Math.max(0, Math.min(height, rect.bottom));
    const round = (value) => Math.round(value * 100) / 100;
    return {
      x: round((left / width) * 100),
      y: round((top / height) * 100),
      width: round((Math.max(0, right - left) / width) * 100),
      height: round((Math.max(0, bottom - top) / height) * 100),
    };
  }

  function hashText(value) {
    const text = String(value || '');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  function boxHash(box) {
    return [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 10) / 10).join(':');
  }

  function styleSummary(element) {
    const style = window.getComputedStyle(element);
    return {
      display: style.display,
      position: style.position,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      textAlign: style.textAlign,
    };
  }

  function isSelectableElement(element) {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false;
    if (overlayRoot && (element === overlayRoot || overlayRoot.contains(element))) return false;
    const tag = element.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tag)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
    return true;
  }

  function elementAt(x, y) {
    const candidates = document.elementsFromPoint(Number(x) || 0, Number(y) || 0);
    for (const candidate of candidates) {
      if (isSelectableElement(candidate)) return candidate;
    }
    return null;
  }

  function elementSnapshot(element) {
    const rect = element.getBoundingClientRect();
    const box = normalizedBox(rect);
    const path = selectorPath(element);
    const text = trimText(element.textContent || '');
    const selector = selectorPart(element);
    return {
      element: {
        tagName: element.tagName.toLowerCase(),
        selectorPath: path,
        selectorPart: selector,
        role: inferredRole(element),
        label: elementLabel(element),
        textContent: text,
        attributes: attributeSummary(element),
        normalizedBox: box,
        computedStyleSummary: styleSummary(element),
        ancestorPath: ancestorPath(element),
      },
      fingerprint: {
        selectorPath: path,
        textHash: text ? hashText(text) : undefined,
        boxHash: boxHash(box),
      },
      source: 'iframe-element-inspector',
      confidence: 'high',
      timestamp: Date.now(),
    };
  }

  function ensureOverlay() {
    if (overlayRoot && document.body && document.body.contains(overlayRoot)) return true;
    if (!document.body) return false;

    overlayRoot = document.createElement('div');
    overlayRoot.id = OVERLAY_ID;
    overlayRoot.setAttribute('aria-hidden', 'true');
    overlayRoot.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:layout style paint;';

    overlayBox = document.createElement('div');
    overlayBox.style.cssText = 'position:fixed;display:none;box-sizing:border-box;border:2px solid rgba(96,165,250,0.95);background:rgba(96,165,250,0.12);border-radius:2px;box-shadow:0 0 0 1px rgba(15,23,42,0.65),0 0 0 4px rgba(96,165,250,0.18);';

    overlayTooltip = document.createElement('div');
    overlayTooltip.style.cssText = 'position:fixed;display:none;max-width:320px;padding:3px 6px;border-radius:4px;background:rgba(15,23,42,0.92);color:white;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 18px rgba(0,0,0,0.22);';

    overlayRoot.appendChild(overlayBox);
    overlayRoot.appendChild(overlayTooltip);
    document.body.appendChild(overlayRoot);
    return true;
  }

  function hideOverlay() {
    if (overlayBox) overlayBox.style.display = 'none';
    if (overlayTooltip) overlayTooltip.style.display = 'none';
  }

  function updateOverlay(element, state) {
    if (!element || !ensureOverlay()) {
      hideOverlay();
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      hideOverlay();
      return;
    }
    const label = elementLabel(element);
    const tag = element.tagName.toLowerCase();
    overlayBox.style.display = 'block';
    overlayBox.style.left = `${Math.max(0, rect.left)}px`;
    overlayBox.style.top = `${Math.max(0, rect.top)}px`;
    overlayBox.style.width = `${Math.max(0, rect.width)}px`;
    overlayBox.style.height = `${Math.max(0, rect.height)}px`;
    overlayBox.style.borderStyle = state === 'selected' ? 'solid' : 'dashed';

    overlayTooltip.style.display = 'block';
    overlayTooltip.textContent = label && label !== tag ? `${tag} "${label}"` : tag;
    const tooltipTop = rect.top > 28 ? rect.top - 24 : rect.bottom + 6;
    overlayTooltip.style.left = `${Math.max(4, Math.min(window.innerWidth - 28, rect.left))}px`;
    overlayTooltip.style.top = `${Math.max(4, Math.min(window.innerHeight - 24, tooltipTop))}px`;
  }

  function postInspectorEvent(name, payload) {
    window.parent.postMessage({
      type: 'sparo:preview-element-inspector',
      appId: APP_ID,
      route: currentRoute,
      event: name,
      payload,
    }, '*');
  }

  function updateCurrentElement(element) {
    if (currentElement === element) {
      updateOverlay(element, 'hover');
      return;
    }
    currentElement = element;
    if (!element) {
      lastHoverKey = '';
      hideOverlay();
      postInspectorEvent('hover-cleared', { timestamp: Date.now() });
      return;
    }

    updateOverlay(element, 'hover');
    const snapshot = elementSnapshot(element);
    const hoverKey = `${snapshot.fingerprint.selectorPath}:${snapshot.fingerprint.boxHash}`;
    if (hoverKey !== lastHoverKey) {
      lastHoverKey = hoverKey;
      postInspectorEvent('hover', snapshot);
    }
  }

  function blockInspectorEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  }

  function handlePointerMove(event) {
    if (!enabled) return;
    blockInspectorEvent(event);
    updateCurrentElement(elementAt(event.clientX, event.clientY));
  }

  function handlePointerBlock(event) {
    if (!enabled) return;
    blockInspectorEvent(event);
  }

  function handleClick(event) {
    if (!enabled) return;
    blockInspectorEvent(event);
    const element = currentElement || elementAt(event.clientX, event.clientY);
    if (!element) return;
    updateOverlay(element, 'selected');
    postInspectorEvent('selected', elementSnapshot(element));
  }

  function handleKeyDown(event) {
    if (!enabled || event.key !== 'Escape') return;
    blockInspectorEvent(event);
    setInspectorEnabled(false, currentRoute);
  }

  function handleLayoutChange() {
    if (!enabled || !currentElement) return;
    if (!document.documentElement.contains(currentElement)) {
      updateCurrentElement(null);
      return;
    }
    updateOverlay(currentElement, 'hover');
  }

  function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    document.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    document.addEventListener('pointerdown', handlePointerBlock, { capture: true, passive: false });
    document.addEventListener('pointerup', handlePointerBlock, { capture: true, passive: false });
    document.addEventListener('click', handleClick, { capture: true, passive: false });
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', handleLayoutChange, true);
    window.addEventListener('resize', handleLayoutChange);
  }

  function detachListeners() {
    if (!listenersAttached) return;
    listenersAttached = false;
    document.removeEventListener('pointermove', handlePointerMove, true);
    document.removeEventListener('pointerdown', handlePointerBlock, true);
    document.removeEventListener('pointerup', handlePointerBlock, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('scroll', handleLayoutChange, true);
    window.removeEventListener('resize', handleLayoutChange);
  }

  function setInspectorEnabled(nextEnabled, route) {
    currentRoute = route || currentRoute || '/';
    if (nextEnabled === enabled) {
      if (enabled) ensureOverlay();
      return;
    }
    enabled = Boolean(nextEnabled);
    currentElement = null;
    lastHoverKey = '';

    if (enabled) {
      ensureOverlay();
      attachListeners();
      document.documentElement.style.cursor = 'crosshair';
      postInspectorEvent('enabled', { timestamp: Date.now() });
    } else {
      detachListeners();
      hideOverlay();
      document.documentElement.style.cursor = '';
      postInspectorEvent('disabled', { timestamp: Date.now() });
    }
  }

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.type === 'sparo:event' && data.event === 'previewElementInspectorSetEnabled') {
      const payload = data.payload || {};
      setInspectorEnabled(Boolean(payload.enabled), payload.route || '/');
    }
  });
})();
</script>"#
    .replace("__APP_ID__", &app_id_esc)
}

/// Default theme CSS variables for Product App Runtime Host iframes.
///
/// The host pushes the real theme after the iframe starts, but CSS is evaluated
/// before that postMessage round trip completes. These defaults keep first paint
/// aligned with the compiled `data-theme-type` and expose the canonical
/// `--sparo-*` namespace.
pub fn build_product_app_runtime_host_default_theme_css() -> &'static str {
    r#"<style id="sparo-theme-default">
:root {
  color-scheme: light;
  --sparo-bg:#f6f7fb;--sparo-bg-secondary:#ffffff;--sparo-bg-tertiary:#f1f4f9;--sparo-bg-elevated:#ffffff;--sparo-bg-workbench:#f6f7fb;--sparo-bg-scene:#f6f7fb;
  --sparo-text:#151a23;--sparo-text-secondary:#4f5b6b;--sparo-text-muted:#718096;--sparo-text-disabled:#a0a8b5;
  --sparo-accent:#2f6feb;--sparo-accent-hover:#4d83f1;--sparo-accent-soft:rgba(47,111,235,0.14);--sparo-accent-subtle:rgba(47,111,235,0.08);
  --sparo-success:#15835b;--sparo-success-bg:rgba(21,131,91,0.12);--sparo-success-border:rgba(21,131,91,0.28);
  --sparo-warning:#b7791f;--sparo-warning-bg:rgba(183,121,31,0.12);--sparo-warning-border:rgba(183,121,31,0.28);
  --sparo-error:#d33f49;--sparo-error-bg:rgba(211,63,73,0.12);--sparo-error-border:rgba(211,63,73,0.28);
  --sparo-info:#2563eb;--sparo-info-bg:rgba(37,99,235,0.12);--sparo-info-border:rgba(37,99,235,0.28);
  --sparo-highlight:#2f6feb;--sparo-highlight-bg:rgba(47,111,235,0.14);
  --sparo-border:#d8dee9;--sparo-border-subtle:#e7ebf2;--sparo-border-medium:#c8d0dc;--sparo-border-strong:#aeb8c7;
  --sparo-element-subtle:rgba(15,23,42,0.04);--sparo-element-soft:rgba(15,23,42,0.06);--sparo-element-bg:#f7f9fc;--sparo-element-hover:#edf2f8;--sparo-element-strong:#d8dee9;--sparo-element-elevated:#ffffff;
}
[data-theme-type="dark"] {
  color-scheme: dark;
  --sparo-bg:#121214;--sparo-bg-secondary:#18181a;--sparo-bg-tertiary:#121214;--sparo-bg-elevated:#18181a;--sparo-bg-workbench:#0f0f11;--sparo-bg-scene:#121214;
  --sparo-text:#e8e8e8;--sparo-text-secondary:#b0b0b0;--sparo-text-muted:#858585;--sparo-text-disabled:#666;
  --sparo-accent:#60a5fa;--sparo-accent-hover:#3b82f6;--sparo-accent-soft:rgba(96,165,250,0.18);--sparo-accent-subtle:rgba(96,165,250,0.1);
  --sparo-success:#34d399;--sparo-success-bg:rgba(52,211,153,0.14);--sparo-success-border:rgba(52,211,153,0.32);
  --sparo-warning:#f59e0b;--sparo-warning-bg:rgba(245,158,11,0.14);--sparo-warning-border:rgba(245,158,11,0.32);
  --sparo-error:#ef4444;--sparo-error-bg:rgba(239,68,68,0.14);--sparo-error-border:rgba(239,68,68,0.32);
  --sparo-info:#E1AB80;--sparo-info-bg:rgba(225,171,128,0.14);--sparo-info-border:rgba(225,171,128,0.32);
  --sparo-highlight:#60a5fa;--sparo-highlight-bg:rgba(96,165,250,0.16);
  --sparo-border:#2e2e32;--sparo-border-subtle:#27272a;--sparo-border-medium:#3f3f46;--sparo-border-strong:#52525b;
  --sparo-element-subtle:rgba(255,255,255,0.04);--sparo-element-soft:rgba(255,255,255,0.06);--sparo-element-bg:#27272a;--sparo-element-hover:#3f3f46;--sparo-element-strong:#52525b;--sparo-element-elevated:#18181a;
}
:root {
  --sparo-app-bg:var(--sparo-bg-scene);--sparo-app-surface:var(--sparo-bg-secondary);--sparo-app-panel:var(--sparo-bg-elevated);--sparo-app-card:var(--sparo-element-subtle);--sparo-app-card-hover:var(--sparo-element-soft);
  --sparo-app-control-bg:var(--sparo-element-bg);--sparo-app-control-hover:var(--sparo-element-hover);--sparo-app-text:var(--sparo-text);--sparo-app-text-secondary:var(--sparo-text-secondary);--sparo-app-text-muted:var(--sparo-text-muted);
  --sparo-app-border:var(--sparo-border);--sparo-app-border-subtle:var(--sparo-border-subtle);--sparo-app-accent:var(--sparo-accent);--sparo-app-accent-hover:var(--sparo-accent-hover);--sparo-app-accent-soft:var(--sparo-accent-soft);
  --sparo-app-accent-text:var(--sparo-bg);--sparo-app-focus-ring:rgba(96,165,250,0.55);--sparo-app-selection:var(--sparo-highlight-bg);--sparo-app-overlay:rgba(0,0,0,0.42);
  --sparo-app-shadow-sm:0 1px 2px rgba(0,0,0,0.12);--sparo-app-shadow:0 10px 30px rgba(0,0,0,0.16);
  --sparo-radius-sm:4px;--sparo-radius:6px;--sparo-radius-lg:10px;--sparo-radius-xl:12px;--sparo-app-radius-sm:4px;--sparo-app-radius:6px;--sparo-app-radius-lg:10px;
  --sparo-font-sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;--sparo-font-mono:ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace;
  --sparo-scrollbar-thumb:rgba(15,23,42,0.16);--sparo-scrollbar-thumb-hover:rgba(15,23,42,0.28);
}
[data-theme-type="dark"] { --sparo-scrollbar-thumb:rgba(255,255,255,0.12);--sparo-scrollbar-thumb-hover:rgba(255,255,255,0.22);--sparo-app-shadow-sm:0 1px 2px rgba(0,0,0,0.28);--sparo-app-shadow:0 10px 30px rgba(0,0,0,0.3); }
html,body{width:100%;min-width:0;min-height:0;}
</style>"#
}

#[cfg(test)]
mod tests {
    use super::build_bridge_script;

    fn bridge_script() -> String {
        build_bridge_script(
            "app-id",
            "C:/app-data",
            "C:/workspace",
            "dark",
            "windows",
            "{}",
            "source-revision",
            "deps-revision",
            false,
            false,
        )
    }

    #[test]
    fn bridge_exposes_panel_mode_request() {
        let script = bridge_script();

        assert!(script.contains("setPanelMode"));
        assert!(script.contains("host.setPanelMode"));
    }

    #[test]
    fn bridge_restricts_host_events_and_correlates_rehearsal_responses() {
        let script = bridge_script();

        assert!(script.contains("e.source === window.parent"));
        assert!(script.contains("_parentOriginFromReferrer"));
        assert!(script.contains("requestId: plan"));
    }

    #[test]
    fn bridge_exposes_manuscript_adapter_for_runtime_gated_dispatch() {
        let script = bridge_script();
        assert!(script.contains("deck.manuscript.get"));
        assert!(script.contains("deck.manuscript.commit"));
    }

    #[test]
    fn bridge_exposes_private_backend_helpers_for_runtime_gated_dispatch() {
        let script = bridge_script();
        assert!(script.contains("backend.cancelStaleRuns"));
        assert!(script.contains("backend.turnText"));
    }
}
