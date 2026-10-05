import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyDocument } from './i18n';
import '@warqa/brand/tokens.css';
import '@warqa/brand/fonts.css';
import './styles.css';

applyDocument();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
