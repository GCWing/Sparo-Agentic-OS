import type { ContextItem } from '../../../shared/types/context';

export function getContextDisplayName(context: ContextItem): string {
  switch (context.type) {
    case 'file': return context.fileName;
    case 'directory': return context.directoryName;
    case 'code-snippet': return `${context.fileName}:${context.startLine}-${context.endLine}`;
    case 'image': return context.imageName;
    case 'terminal-command': return context.command;
    case 'git-ref': return context.refValue;
    case 'url': return context.title || context.url;
    case 'web-element': return context.tagName;
    case 'product-app-preview-element-selection':
      return context.element.label || context.element.textContent || context.appName || context.appId;
    default: {
      const exhaustive: never = context;
      return String(exhaustive);
    }
  }
}

export function getContextTagFormat(context: ContextItem): string {
  switch (context.type) {
    case 'file': return `#file:${context.fileName}`;
    case 'directory': return `#dir:${context.directoryName}`;
    case 'code-snippet': return `#code:${context.fileName}:${context.startLine}-${context.endLine}`;
    case 'image': return `#img:${context.imageName}`;
    case 'terminal-command': return `#cmd:${context.command}`;
    case 'git-ref': return `#git:${context.refValue}`;
    case 'url': return `#link:${context.title || context.url}`;
    case 'web-element': return `#element:${context.tagName}`;
    case 'product-app-preview-element-selection':
      return `#product-app-element:${context.appName || context.appId}`;
    default: {
      const exhaustive: never = context;
      return String(exhaustive);
    }
  }
}

export function getContextFullPath(context: ContextItem): string {
  switch (context.type) {
    case 'file':
      return context.filePath;
    case 'directory':
      return context.directoryPath + (context.recursive ? ' (recursive)' : '');
    case 'code-snippet':
      return `${context.filePath} (lines ${context.startLine}-${context.endLine})`;
    case 'image':
      return context.imagePath;
    case 'terminal-command':
      return context.workingDirectory ? `${context.command} @ ${context.workingDirectory}` : context.command;
    case 'git-ref':
      return `Git ${context.refType}: ${context.refValue}`;
    case 'url':
      return context.url;
    case 'web-element':
      return context.path;
    case 'product-app-preview-element-selection': {
      const target = context.element.selectorPath || context.element.tagName;
      return `Product App ${context.appId} @ ${context.route}: ${target}`;
    }
    default: {
      const exhaustive: never = context;
      return String(exhaustive);
    }
  }
}

export function createContextTagElement(
  context: ContextItem,
  onRemoveContext: (id: string) => void,
): HTMLSpanElement {
  const tag = document.createElement('span');
  tag.className = 'rich-text-tag-pill';
  tag.contentEditable = 'false';
  tag.dataset.contextId = context.id;
  tag.dataset.contextType = context.type;
  tag.dataset.tagFormat = getContextTagFormat(context);
  tag.title = getContextFullPath(context);

  const text = document.createElement('span');
  text.className = 'rich-text-tag-pill__text';
  text.textContent = getContextDisplayName(context);

  const remove = document.createElement('button');
  remove.className = 'rich-text-tag-pill__remove';
  remove.textContent = '×';
  remove.title = 'Remove';
  remove.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    onRemoveContext(context.id);
  };

  tag.appendChild(text);
  tag.appendChild(remove);

  return tag;
}
