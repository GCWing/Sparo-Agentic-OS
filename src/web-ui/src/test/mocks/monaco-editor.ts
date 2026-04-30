const noopDisposable = { dispose: () => {} };

export const Uri = {
  parse: (value: string) => ({
    toString: () => value,
    path: value.replace(/^file:\/\//, ''),
  }),
  file: (value: string) => ({
    toString: () => `file://${value}`,
    path: value,
  }),
};

export const editor = {
  getEditors: () => [],
  onWillDisposeModel: () => noopDisposable,
  getModel: () => null,
  createModel: (value = '', language = 'plaintext', uri = Uri.parse('file:///mock')) => ({
    uri,
    getValue: () => value,
    setValue: () => {},
    getLanguageId: () => language,
    onDidChangeContent: () => noopDisposable,
    isDisposed: () => false,
    dispose: () => {},
  }),
  setModelLanguage: () => {},
  create: () => ({
    getModel: () => null,
    setModel: () => {},
    updateOptions: () => {},
    onDidChangeModelContent: () => noopDisposable,
    onDidChangeCursorPosition: () => noopDisposable,
    onDidFocusEditorText: () => noopDisposable,
    onDidBlurEditorText: () => noopDisposable,
    getDomNode: () => null,
    dispose: () => {},
  }),
  setTheme: () => {},
};

export default {
  editor,
  Uri,
};
