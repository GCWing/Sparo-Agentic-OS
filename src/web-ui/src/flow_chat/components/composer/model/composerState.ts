export type ChatInputTarget = 'main' | 'btw';

export interface ComposerSlashCommandState {
  isActive: boolean;
  kind: 'agents' | 'actions' | 'all';
  query: string;
  selectedIndex: number;
}
