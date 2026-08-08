/**
 * File tab manager.
 *
 * Opens files in the editor canvas and supports optional line/range navigation.
 */
import { normalizePath } from '@/shared/utils/pathUtils';
import { getEditorType } from '@/infrastructure/language-detection';
import type { LineRange } from '@/shared/markdown';
import { openProjectCanvasItem } from '@/app/components/panels/content-canvas/openCanvasItem';
import type { CanvasItemDescriptor } from '@/app/components/panels/content-canvas/types';
import { openActiveAuxiliaryItem } from '@/app/auxiliary-surface';
export interface FileTabOptions {
   
  filePath: string;
   
  fileName?: string;
   
  workspacePath?: string;
   
  jumpToLine?: number;
   
  jumpToColumn?: number;
   
  jumpToRange?: LineRange;
  
  navigationToken?: number;
   
  mode?: 'agent' | 'project';
   
  forceNew?: boolean;
   
  splitView?: boolean;
   
  targetGroup?: 'primary' | 'secondary';
}

 
class FileTabManager {
  private static instance: FileTabManager;

  private constructor() {}

  public static getInstance(): FileTabManager {
    if (!FileTabManager.instance) {
      FileTabManager.instance = new FileTabManager();
    }
    return FileTabManager.instance;
  }

   
  public openFile(options: FileTabOptions): void {
    const {
      filePath,
      fileName: providedFileName,
      workspacePath,
      jumpToLine,
      jumpToColumn,
      jumpToRange,
      navigationToken,
      mode = 'agent',
      forceNew = false,
      splitView = false,
      targetGroup = 'secondary',
    } = options;

    
    const normalizedPath = normalizePath(filePath);
    
    
    const fileName = providedFileName || normalizedPath.split(/[/\\]/).pop() || '';
    
    
    const editorType = getEditorType(fileName);
    
    
    const finalJumpToRange = jumpToRange || (jumpToLine ? { start: jumpToLine, end: jumpToColumn ? jumpToLine : undefined } : undefined);
    
    
    const tabData = {
      filePath: normalizedPath,
      fileName,
      workspacePath,
      navigationToken: navigationToken ?? Date.now(),
      
      ...(finalJumpToRange && { jumpToRange: finalJumpToRange }),
      
      ...(!finalJumpToRange && jumpToLine && { jumpToLine }),
      ...(!finalJumpToRange && jumpToColumn && { jumpToColumn })
    };
    
    
    const item: CanvasItemDescriptor = {
      type: editorType,
      title: fileName,
      data: tabData,
      metadata: forceNew ? {} : { duplicateCheckKey: normalizedPath },
      duplicateCheckKey: forceNew ? undefined : normalizedPath,
      replaceExisting: Boolean(finalJumpToRange || jumpToLine || jumpToColumn),
    };

    
    if (splitView) {
      item.targetGroup = targetGroup;
      item.enableSplitView = true;
    }

    if (mode === 'project') {
      openProjectCanvasItem(item);
    } else {
      openActiveAuxiliaryItem(item);
    }
  }

   
  public openFileAndJump(
    filePath: string,
    line: number,
    column?: number,
    options?: Partial<FileTabOptions>
  ): void {
    this.openFile({
      filePath,
      jumpToLine: line,
      jumpToColumn: column,
      ...options
    });
  }

   
  public openFileAndJumpToRange(
    filePath: string,
    range: LineRange,
    options?: Partial<FileTabOptions>
  ): void {
    this.openFile({
      filePath,
      jumpToRange: range,
      ...options
    });
  }
}


export const fileTabManager = FileTabManager.getInstance();


export type { FileTabManager };
