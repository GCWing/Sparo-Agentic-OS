 

import type { Language, LanguageCategory, LanguagePlugin } from '../types';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('LanguageRegistry');

// ============================================================================

// ============================================================================

const LANGUAGE_COLOR_FALLBACK_BY_CATEGORY: Record<LanguageCategory, string> = {
  programming: 'var(--color-accent-500)',
  markup: 'var(--color-warning)',
  stylesheet: 'var(--color-info)',
  data: 'var(--color-success)',
  config: 'var(--color-text-muted)',
  documentation: 'var(--color-text-secondary)',
  script: 'var(--color-warning)',
  binary: 'var(--color-text-disabled)',
  media: 'var(--color-purple-500, var(--color-accent-500))',
  other: 'var(--color-text-muted)',
};

const languageColor = (id: string, category: LanguageCategory): string =>
  `var(--language-color-${id}, ${LANGUAGE_COLOR_FALLBACK_BY_CATEGORY[category]})`;

 
const BUILTIN_LANGUAGES: Language[] = [
  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'typescript',
    name: 'TypeScript',
    category: 'programming',
    extensions: ['ts', 'mts', 'cts', 'ets'],
    monacoId: 'typescript',
    prismId: 'typescript',
    iconType: 'typescript',
    color: languageColor('typescript', 'programming'),
    aliases: ['ts'],
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'typescript-react',
    name: 'TypeScript React',
    category: 'programming',
    extensions: ['tsx'],
    monacoId: 'typescript',
    prismId: 'tsx',
    iconType: 'react',
    color: languageColor('typescript-react', 'programming'),
    aliases: ['tsx'],
    parent: 'typescript',
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    category: 'programming',
    extensions: ['js', 'mjs', 'cjs'],
    monacoId: 'javascript',
    prismId: 'javascript',
    iconType: 'javascript',
    color: languageColor('javascript', 'programming'),
    aliases: ['js', 'es6', 'ecmascript'],
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'javascript-react',
    name: 'JavaScript React',
    category: 'programming',
    extensions: ['jsx'],
    monacoId: 'javascript',
    prismId: 'jsx',
    iconType: 'react',
    color: languageColor('javascript-react', 'programming'),
    aliases: ['jsx'],
    parent: 'javascript',
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'python',
    name: 'Python',
    category: 'programming',
    extensions: ['py', 'pyw', 'pyi'],
    monacoId: 'python',
    iconType: 'python',
    color: languageColor('python', 'programming'),
    aliases: ['py', 'python3'],
    supportsComments: true,
    lineCommentPrefix: '#',
    blockComment: { start: '"""', end: '"""' },
  },
  {
    id: 'rust',
    name: 'Rust',
    category: 'programming',
    extensions: ['rs'],
    monacoId: 'rust',
    iconType: 'rust',
    color: languageColor('rust', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'go',
    name: 'Go',
    category: 'programming',
    extensions: ['go'],
    monacoId: 'go',
    iconType: 'go',
    color: languageColor('go', 'programming'),
    aliases: ['golang'],
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'java',
    name: 'Java',
    category: 'programming',
    extensions: ['java'],
    monacoId: 'java',
    iconType: 'java',
    color: languageColor('java', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'kotlin',
    name: 'Kotlin',
    category: 'programming',
    extensions: ['kt', 'kts'],
    monacoId: 'kotlin',
    iconType: 'kotlin',
    color: languageColor('kotlin', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'cpp',
    name: 'C++',
    category: 'programming',
    extensions: ['cpp', 'cxx', 'cc', 'c++', 'hpp', 'hxx', 'hh', 'h++'],
    monacoId: 'cpp',
    iconType: 'c-cpp',
    color: languageColor('cpp', 'programming'),
    aliases: ['c++', 'cplusplus'],
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'c',
    name: 'C',
    category: 'programming',
    extensions: ['c', 'h'],
    monacoId: 'c',
    iconType: 'c-cpp',
    color: languageColor('c', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'csharp',
    name: 'C#',
    category: 'programming',
    extensions: ['cs', 'csx'],
    monacoId: 'csharp',
    iconType: 'csharp',
    color: languageColor('csharp', 'programming'),
    aliases: ['c#', 'dotnet'],
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'swift',
    name: 'Swift',
    category: 'programming',
    extensions: ['swift'],
    monacoId: 'swift',
    iconType: 'swift',
    color: languageColor('swift', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'php',
    name: 'PHP',
    category: 'programming',
    extensions: ['php', 'phtml', 'php3', 'php4', 'php5', 'phps'],
    monacoId: 'php',
    iconType: 'php',
    color: languageColor('php', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'ruby',
    name: 'Ruby',
    category: 'programming',
    extensions: ['rb', 'rbw', 'rake', 'gemspec'],
    filenames: ['Rakefile', 'Gemfile'],
    monacoId: 'ruby',
    iconType: 'ruby',
    color: languageColor('ruby', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '#',
    blockComment: { start: '=begin', end: '=end' },
  },
  {
    id: 'scala',
    name: 'Scala',
    category: 'programming',
    extensions: ['scala', 'sc'],
    monacoId: 'scala',
    iconType: 'scala',
    color: languageColor('scala', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'dart',
    name: 'Dart',
    category: 'programming',
    extensions: ['dart'],
    monacoId: 'dart',
    iconType: 'dart',
    color: languageColor('dart', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'lua',
    name: 'Lua',
    category: 'programming',
    extensions: ['lua'],
    monacoId: 'lua',
    iconType: 'lua',
    color: languageColor('lua', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '--',
    blockComment: { start: '--[[', end: ']]' },
  },
  {
    id: 'r',
    name: 'R',
    category: 'programming',
    extensions: ['r', 'R', 'rmd'],
    monacoId: 'r',
    iconType: 'r',
    color: languageColor('r', 'programming'),
    supportsComments: true,
    lineCommentPrefix: '#',
  },

  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'html',
    name: 'HTML',
    category: 'markup',
    extensions: ['html', 'htm', 'xhtml', 'shtml'],
    monacoId: 'html',
    iconType: 'html',
    color: languageColor('html', 'markup'),
    supportsComments: true,
    blockComment: { start: '<!--', end: '-->' },
  },
  {
    id: 'xml',
    name: 'XML',
    category: 'markup',
    extensions: ['xml', 'xsl', 'xslt', 'xsd', 'svg', 'rss', 'atom'],
    monacoId: 'xml',
    iconType: 'xml',
    color: languageColor('xml', 'markup'),
    supportsComments: true,
    blockComment: { start: '<!--', end: '-->' },
  },
  {
    id: 'vue',
    name: 'Vue',
    category: 'markup',
    extensions: ['vue'],
    monacoId: 'vue',
    iconType: 'vue',
    color: languageColor('vue', 'markup'),
    supportsComments: true,
    blockComment: { start: '<!--', end: '-->' },
  },
  {
    id: 'svelte',
    name: 'Svelte',
    category: 'markup',
    extensions: ['svelte'],
    monacoId: 'html',
    iconType: 'svelte',
    color: languageColor('svelte', 'markup'),
    supportsComments: true,
    blockComment: { start: '<!--', end: '-->' },
  },

  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'css',
    name: 'CSS',
    category: 'stylesheet',
    extensions: ['css'],
    monacoId: 'css',
    iconType: 'css',
    color: languageColor('css', 'stylesheet'),
    supportsComments: true,
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'scss',
    name: 'SCSS',
    category: 'stylesheet',
    extensions: ['scss'],
    monacoId: 'scss',
    iconType: 'sass',
    color: languageColor('scss', 'stylesheet'),
    parent: 'css',
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'sass',
    name: 'Sass',
    category: 'stylesheet',
    extensions: ['sass'],
    monacoId: 'scss',
    iconType: 'sass',
    color: languageColor('sass', 'stylesheet'),
    parent: 'css',
    supportsComments: true,
    lineCommentPrefix: '//',
  },
  {
    id: 'less',
    name: 'Less',
    category: 'stylesheet',
    extensions: ['less'],
    monacoId: 'less',
    iconType: 'less',
    color: languageColor('less', 'stylesheet'),
    parent: 'css',
    supportsComments: true,
    lineCommentPrefix: '//',
    blockComment: { start: '/*', end: '*/' },
  },

  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'json',
    name: 'JSON',
    category: 'data',
    extensions: ['json', 'jsonc', 'json5'],
    filenames: ['.babelrc', '.eslintrc', '.prettierrc', 'tsconfig.json', 'package.json'],
    monacoId: 'json',
    iconType: 'json',
    color: languageColor('json', 'data'),
    supportsComments: false,
  },
  {
    id: 'yaml',
    name: 'YAML',
    category: 'data',
    extensions: ['yaml', 'yml'],
    monacoId: 'yaml',
    iconType: 'yaml',
    color: languageColor('yaml', 'data'),
    supportsComments: true,
    lineCommentPrefix: '#',
  },
  {
    id: 'toml',
    name: 'TOML',
    category: 'data',
    extensions: ['toml'],
    filenames: ['Cargo.toml', 'pyproject.toml'],
    monacoId: 'toml',
    iconType: 'toml',
    color: languageColor('toml', 'data'),
    supportsComments: true,
    lineCommentPrefix: '#',
  },
  {
    id: 'sql',
    name: 'SQL',
    category: 'data',
    extensions: ['sql', 'mysql', 'pgsql', 'sqlite'],
    monacoId: 'sql',
    iconType: 'database',
    color: languageColor('sql', 'data'),
    supportsComments: true,
    lineCommentPrefix: '--',
    blockComment: { start: '/*', end: '*/' },
  },
  {
    id: 'graphql',
    name: 'GraphQL',
    category: 'data',
    extensions: ['graphql', 'gql'],
    monacoId: 'graphql',
    iconType: 'graphql',
    color: languageColor('graphql', 'data'),
    supportsComments: true,
    lineCommentPrefix: '#',
  },

  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'dockerfile',
    name: 'Dockerfile',
    category: 'config',
    extensions: ['dockerfile'],
    filenames: ['Dockerfile', 'Dockerfile.dev', 'Dockerfile.prod'],
    monacoId: 'dockerfile',
    iconType: 'docker',
    color: languageColor('dockerfile', 'config'),
    supportsComments: true,
    lineCommentPrefix: '#',
  },
  {
    id: 'makefile',
    name: 'Makefile',
    category: 'config',
    extensions: ['mk'],
    filenames: ['Makefile', 'makefile', 'GNUmakefile'],
    monacoId: 'makefile',
    iconType: 'makefile',
    color: languageColor('makefile', 'config'),
    supportsComments: true,
    lineCommentPrefix: '#',
  },
  {
    id: 'ini',
    name: 'INI',
    category: 'config',
    extensions: ['ini', 'cfg', 'conf', 'properties'],
    filenames: ['.editorconfig', '.gitconfig'],
    monacoId: 'ini',
    iconType: 'config',
    color: languageColor('ini', 'config'),
    supportsComments: true,
    lineCommentPrefix: ';',
  },
  {
    id: 'env',
    name: 'Environment',
    category: 'config',
    extensions: ['env'],
    filenames: ['.env', '.env.local', '.env.development', '.env.production'],
    monacoId: 'ini',
    iconType: 'config',
    color: languageColor('env', 'config'),
    supportsComments: true,
    lineCommentPrefix: '#',
  },

  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'shell',
    name: 'Shell',
    category: 'script',
    extensions: ['sh', 'bash', 'zsh', 'fish'],
    firstLineMatch: /^#!.*\b(bash|sh|zsh|fish)\b/,
    monacoId: 'shell',
    iconType: 'shell',
    color: languageColor('shell', 'script'),
    aliases: ['bash', 'zsh'],
    supportsComments: true,
    lineCommentPrefix: '#',
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    category: 'script',
    extensions: ['ps1', 'psm1', 'psd1'],
    monacoId: 'powershell',
    iconType: 'powershell',
    color: languageColor('powershell', 'script'),
    supportsComments: true,
    lineCommentPrefix: '#',
    blockComment: { start: '<#', end: '#>' },
  },
  {
    id: 'batch',
    name: 'Batch',
    category: 'script',
    extensions: ['bat', 'cmd'],
    monacoId: 'bat',
    iconType: 'batch',
    color: languageColor('batch', 'script'),
    supportsComments: true,
    lineCommentPrefix: 'REM',
  },

  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'markdown',
    name: 'Markdown',
    category: 'documentation',
    extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx'],
    filenames: ['README', 'CHANGELOG', 'LICENSE'],
    monacoId: 'markdown',
    iconType: 'markdown',
    color: languageColor('markdown', 'documentation'),
    supportsComments: false,
  },
  {
    id: 'restructuredtext',
    name: 'reStructuredText',
    category: 'documentation',
    extensions: ['rst'],
    monacoId: 'restructuredtext',
    iconType: 'text',
    color: languageColor('restructuredtext', 'documentation'),
    supportsComments: true,
    blockComment: { start: '..', end: '' },
  },

  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'image',
    name: 'Image',
    category: 'media',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif', 'tiff', 'tif'],
    monacoId: 'plaintext',
    iconType: 'image',
    color: languageColor('image', 'media'),
    supportsComments: false,
  },
  
  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'audio',
    name: 'Audio',
    category: 'media',
    extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'aiff'],
    monacoId: 'plaintext',
    iconType: 'audio',
    color: languageColor('audio', 'media'),
    supportsComments: false,
  },
  
  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'video',
    name: 'Video',
    category: 'media',
    extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpeg', 'mpg'],
    monacoId: 'plaintext',
    iconType: 'video',
    color: languageColor('video', 'media'),
    supportsComments: false,
  },
  
  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'font',
    name: 'Font',
    category: 'media',
    extensions: ['ttf', 'otf', 'woff', 'woff2', 'eot'],
    monacoId: 'plaintext',
    iconType: 'font',
    color: languageColor('font', 'media'),
    supportsComments: false,
  },
  
  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'archive',
    name: 'Archive',
    category: 'binary',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'dmg', 'iso', 'tgz'],
    monacoId: 'plaintext',
    iconType: 'archive',
    color: languageColor('archive', 'binary'),
    supportsComments: false,
  },
  
  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'binary',
    name: 'Binary',
    category: 'binary',
    extensions: ['exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'o', 'a', 'lib'],
    monacoId: 'plaintext',
    iconType: 'binary',
    color: languageColor('binary', 'binary'),
    supportsComments: false,
  },

  // -------------------------------------------------------------------------
  
  // -------------------------------------------------------------------------
  {
    id: 'plaintext',
    name: 'Plain Text',
    category: 'other',
    extensions: ['txt', 'text', 'log'],
    monacoId: 'plaintext',
    iconType: 'text',
    color: languageColor('plaintext', 'other'),
    supportsComments: false,
  },
];

// ============================================================================

// ============================================================================

 
class LanguageRegistry {
  private static instance: LanguageRegistry;
  
   
  private languages = new Map<string, Language>();
  
   
  private extensionIndex = new Map<string, Language[]>();
  
   
  private filenameIndex = new Map<string, Language>();
  
   
  private aliasIndex = new Map<string, Language>();
  
   
  private monacoIdIndex = new Map<string, Language[]>();
  
   
  private plugins: LanguagePlugin[] = [];
  
  private constructor() {
    this.initBuiltinLanguages();
  }
  
   
  public static getInstance(): LanguageRegistry {
    if (!LanguageRegistry.instance) {
      LanguageRegistry.instance = new LanguageRegistry();
    }
    return LanguageRegistry.instance;
  }
  
   
  private initBuiltinLanguages(): void {
    BUILTIN_LANGUAGES.forEach(lang => this.register(lang));
    log.debug('Initialized', { languageCount: this.languages.size });
  }
  
   
  public register(language: Language): void {
    
    this.languages.set(language.id, language);
    
    
    language.extensions.forEach(ext => {
      const existing = this.extensionIndex.get(ext) || [];
      existing.push(language);
      this.extensionIndex.set(ext, existing);
    });
    
    
    language.filenames?.forEach(filename => {
      this.filenameIndex.set(filename.toLowerCase(), language);
    });
    
    
    language.aliases?.forEach(alias => {
      this.aliasIndex.set(alias.toLowerCase(), language);
    });
    
    
    const monacoLangs = this.monacoIdIndex.get(language.monacoId) || [];
    monacoLangs.push(language);
    this.monacoIdIndex.set(language.monacoId, monacoLangs);
  }
  
   
  public registerPlugin(plugin: LanguagePlugin): void {
    this.plugins.push(plugin);
    
    
    plugin.getLanguages().forEach(lang => this.register(lang));
    
    log.debug('Plugin registered', { pluginName: plugin.name });
  }
  
   
  public getById(id: string): Language | undefined {
    return this.languages.get(id) || this.aliasIndex.get(id.toLowerCase());
  }
  
   
  public getByExtension(extension: string): Language[] {
    const ext = extension.toLowerCase().replace(/^\./, '');
    return this.extensionIndex.get(ext) || [];
  }
  
   
  public getByFilename(filename: string): Language | undefined {
    return this.filenameIndex.get(filename.toLowerCase());
  }
  
   
  public getByMonacoId(monacoId: string): Language[] {
    return this.monacoIdIndex.get(monacoId) || [];
  }
  
   
  public getAll(): Language[] {
    return Array.from(this.languages.values());
  }
  
   
  public getByCategory(category: LanguageCategory): Language[] {
    return this.getAll().filter(lang => lang.category === category);
  }
  
   
  public getDefault(): Language {
    return this.languages.get('plaintext')!;
  }
  
   
  public has(id: string): boolean {
    return this.languages.has(id) || this.aliasIndex.has(id.toLowerCase());
  }
  
   
  public getStats(): {
    totalLanguages: number;
    byCategory: Record<LanguageCategory, number>;
    pluginCount: number;
  } {
    const byCategory: Record<string, number> = {};
    
    this.getAll().forEach(lang => {
      byCategory[lang.category] = (byCategory[lang.category] || 0) + 1;
    });
    
    return {
      totalLanguages: this.languages.size,
      byCategory: byCategory as Record<LanguageCategory, number>,
      pluginCount: this.plugins.length,
    };
  }
}


export const languageRegistry = LanguageRegistry.getInstance();
export default LanguageRegistry;
