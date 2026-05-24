import { PluginKey } from '@tiptap/pm/state';

export interface CoauthorCommentPin {
  id: string;
  blockId?: string;
  message: string;
  severity?: 'info' | 'warning' | 'error';
}

export interface CoauthorCommentPinsState {
  pins: CoauthorCommentPin[];
  labels: {
    comment: string;
  };
}

export const coauthorCommentPinsPluginKey = new PluginKey<CoauthorCommentPinsState | null>(
  'meditorCoauthorCommentPins'
);
