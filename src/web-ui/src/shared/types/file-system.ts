export interface FileSystemNode {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  children?: FileSystemNode[];
  extension?: string;
  lastModified?: Date;
  isSelected?: boolean;
  isExpanded?: boolean;
  totalAnchors?: number;
  hasFixResult?: boolean;
}
