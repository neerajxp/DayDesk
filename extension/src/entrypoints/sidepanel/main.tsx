import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelShell } from '../../shell/PanelShell.js';
import '../../styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('DayDesk: #root is missing from the side panel document.');

createRoot(container).render(
  <StrictMode>
    <PanelShell />
  </StrictMode>,
);
