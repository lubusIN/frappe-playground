import { defineConfig } from 'vitepress'
import { lucideIcons } from 'frappe-ui/vite'
import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'

const playgroundLogo = fileURLToPath(new URL('../../.github/logo.svg', import.meta.url))

export default defineConfig({
  title: 'Frappe Playground',
  description: 'Run, host, customize, and understand Frappe Playground.',
  lang: 'en-US',
  base: '/docs/',
  outDir: fileURLToPath(new URL('../../dist/docs', import.meta.url)),
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['meta', { name: 'theme-color', content: '#171717' }],
    ['link', { rel: 'icon', href: '/docs/logo.svg', type: 'image/svg+xml' }],
  ],
  themeConfig: {
    name: 'Frappe Playground',
    githubUrl: 'https://github.com/lubusIN/frappe-playground',
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Playground interface', link: '/guide/interface' },
        ],
      },
      {
        text: 'Using the playground',
        items: [
          { text: 'Instances and storage', link: '/guide/instances' },
          { text: 'Boot flags', link: '/guide/boot-flags' },
          { text: 'Optional apps', link: '/guide/apps' },
          { text: 'Limits and browser support', link: '/guide/limitations' },
          { text: 'Troubleshooting', link: '/guide/troubleshooting' },
        ],
      },
      {
        text: 'Self-hosting',
        items: [
          { text: 'Hosting overview', link: '/hosting/' },
          { text: 'Cloudflare Pages', link: '/hosting/cloudflare' },
          { text: 'Other static hosts', link: '/hosting/static-hosts' },
          { text: 'Customization', link: '/hosting/customize' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'System overview', link: '/architecture/' },
          { text: 'Boot lifecycle', link: '/architecture/boot-lifecycle' },
        ],
      },
      {
        text: 'Execution contexts',
        items: [
          { text: 'Client shell', link: '/architecture/client-shell' },
          { text: 'Service Worker', link: '/architecture/service-worker' },
          { text: 'Server worker', link: '/architecture/server-worker' },
        ],
      },
      {
        text: 'Data flows',
        items: [
          { text: 'Requests and routing', link: '/architecture/routing' },
          { text: 'Persistence and isolation', link: '/architecture/persistence' },
          { text: 'Protocol contracts', link: '/architecture/protocol' },
        ],
      },
      {
        text: 'Runtime and trust',
        items: [
          { text: 'Python and Frappe runtime', link: '/architecture/runtime' },
          { text: 'Runtime build pipeline', link: '/architecture/runtime-build' },
          { text: 'Security and trust boundaries', link: '/architecture/security' },
        ],
      },
      {
        text: 'Contributing',
        items: [
          { text: 'Contributor setup', link: '/development/' },
          { text: 'Build system', link: '/development/build-system' },
          { text: 'Testing', link: '/development/testing' },
          { text: 'Repository map', link: '/development/repository-map' },
          { text: 'Configuration reference', link: '/development/configuration' },
          { text: 'Upstream notes', link: '/development/upstream-notes' },
          { text: 'Documentation maintenance', link: '/development/documentation' },
        ],
      },
    ],
    search: { provider: 'local' },
  },
  vite: {
    // The Espresso theme consumes these CommonJS/extensionless packages from
    // source. Pre-bundling gives the browser stable ESM interop in dev.
    optimizeDeps: {
      include: [
        'vue-router',
        '@vueuse/core',
        'reka-ui',
        '@headlessui/vue',
        '@floating-ui/vue',
        'tippy.js',
        'vue-sonner',
        'fuzzysort',
        'marked',
        'dompurify',
        'idb-keyval',
        'dayjs',
      ],
    },
    plugins: [
      lucideIcons(),
      {
        name: 'frappe-playground-docs-logo',
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url || '/', 'http://docs.local').pathname
            if (pathname !== '/docs/logo.svg' && pathname !== '/logo.svg') {
              next()
              return
            }
            response.statusCode = 200
            response.setHeader('Content-Type', 'image/svg+xml')
            response.setHeader('Cache-Control', 'no-store')
            if (request.method === 'HEAD') {
              response.end()
              return
            }
            fs.createReadStream(playgroundLogo).pipe(response)
          })
        },
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'logo.svg',
            source: fs.readFileSync(playgroundLogo),
          })
        },
      },
    ],
    resolve: {
      alias: {
        // The package exposes a Node-only config helper under the `node`
        // condition. Theme code must resolve to its browser/SSR barrel.
        'frappe-ui/vitepress': fileURLToPath(
          new URL('../../node_modules/frappe-ui/vitepress/index.ts', import.meta.url),
        ),
      },
    },
    ssr: {
      noExternal: ['frappe-ui', 'dayjs'],
    },
  },
})
