import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelShell } from '../../shell/PanelShell.js';
import '../../styles/app.css';
import { applyPreference, readPreference } from '../../lib/theme.js';

// Before the first render, so the panel never flashes the wrong theme.
applyPreference(readPreference());

const container = document.getElementById('root');
if (!container) throw new Error('DayDesk: #root is missing from the side panel document.');

createRoot(container).render(
  <StrictMode>
    <PanelShell />
  </StrictMode>,
);
