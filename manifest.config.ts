import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

// See CONTEXT.txt §5 (stack). Keep permissions minimal; every host here is an API we call on purpose.
export default defineManifest({
  manifest_version: 3,
  name: 'Tailor',
  version: pkg.version,
  description:
    'Your ChatGPT and Claude history knows you better than any website does. Tailor rewrites any page for you, cites your words, and code checks every fact.',
  action: { default_popup: 'src/ui/popup/index.html', default_title: 'Tailor' },
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
