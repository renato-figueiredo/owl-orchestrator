import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>Olá, OWL 🦉</h1>
    </main>
  </StrictMode>,
);
