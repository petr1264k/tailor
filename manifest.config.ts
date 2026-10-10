import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

// The fitted-page mark (src/brand). PNGs are rendered from src/assets/logo/tailor-tile*.svg; 16 uses the solid form.
const ICONS = {
  16: 'src/assets/icons/icon-16.png',
  32: 'src/assets/icons/icon-32.png',
  48: 'src/assets/icons/icon-48.png',
  128: 'src/assets/icons/icon-128.png',
}

// See CONTEXT.txt §5 (stack). Keep permissions minimal; every host here is an API we call on purpose.
export default defineManifest({
  manifest_version: 3,
  name: 'Tailor',
  version: pkg.version,
  description:
    'Your ChatGPT and Claude history knows you better than any website does. Tailor rewrites any page for you, cites your words, and code checks every fact.',
  icons: ICONS,
  action: { default_popup: 'src/ui/popup/index.html', default_title: 'Tailor', default_icon: ICONS },
  options_ui: { page: 'src/ui/profile/index.html', open_in_tab: true },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*', 'file:///*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['storage', 'unlimitedStorage', 'activeTab', 'tabs'],
  host_permissions: [
    'https://api.anthropic.com/*',
    'https://www.coframe.com/*',
    'https://coframe.com/*',
    'https://generativelanguage.googleapis.com/*',
    'https://openrouter.ai/*',
  ],
})
