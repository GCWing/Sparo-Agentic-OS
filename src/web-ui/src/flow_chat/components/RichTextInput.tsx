import React from 'react';
import {
  ComposerEditor,
  type RichTextInputHandle,
  type RichTextInputProps,
} from '../composer/editor/ComposerEditor';
import './RichTextInput.scss';

export type {
  ComposerIngressContext,
  MentionState,
  RichTextInputHandle,
  RichTextInputProps,
} from '../composer/editor/ComposerEditor';

/** Compatibility surface while the Composer owns the concrete editor engine. */
export const RichTextInput = React.forwardRef<RichTextInputHandle, RichTextInputProps>((props, ref) => (
  <ComposerEditor ref={ref} {...props} />
));

RichTextInput.displayName = 'RichTextInput';

export default RichTextInput;
