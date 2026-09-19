import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { FlagsProvider } from './lib/flags.tsx';
import './styles/app.css';

const host = document.getElementById('root');
if (!host) throw new Error('#root is missing from the document');

createRoot(host).render(
  <StrictMode>
    <FlagsProvider>
      <App />
    </FlagsProvider>
  </StrictMode>,
);

// The boot splash in index.html covers the gap before this point. It fades
// rather than vanishing, so the app arrives instead of replacing something.
const boot = document.getElementById('boot');
if (boot) {
  requestAnimationFrame(() => {
    boot.style.transition = 'opacity 260ms ease-out';
    boot.style.opacity = '0';
    boot.style.pointerEvents = 'none';
    setTimeout(() => boot.remove(), 320);
  });
}
