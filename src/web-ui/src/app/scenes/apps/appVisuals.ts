import {
  Bot,
  BriefcaseBusiness,
  Bug,
  Code2,
  Cpu,
  FileText,
  FlaskConical,
  Layers,
  PenLine,
  Server,
  Terminal,
  type LucideProps,
} from 'lucide-react';
import type React from 'react';

export type AppIconKey =
  | 'bot'
  | 'briefcase'
  | 'bug'
  | 'code2'
  | 'cpu'
  | 'filetext'
  | 'flask'
  | 'layers'
  | 'penline'
  | 'server'
  | 'terminal';

export const APP_ICON_MAP: Record<AppIconKey, React.FC<LucideProps>> = {
  bot: Bot,
  briefcase: BriefcaseBusiness,
  bug: Bug,
  code2: Code2,
  cpu: Cpu,
  filetext: FileText,
  flask: FlaskConical,
  layers: Layers,
  penline: PenLine,
  server: Server,
  terminal: Terminal,
};

export const CAPABILITY_ACCENT: Record<string, string> = {
  Coding: 'var(--ds-color-accent-500)',
  Documents: 'var(--color-success)',
  Analysis: 'var(--ds-color-purple-500)',
  Testing: 'var(--color-warning)',
  Creative: 'var(--ds-color-accent-500)',
  Operations: 'var(--color-info)',
};
