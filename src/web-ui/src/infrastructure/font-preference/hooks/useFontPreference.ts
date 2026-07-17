
import { useEffect } from 'react';
import { useFontPreferenceStore } from '../store/fontPreferenceStore';

export function useFontPreference() {
  const {
    preference,
    initialized,
    loading,
    error,
    initialize,
    setUiSize,
    setFlowChatFont,
    setMarkdownEditorFont,
    reset,
  } = useFontPreferenceStore();

  useEffect(() => {
    if (!initialized && !loading && !error) {
      void initialize();
    }
  }, [error, initialized, loading, initialize]);

  return {
    preference,
    initialized,
    loading,
    error,
    retry: initialize,
    setUiSize,
    setFlowChatFont,
    setMarkdownEditorFont,
    reset,
  };
}
