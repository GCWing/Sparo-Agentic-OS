import React, { useEffect, useMemo, useRef, useState } from 'react';
import morphdomRuntime from 'morphdom/dist/morphdom-umd.js?raw';
import { themeService } from '@/infrastructure/theme';
import './GenerativeWidgetFrame.scss';

type WidgetMessage =
  | {
      source: 'sparo-widget';
      type: 'sparo-widget:event';
      widgetId?: string;
      payload?: unknown;
    }
  | {
      source: 'sparo-widget';
      type: 'sparo-widget:prompt';
      widgetId?: string;
      text?: string;
    }
  | {
      source: 'sparo-widget';
      type: 'sparo-widget:ready';
      widgetId?: string;
    }
  | {
      source: 'sparo-widget';
      type: 'sparo-widget:open-file';
      widgetId?: string;
      filePath?: string;
      line?: number;
      column?: number;
      lineEnd?: number;
      nodeType?: string;
    }
  | {
      source: 'sparo-widget';
      type: 'sparo-widget:resize';
      widgetId?: string;
      height?: number;
    };

export interface GenerativeWidgetFrameProps {
  widgetId: string;
  title?: string;
  widgetCode: string;
  preferredWidth?: number;
  executeScripts?: boolean;
  className?: string;
  onWidgetEvent?: (event: WidgetMessage) => void;
  onHeightChange?: (height: number) => void;
}

type WidgetThemePayload = {
  id: string;
  type: string;
  vars: Record<string, string>;
};

const THEME_VAR_NAMES = [
  '--ds-color-bg-app',
  '--ds-color-bg-scene',
  '--ds-color-bg-panel',
  '--ds-color-bg-elevated',
  '--ds-color-bg-overlay',
  '--ds-color-bg-tooltip',
  '--ds-color-text-primary',
  '--ds-color-text-secondary',
  '--ds-color-text-muted',
  '--ds-color-text-disabled',
  '--ds-color-text-inverse',
  '--ds-color-accent-50',
  '--ds-color-accent-100',
  '--ds-color-accent-200',
  '--ds-color-accent-300',
  '--ds-color-accent-400',
  '--ds-color-accent-500',
  '--ds-color-accent-600',
  '--ds-color-success',
  '--ds-color-success-bg',
  '--ds-color-success-border',
  '--ds-color-warning',
  '--ds-color-warning-bg',
  '--ds-color-warning-border',
  '--ds-color-danger',
  '--ds-color-danger-bg',
  '--ds-color-danger-border',
  '--ds-color-info',
  '--ds-color-info-bg',
  '--ds-color-info-border',
  '--ds-color-border-subtle',
  '--ds-color-border-base',
  '--ds-color-border-medium',
  '--ds-color-border-strong',
  '--ds-color-border-prominent',
  '--ds-color-border-focus',
  '--ds-color-element-subtle',
  '--ds-color-element-soft',
  '--ds-color-element-base',
  '--ds-color-element-medium',
  '--ds-color-element-strong',
  '--ds-color-element-elevated',
  '--ds-shadow-xs',
  '--ds-shadow-sm',
  '--ds-shadow-base',
  '--ds-shadow-lg',
  '--ds-shadow-xl',
  '--ds-radius-sm',
  '--ds-radius-md',
  '--ds-radius-lg',
  '--ds-radius-xl',
  '--ds-space-2',
  '--ds-space-3',
  '--ds-space-4',
  '--ds-space-5',
  '--ds-space-6',
  '--ds-motion-fast',
  '--ds-motion-base',
  '--ds-easing-standard',
  '--ds-font-family-sans',
  '--ds-font-family-mono',
  '--ds-font-size-xs',
  '--ds-font-size-sm',
  '--ds-font-size-base',
  '--ds-font-size-lg',
  '--ds-font-size-2xl',
  '--ds-font-weight-medium',
  '--ds-font-weight-semibold',
] as const;

// eslint-disable-next-line react-refresh/only-export-components
export function readWidgetThemePayload(): WidgetThemePayload | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  const root = document.documentElement;
  const styles = window.getComputedStyle(root);
  const vars: Record<string, string> = {};

  for (const name of THEME_VAR_NAMES) {
    const value = styles.getPropertyValue(name).trim();
    if (value) {
      vars[name] = value;
    }
  }

  return {
    id: root.getAttribute('data-theme') || 'unknown',
    type: root.getAttribute('data-theme-type') || 'dark',
    vars,
  };
}

export const GENERATIVE_WIDGET_SHELL_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      min-height: 0;
      background: transparent;
      color: var(--ds-color-text-primary);
      font-family: var(--ds-font-family-sans, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      overflow-x: hidden;
      overflow-y: hidden;
    }
    body { min-height: 0; }
    #root {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      overflow-x: hidden;
    }
    #root > * {
      max-width: 100%;
    }
    img, svg, canvas, video {
      max-width: 100%;
      height: auto;
    }
    table {
      width: 100%;
      max-width: 100%;
      table-layout: fixed;
    }
    pre, code {
      white-space: pre-wrap;
      word-break: break-word;
    }
    body {
      font-size: var(--ds-font-size-sm, 14px);
      line-height: 1.5;
    }
    body, button, input, textarea, select {
      font-family: var(--ds-font-family-sans, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
    button, input, textarea, select {
      font: inherit;
    }
    a {
      color: var(--ds-color-accent-500);
      text-decoration: none;
    }
    a:hover {
      color: var(--ds-color-accent-600);
    }
    [data-file-path],
    [data-sparo-open-file] {
      cursor: pointer;
    }
    .sparo-widget-root,
    .sparo-widget-stack,
    .sparo-widget-section,
    .sparo-widget-card,
    .sparo-widget-panel,
    .sparo-widget-empty,
    .sparo-widget-list,
    .sparo-widget-table-wrap {
      min-width: 0;
    }
    .sparo-widget-root {
      width: 100%;
      max-width: 100%;
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-4, 16px);
      color: var(--ds-color-text-primary);
    }
    .sparo-widget-stack {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3, 12px);
    }
    .sparo-widget-row {
      display: flex;
      align-items: center;
      gap: var(--ds-space-3, 12px);
      min-width: 0;
    }
    .sparo-widget-row-wrap {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--ds-space-3, 12px);
      min-width: 0;
    }
    .sparo-widget-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--ds-space-3, 12px);
      padding: var(--ds-space-3, 12px) var(--ds-space-4, 16px);
      border-radius: var(--ds-radius-lg, 12px);
      background: color-mix(in srgb, var(--ds-color-bg-panel) 82%, transparent);
      border: 1px solid var(--ds-color-border-subtle);
      box-shadow: var(--ds-shadow-xs);
    }
    .sparo-widget-section {
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3, 12px);
    }
    .sparo-widget-section-header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--ds-space-3, 12px);
    }
    .sparo-widget-title {
      margin: 0;
      font-size: var(--ds-font-size-lg, 15px);
      font-weight: var(--ds-font-weight-semibold, 600);
      line-height: 1.2;
      color: var(--ds-color-text-primary);
      letter-spacing: -0.01em;
    }
    .sparo-widget-subtitle {
      margin: 0;
      font-size: var(--ds-font-size-xs, 12px);
      color: var(--ds-color-text-muted);
      line-height: 1.5;
    }
    .sparo-widget-eyebrow {
      margin: 0;
      font-size: 11px;
      font-weight: var(--ds-font-weight-medium, 500);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ds-color-text-muted);
    }
    .sparo-widget-card,
    .sparo-widget-panel {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: var(--ds-space-3, 12px);
      width: 100%;
      padding: var(--ds-space-4, 16px);
      border-radius: var(--ds-radius-lg, 12px);
      background: var(--ds-color-bg-panel);
      border: 1px solid var(--ds-color-border-subtle);
      box-shadow: var(--ds-shadow-sm);
      overflow: hidden;
    }
    .sparo-widget-panel {
      background: color-mix(in srgb, var(--ds-color-bg-panel) 74%, var(--ds-color-element-subtle));
    }
    .sparo-widget-card-accent {
      background: color-mix(in srgb, var(--ds-color-accent-500) 10%, var(--ds-color-bg-panel));
      border-color: color-mix(in srgb, var(--ds-color-accent-500) 30%, var(--ds-color-border-subtle));
    }
    .sparo-widget-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
      gap: var(--ds-space-3, 12px);
      width: 100%;
      min-width: 0;
    }
    .sparo-widget-kpi {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      padding: var(--ds-space-3, 12px);
      border-radius: var(--ds-radius-md, 8px);
      background: var(--ds-color-element-base);
      border: 1px solid var(--ds-color-border-subtle);
    }
    .sparo-widget-kpi-label {
      font-size: 11px;
      font-weight: var(--ds-font-weight-medium, 500);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--ds-color-text-muted);
    }
    .sparo-widget-kpi-value {
      font-size: var(--ds-font-size-2xl, 18px);
      font-weight: var(--ds-font-weight-semibold, 600);
      line-height: 1.1;
      color: var(--ds-color-text-primary);
    }
    .sparo-widget-kpi-meta {
      font-size: var(--ds-font-size-xs, 12px);
      color: var(--ds-color-text-secondary);
    }
    .sparo-widget-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 24px;
      padding: 0 10px;
      border-radius: 999px;
      background: var(--ds-color-element-base);
      border: 1px solid var(--ds-color-border-subtle);
      font-size: 12px;
      font-weight: var(--ds-font-weight-medium, 500);
      color: var(--ds-color-text-secondary);
      white-space: nowrap;
    }
    .sparo-widget-badge-accent {
      background: color-mix(in srgb, var(--ds-color-accent-500) 14%, transparent);
      border-color: color-mix(in srgb, var(--ds-color-accent-500) 28%, var(--ds-color-border-subtle));
      color: var(--ds-color-accent-500);
    }
    .sparo-widget-badge-success {
      background: color-mix(in srgb, var(--ds-color-success) 14%, transparent);
      border-color: color-mix(in srgb, var(--ds-color-success) 28%, var(--ds-color-border-subtle));
      color: var(--ds-color-success);
    }
    .sparo-widget-badge-warning {
      background: color-mix(in srgb, var(--ds-color-warning) 14%, transparent);
      border-color: color-mix(in srgb, var(--ds-color-warning) 28%, var(--ds-color-border-subtle));
      color: var(--ds-color-warning);
    }
    .sparo-widget-badge-error {
      background: color-mix(in srgb, var(--ds-color-danger) 14%, transparent);
      border-color: color-mix(in srgb, var(--ds-color-danger) 28%, var(--ds-color-border-subtle));
      color: var(--ds-color-danger);
    }
    .sparo-widget-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 32px;
      max-width: 100%;
      padding: 0 12px;
      border: 1px solid var(--ds-color-border-base);
      border-radius: var(--ds-radius-sm, 6px);
      background: var(--ds-color-element-base);
      color: var(--ds-color-text-secondary);
      text-decoration: none;
      white-space: nowrap;
      transition: all var(--ds-motion-fast, 0.15s) var(--ds-easing-standard, ease);
    }
    .sparo-widget-button:hover {
      background: var(--ds-color-element-medium);
      color: var(--ds-color-text-primary);
      border-color: var(--ds-color-border-medium);
    }
    .sparo-widget-button-primary {
      background: var(--ds-color-accent-500);
      color: white;
      border-color: transparent;
      box-shadow: var(--ds-shadow-xs);
    }
    .sparo-widget-button-primary:hover {
      background: var(--ds-color-accent-600);
      color: white;
      border-color: transparent;
    }
    .sparo-widget-input,
    .sparo-widget-textarea,
    .sparo-widget-select {
      width: 100%;
      max-width: 100%;
      min-width: 0;
      padding: 0 12px;
      border-radius: var(--ds-radius-sm, 6px);
      border: 1px solid var(--ds-color-border-base);
      background: var(--ds-color-element-subtle);
      color: var(--ds-color-text-primary);
      transition: all var(--ds-motion-fast, 0.15s) var(--ds-easing-standard, ease);
    }
    .sparo-widget-input,
    .sparo-widget-select {
      min-height: 34px;
    }
    .sparo-widget-textarea {
      min-height: 96px;
      padding-top: 10px;
      padding-bottom: 10px;
      resize: vertical;
    }
    .sparo-widget-input::placeholder,
    .sparo-widget-textarea::placeholder {
      color: color-mix(in srgb, var(--ds-color-text-muted) 55%, transparent);
    }
    .sparo-widget-input:focus,
    .sparo-widget-textarea:focus,
    .sparo-widget-select:focus {
      outline: none;
      border-color: var(--ds-color-accent-500);
      background: var(--ds-color-element-soft);
    }
    .sparo-widget-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }
    .sparo-widget-list-item {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--ds-space-3, 12px);
      padding: var(--ds-space-3, 12px);
      border-radius: var(--ds-radius-md, 8px);
      background: var(--ds-color-element-subtle);
      border: 1px solid transparent;
    }
    .sparo-widget-list-item[data-file-path]:hover,
    .sparo-widget-list-item[data-sparo-open-file]:hover,
    .sparo-widget-card[data-file-path]:hover,
    .sparo-widget-panel[data-file-path]:hover {
      border-color: color-mix(in srgb, var(--ds-color-accent-500) 35%, var(--ds-color-border-subtle));
      background: color-mix(in srgb, var(--ds-color-element-base) 76%, var(--ds-color-accent-500));
    }
    .sparo-widget-table-wrap {
      width: 100%;
      overflow-x: auto;
      border: 1px solid var(--ds-color-border-subtle);
      border-radius: var(--ds-radius-md, 8px);
      background: var(--ds-color-bg-panel);
    }
    .sparo-widget-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .sparo-widget-table th,
    .sparo-widget-table td {
      padding: 10px 12px;
      text-align: left;
      vertical-align: top;
      border-bottom: 1px solid var(--ds-color-border-subtle);
      color: var(--ds-color-text-secondary);
      font-size: 13px;
      word-break: break-word;
    }
    .sparo-widget-table th {
      font-size: 12px;
      font-weight: var(--ds-font-weight-medium, 500);
      color: var(--ds-color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .sparo-widget-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 140px;
      padding: var(--ds-space-5, 20px);
      border-radius: var(--ds-radius-lg, 12px);
      border: 1px dashed var(--ds-color-border-base);
      background: color-mix(in srgb, var(--ds-color-element-subtle) 80%, transparent);
      color: var(--ds-color-text-muted);
      text-align: center;
    }
    .sparo-widget-divider {
      width: 100%;
      height: 1px;
      background: var(--ds-color-border-subtle);
      border: 0;
      margin: 0;
    }
    .sparo-widget-code {
      padding: 2px 6px;
      border-radius: 6px;
      background: var(--ds-color-element-base);
      color: var(--ds-color-text-primary);
      font-family: var(--ds-font-family-mono, "SF Mono", Consolas, monospace);
      font-size: 12px;
    }
    .sparo-widget-mono {
      font-family: var(--ds-font-family-mono, "SF Mono", Consolas, monospace);
    }
    @media (max-width: 560px) {
      .sparo-widget-card,
      .sparo-widget-panel,
      .sparo-widget-toolbar {
        padding: var(--ds-space-3, 12px);
      }
      .sparo-widget-grid {
        grid-template-columns: 1fr;
      }
      .sparo-widget-title {
        font-size: var(--ds-font-size-base, 14px);
      }
    }
    @keyframes sparoWidgetFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
  <script>${morphdomRuntime}</script>
</head>
<body>
  <div id="root"></div>
  <script>
    (function () {
      var currentWidgetId = '';
      var lastExecutedHtml = '';
      var resizeFrame = null;
      var resizeObserver = null;

      function send(type, payload) {
        parent.postMessage({
          source: 'sparo-widget',
          type: type,
          widgetId: currentWidgetId,
          payload: payload
        }, '*');
      }

      function sendMessage(message) {
        parent.postMessage(message, '*');
      }

      function measureHeight() {
        var root = document.getElementById('root');
        return Math.max(
          root ? root.scrollHeight : 0,
          root ? root.offsetHeight : 0,
          120
        );
      }

      function scheduleResize() {
        if (resizeFrame !== null) return;
        resizeFrame = window.requestAnimationFrame(function () {
          resizeFrame = null;
          sendMessage({
            source: 'sparo-widget',
            type: 'sparo-widget:resize',
            widgetId: currentWidgetId,
            height: measureHeight()
          });
        });
      }

      function runScripts(root) {
        var scripts = root.querySelectorAll('script');
        scripts.forEach(function (oldScript) {
          var nextScript = document.createElement('script');
          for (var i = 0; i < oldScript.attributes.length; i += 1) {
            var attr = oldScript.attributes[i];
            nextScript.setAttribute(attr.name, attr.value);
          }
          if (oldScript.src) {
            nextScript.src = oldScript.src;
          } else {
            nextScript.textContent = oldScript.textContent;
          }
          oldScript.parentNode.replaceChild(nextScript, oldScript);
        });
      }

      function setContent(html, shouldRunScripts) {
        var root = document.getElementById('root');
        if (!root) return;
        var nextHtml = String(html || '');

        if (window.morphdom) {
          var target = document.createElement('div');
          target.id = 'root';
          target.innerHTML = nextHtml;

          window.morphdom(root, target, {
            onBeforeElUpdated: function (fromEl, toEl) {
              if (fromEl.isEqualNode && fromEl.isEqualNode(toEl)) {
                return false;
              }
              return true;
            },
            onNodeAdded: function (node) {
              if (
                node &&
                node.nodeType === 1 &&
                node.tagName !== 'SCRIPT' &&
                node.tagName !== 'STYLE'
              ) {
                node.style.animation = 'sparoWidgetFadeIn 0.18s ease both';
              }
              return node;
            }
          });
        } else {
          root.innerHTML = nextHtml;
        }

        if (shouldRunScripts && html !== lastExecutedHtml) {
          lastExecutedHtml = html || '';
          runScripts(root);
        }

        scheduleResize();
      }

      function applyTheme(theme) {
        if (!theme) return;
        var root = document.documentElement;
        if (!root) return;
        if (theme.id) root.setAttribute('data-theme', String(theme.id));
        if (theme.type) root.setAttribute('data-theme-type', String(theme.type));
        var vars = theme.vars || {};
        Object.keys(vars).forEach(function (name) {
          root.style.setProperty(name, String(vars[name]));
        });
        var body = document.body;
        if (body) {
          body.style.background = vars['--ds-color-bg-app'] || 'transparent';
          body.style.color = vars['--ds-color-text-primary'] || 'var(--ds-generative-widget-text)';
          body.style.fontFamily = vars['--ds-font-family-sans'] || body.style.fontFamily;
        }
      }

      var bridge = {
        send: function (data) {
          send('sparo-widget:event', data);
        }
      };

      window.sparoWidget = bridge;
      window.glimpse = bridge;
      window.sendPrompt = function (text) {
        parent.postMessage({
          source: 'sparo-widget',
          type: 'sparo-widget:prompt',
          widgetId: currentWidgetId,
          text: String(text || '')
        }, '*');
      };

      document.addEventListener('click', function (event) {
        var target = event.target;
        var fileTarget = target && target.closest ? target.closest('[data-file-path], [data-sparo-open-file]') : null;
        if (fileTarget) {
          var filePath = fileTarget.getAttribute('data-file-path') || fileTarget.getAttribute('data-sparo-open-file') || '';
          if (filePath) {
            var lineValue = Number(fileTarget.getAttribute('data-line') || '');
            var columnValue = Number(fileTarget.getAttribute('data-column') || '');
            var lineEndValue = Number(fileTarget.getAttribute('data-line-end') || '');
            event.preventDefault();
            event.stopPropagation();
            sendMessage({
              source: 'sparo-widget',
              type: 'sparo-widget:open-file',
              widgetId: currentWidgetId,
              filePath: filePath,
              line: Number.isFinite(lineValue) && lineValue > 0 ? lineValue : undefined,
              column: Number.isFinite(columnValue) && columnValue > 0 ? columnValue : undefined,
              lineEnd: Number.isFinite(lineEndValue) && lineEndValue > 0 ? lineEndValue : undefined,
              nodeType: fileTarget.getAttribute('data-node-type') || undefined
            });
            return;
          }
        }

        var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
        if (!anchor) return;
        var href = anchor.getAttribute('href');
        if (!href || href.charAt(0) === '#') return;
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noreferrer noopener');
      }, true);

      window.addEventListener('message', function (event) {
        var data = event.data;
        if (!data || data.type !== 'sparo-widget:update') return;
        currentWidgetId = data.widgetId || currentWidgetId || '';
        applyTheme(data.theme);
        setContent(String(data.html || ''), Boolean(data.runScripts));
      });

      window.addEventListener('load', scheduleResize);
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(scheduleResize);
        resizeObserver.observe(document.documentElement);
        var root = document.getElementById('root');
        if (root) {
          resizeObserver.observe(root);
        }
      }

      sendMessage({
        source: 'sparo-widget',
        type: 'sparo-widget:ready',
        widgetId: currentWidgetId
      });
      scheduleResize();
    })();
  </script>
</body>
</html>`;

export const GenerativeWidgetFrame: React.FC<GenerativeWidgetFrameProps> = ({
  widgetId,
  title,
  widgetCode,
  executeScripts = false,
  className = '',
  onWidgetEvent,
  onHeightChange,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [frameHeight, setFrameHeight] = useState(160);
  const lastExecutedHtmlRef = useRef('');
  const [themePayload, setThemePayload] = useState<WidgetThemePayload | null>(() =>
    readWidgetThemePayload(),
  );

  const normalizedCode = useMemo(() => widgetCode || '', [widgetCode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<WidgetMessage>) => {
      const data = event.data;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (!data || data.source !== 'sparo-widget') return;
      if (data.widgetId && data.widgetId !== widgetId) return;

      if (data.type === 'sparo-widget:resize') {
        const nextHeight = Math.max(120, Math.ceil(Number(data.height) || 0));
        setFrameHeight((prev) => {
          if (Math.abs(prev - nextHeight) <= 1) return prev;
          onHeightChange?.(nextHeight);
          return nextHeight;
        });
        return;
      }

      onWidgetEvent?.(data);
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onHeightChange, onWidgetEvent, widgetId]);

  useEffect(() => {
    const updateTheme = () => {
      setThemePayload(readWidgetThemePayload());
    };

    updateTheme();
    const unsubscribe = themeService.on('theme:after-change', updateTheme);
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !iframeRef.current?.contentWindow) return;

    const shouldRunScripts =
      Boolean(executeScripts) && lastExecutedHtmlRef.current !== normalizedCode;

    iframeRef.current.contentWindow.postMessage(
      {
        type: 'sparo-widget:update',
        widgetId,
        title,
        html: normalizedCode,
        theme: themePayload,
        runScripts: shouldRunScripts,
      },
      '*',
    );

    if (shouldRunScripts) {
      lastExecutedHtmlRef.current = normalizedCode;
    }
  }, [executeScripts, isLoaded, normalizedCode, themePayload, title, widgetId]);

  return (
    <div
      className={`sparo-generative-widget-frame ${className}`.trim()}
      style={{ height: `${frameHeight}px` }}
    >
      <iframe
        ref={iframeRef}
        title={title || 'Generative widget'}
        className="sparo-generative-widget-frame__iframe"
        style={{ width: '100%', minWidth: '100%' }}
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        srcDoc={GENERATIVE_WIDGET_SHELL_HTML}
        onLoad={() => setIsLoaded(true)}
      />
    </div>
  );
};

export default GenerativeWidgetFrame;
