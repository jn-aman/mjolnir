import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import './styles/app.css';

const host = document.getElementById('root');
if (!host) throw new Error('#root is missing from the document');

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
