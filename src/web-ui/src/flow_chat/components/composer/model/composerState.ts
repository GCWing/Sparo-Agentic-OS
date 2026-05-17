export type ChatInputTarget = 'main' | 'btw';

export interface ComposerSlashCommandState {
  isActive: boolean;
  kind: 'modes' | 'actions' | 'all';
  query: string;
  selectedIndex: number;
}
