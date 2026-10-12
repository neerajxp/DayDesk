import { defineConfig } from 'wxt';

/**
 * DayDesk extension build config.
 *
 * The helper's port appears in host_permissions. MV3 enforces CORS on fetches
 * from extension pages, and listing the origin here is what allows the side
 * panel to call the helper at all.
 */
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'DayDesk',
    short_name: 'DayDesk',
    description: 'Your day at a glance: to-dos from your Yahoo mail and chosen WhatsApp chats, in the side panel.',
    version: '0.1.0',
    // Side Panel API landed in 114; openPanelOnActionClick needs 116.
    minimum_chrome_version: '116',
    permissions: ['sidePanel', 'storage'],
    host_permissions: ['http://127.0.0.1:4287/*'],
    action: {
      default_title: 'Open DayDesk',
    },
  },
});
