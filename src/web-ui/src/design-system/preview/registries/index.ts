import type { PreviewCategory } from '@/design-system/types';
import { primitivePreviewCategories } from './primitives';
import { patternPreviewCategories } from './patterns';
import { recipePreviewCategories } from './recipes';

export const designSystemPreviewCategories: PreviewCategory[] = [
  ...primitivePreviewCategories,
  ...patternPreviewCategories,
  ...recipePreviewCategories,
];
