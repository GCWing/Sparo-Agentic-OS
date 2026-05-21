//! Bridge script builder - generates window.app Runtime Adapter (Sparo OS Hosted) for iframe.

use crate::live_app::types::{EsmDep, LiveAppPermissions};
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
) -> String {
    let app_id_esc = escape_js_str(app_id);
    let app_data_esc = escape_js_str(app_data_dir);
    let workspace_esc = escape_js_str(workspace_dir);
    let theme_esc = escape_js_str(theme);
    let platform_esc = escape_js_str(platform);

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

    // Backend namespace - invokes declared Agent App service actions.
    backend: {{
      call: (target, input, opts) => _rpc('backend.call', {{ target, input, ...(opts || {{}}) }}),
      cancel: (sessionId, turnId) => _rpc('backend.cancel', {{ sessionId, turnId }}),
      cancelStaleRuns: () => _rpc('backend.cancelStaleRuns', {{}}),
      turnText: (sessionId, turnId, opts) => _rpc('backend.turnText', {{ sessionId, turnId, ...(opts || {{}}) }}),
      onEvent: (fn) => app.on('backend:event', fn),
      offEvent: (fn) => app.off('backend:event', fn),
    }},
    host: {{
      fillChatInput: (text) => _rpc('host.fillChatInput', {{ text }}),
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

  window.addEventListener('message', (e) => {{
    if (e.data?.type === 'sparo:event') {{
      const {{ event, payload }} = e.data;
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

  window.app = app;
  document.documentElement.setAttribute('data-theme-type', _theme);
  window.parent.postMessage({{ method: 'sparo/request-theme' }}, '*');
  window.parent.postMessage({{ method: 'sparo/request-locale' }}, '*');
}})();
"#,
        app_id_esc = app_id_esc,
        app_data_esc = app_data_esc,
        workspace_esc = workspace_esc,
        theme_esc = theme_esc,
        platform_esc = platform_esc,
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
pub fn build_csp_content(permissions: &LiveAppPermissions) -> String {
    let net_allow = permissions
        .net
        .as_ref()
        .and_then(|n| n.allow.as_ref())
        .map(|v| v.iter().map(|d| d.as_str()).collect::<Vec<_>>())
        .unwrap_or_default();

    let connect_src = if net_allow.is_empty() {
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
        "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' data: https:; style-src 'self' 'unsafe-inline' https:; connect-src 'self' {}; img-src 'self' data: https:; font-src 'self' https:; object-src 'none'; base-uri 'self';",
        connect_src
    )
}

/// Scroll boundary script (reuse same logic as MCP App).
pub fn scroll_boundary_script() -> &'static str {
    r#"<script>(()=>{const d=()=>document.documentElement?.dataset?.sparoScrollBoundary==='none'||document.body?.dataset?.sparoScrollBoundary==='none';const s=(e)=>{for(let n=e.target;n;n=n.parentNode){if(!(n instanceof Element))continue;if(n===document.documentElement||n===document.body)continue;const o=window.getComputedStyle(n).overflowY;if(o==='hidden'||o==='visible')continue;if(e.deltaY<0&&n.scrollTop>0)return false;if(e.deltaY>0&&n.scrollTop+n.clientHeight<n.scrollHeight)return false;}return true};window.addEventListener('wheel',e=>{if(d())return;if(!e.defaultPrevented&&s(e))window.parent.postMessage({jsonrpc:'2.0',method:'sparo/sandbox-wheel',params:{deltaX:e.deltaX,deltaY:e.deltaY,deltaZ:e.deltaZ,deltaMode:e.deltaMode}},'*')},{passive:true});})();</script>"#
}

/// Default theme CSS variables for Live App iframe.
///
/// The host pushes the real theme after the iframe starts, but CSS is evaluated
/// before that postMessage round trip completes. These defaults keep first paint
/// aligned with the compiled `data-theme-type` and expose both the canonical
/// `--sparo-*` namespace and the historical `--bitfun-*` aliases.
pub fn build_live_app_default_theme_css() -> &'static str {
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
  --bitfun-bg:var(--sparo-bg);--bitfun-bg-secondary:var(--sparo-bg-secondary);--bitfun-bg-tertiary:var(--sparo-bg-tertiary);--bitfun-bg-elevated:var(--sparo-bg-elevated);
  --bitfun-text:var(--sparo-text);--bitfun-text-secondary:var(--sparo-text-secondary);--bitfun-text-muted:var(--sparo-text-muted);
  --bitfun-accent:var(--sparo-accent);--bitfun-accent-hover:var(--sparo-accent-hover);--bitfun-success:var(--sparo-success);--bitfun-warning:var(--sparo-warning);--bitfun-error:var(--sparo-error);--bitfun-info:var(--sparo-info);
  --bitfun-border:var(--sparo-border);--bitfun-border-subtle:var(--sparo-border-subtle);--bitfun-element-bg:var(--sparo-element-bg);--bitfun-element-hover:var(--sparo-element-hover);
  --bitfun-radius:var(--sparo-radius);--bitfun-radius-lg:var(--sparo-radius-lg);--bitfun-font-sans:var(--sparo-font-sans);--bitfun-font-mono:var(--sparo-font-mono);
  --bitfun-scrollbar-thumb:var(--sparo-scrollbar-thumb);--bitfun-scrollbar-thumb-hover:var(--sparo-scrollbar-thumb-hover);
}
[data-theme-type="dark"] { --sparo-scrollbar-thumb:rgba(255,255,255,0.12);--sparo-scrollbar-thumb-hover:rgba(255,255,255,0.22);--sparo-app-shadow-sm:0 1px 2px rgba(0,0,0,0.28);--sparo-app-shadow:0 10px 30px rgba(0,0,0,0.3); }
html,body{width:100%;min-width:0;min-height:0;}
</style>"#
}
