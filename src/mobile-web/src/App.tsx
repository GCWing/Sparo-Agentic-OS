import React from 'react';
import { I18nProvider } from './i18n';
import { ThemeProvider } from './theme';
import AppShell from './app/AppShell';
import './styles/index.scss';

const App: React.FC = () => (
  <ThemeProvider>
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  </ThemeProvider>
);

export default App;
