import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelShell } from '../../shell/PanelShell.js';
import '../../styles/app.css';
import { applyPreference, readPreference } from '../../lib/theme.js';
import { applyStyle, readStyle } from '../../lib/style.js';

// Before the first render, so the panel never flashes the wrong theme or style.
applyPreference(readPreference());
applyStyle(readStyle());

const container = document.getElementById('root');
if (!container) throw new Error('DayDesk: #root is missing from the side panel document.');

createRoot(container).render(
  <StrictMode>
    <PanelShell />
  </StrictMode>,
);
