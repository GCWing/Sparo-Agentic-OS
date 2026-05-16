 

import React from 'react';
import { FileIcon, Code, Code2 as Code2Icon } from 'lucide-react';
import { contextRegistry } from '../../services/ContextRegistry';
import { 
  FileContextTransformer, 
  FileContextValidator, 
  FileCardRenderer 
} from './types/FileContextImpl';
import { 
  CodeSnippetContextTransformer, 
  CodeSnippetContextValidator, 
  CodeSnippetCardRenderer 
} from './types/CodeSnippetContextImpl';
import { 
  ImageContextTransformer, 
  ImageContextValidator, 
  ImageCardRenderer 
} from './types/ImageContextImpl';
import {
  WebElementContextTransformer,
  WebElementContextValidator,
  WebElementCardRenderer,
} from './types/WebElementContextImpl';
import { i18nService } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('ContextRegistry');

const CONTEXT_TYPE_COLORS = {
  file: 'var(--context-color-file, var(--color-accent-500))',
  directory: 'var(--context-color-directory, var(--color-purple-500, var(--color-accent-700)))',
  codeSnippet: 'var(--context-color-code-snippet, var(--color-purple-400, var(--color-accent-500)))',
  image: 'var(--context-color-image, var(--color-warning))',
  webElement: 'var(--context-color-web-element, var(--color-info))',
} as const;

 
export function registerDefaultContextTypes(): void {
  let registeredCount = 0;
  
  try {
    
    contextRegistry.register({
      type: 'file',
      displayName: i18nService.t('components:contextSystem.contextRegistry.file.name'),
      description: i18nService.t('components:contextSystem.contextRegistry.file.description'),
      icon: React.createElement(FileIcon, { size: 16 }),
      color: CONTEXT_TYPE_COLORS.file,
      category: 'file',
      transformer: new FileContextTransformer(),
      validator: new FileContextValidator(),
      renderer: new FileCardRenderer(),
      config: {
        maxSize: 50 * 1024 * 1024, // 50MB
        cacheable: true,
        priority: 1
      }
    });
    registeredCount++;
  } catch (error) {
    log.error('Failed to register file type', error as Error);
  }
  
  try {
    
    contextRegistry.register({
      type: 'directory',
      displayName: i18nService.t('components:contextSystem.contextRegistry.directory.name'),
      description: i18nService.t('components:contextSystem.contextRegistry.directory.description'),
      icon: React.createElement(FileIcon, { size: 16 }),
      color: CONTEXT_TYPE_COLORS.directory,
      category: 'file',
      transformer: new FileContextTransformer() as any,
      validator: new FileContextValidator() as any,
      renderer: new FileCardRenderer() as any,
      config: {
        cacheable: true,
        priority: 2
      }
    });
    registeredCount++;
  } catch (error) {
    log.error('Failed to register directory type', error as Error);
  }
  
  try {
    
    contextRegistry.register({
      type: 'code-snippet',
      displayName: i18nService.t('components:contextSystem.contextRegistry.codeSnippet.name'),
      description: i18nService.t('components:contextSystem.contextRegistry.codeSnippet.description'),
      icon: React.createElement(Code, { size: 16 }),
      color: CONTEXT_TYPE_COLORS.codeSnippet,
      category: 'code',
      transformer: new CodeSnippetContextTransformer(),
      validator: new CodeSnippetContextValidator(),
      renderer: new CodeSnippetCardRenderer(),
      config: {
        maxSize: 100000, // 100KB
        cacheable: false,
        priority: 5
      }
    });
    registeredCount++;
  } catch (error) {
    log.error('Failed to register code-snippet type', error as Error);
  }
  
  try {
    
    contextRegistry.register({
      type: 'image',
      displayName: i18nService.t('components:contextSystem.contextRegistry.image.name'),
      description: i18nService.t('components:contextSystem.contextRegistry.image.description'),
      icon: React.createElement(FileIcon, { size: 16 }),
      color: CONTEXT_TYPE_COLORS.image,
      category: 'media',
      transformer: new ImageContextTransformer(),
      validator: new ImageContextValidator(),
      renderer: new ImageCardRenderer(),
      config: {
        maxSize: 20 * 1024 * 1024, // 20MB
        cacheable: true,
        priority: 3
      }
    });
    registeredCount++;
  } catch (error) {
    log.error('Failed to register image type', error as Error);
  }
  
  try {
    contextRegistry.register({
      type: 'web-element',
      displayName: i18nService.t('components:contextSystem.contextRegistry.webElement.name'),
      description: i18nService.t('components:contextSystem.contextRegistry.webElement.description'),
      icon: React.createElement(Code2Icon, { size: 16 }),
      color: CONTEXT_TYPE_COLORS.webElement,
      category: 'reference',
      transformer: new WebElementContextTransformer(),
      validator: new WebElementContextValidator(),
      renderer: new WebElementCardRenderer(),
      config: {
        maxSize: 50000,
        cacheable: false,
        priority: 6,
      },
    });
    registeredCount++;
  } catch (error) {
    log.error('Failed to register web-element type', error as Error);
  }

  const registeredTypes = contextRegistry.getAllTypes();
  log.info('Default context types registered', { count: registeredCount, types: registeredTypes });
}

