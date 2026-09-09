import type { Plugin } from 'vite'
import type { MockedModuleSerialized } from '../registry'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { join } from 'node:path/posix'
import { ManualMockedModule, MockerRegistry } from '../registry'
import { cleanUrl, createManualModuleSource } from '../utils'
import { automockModule } from './automockPlugin'

export interface InterceptorPluginOptions {
  /**
   * @default "__vitest_mocker__"
   */
  globalThisAccessor?: string
  registry?: MockerRegistry
  /**
   * Register the `vitest:interceptor:*` WebSocket events in `configureServer`.
   * Disable this when mocks are registered through another authenticated
   * channel and the raw dev-server socket should not accept them.
   * @default true
   */
  registerWebSocketEvents?: boolean
}

// Vite only exposes `isFileLoadingAllowed` since v6, but this plugin also
// supports Vite 5, so the containment check is implemented here. The redirect
// is built with `node:path/posix`, so it can mix separators on Windows - the
// platform-native `relative` normalizes both sides before comparing.
function isPathInsideRoot(root: string, file: string): boolean {
  const relativePath = relative(root, file)
  if (relativePath === '' || isAbsolute(relativePath)) {
    return false
  }
  return relativePath.split(/[\\/]/)[0] !== '..'
}

export function interceptorPlugin(options: InterceptorPluginOptions = {}): Plugin {
  const registry = options.registry || new MockerRegistry()
  return {
    name: 'vitest:mocks:interceptor',
    enforce: 'pre',
    load: {
      order: 'pre',
      async handler(id) {
        const mock = registry.getById(id)
        if (!mock) {
          return
        }
        if (mock.type === 'manual') {
          const exports = Object.keys(await mock.resolve())
          const accessor = options.globalThisAccessor || '"__vitest_mocker__"'
          return createManualModuleSource(mock.url, exports, accessor)
        }
        if (mock.type === 'redirect') {
          return readFile(mock.redirect, 'utf-8')
        }
      },
    },
    transform: {
      order: 'post',
      handler(code, id) {
        const mock = registry.getById(id)
        if (!mock) {
          return
        }
        if (mock.type === 'automock' || mock.type === 'autospy') {
          const m = automockModule(code, mock.type, this.parse, {
            globalThisAccessor: options.globalThisAccessor,
          })

          return {
            code: m.toString(),
            map: m.generateMap({ hires: 'boundary', source: cleanUrl(id) }),
          }
        }
      },
    },
    configureServer(server) {
      if (options.registerWebSocketEvents === false) {
        return
      }
      server.ws.on('vitest:interceptor:register', (event: MockedModuleSerialized) => {
        if (event.type === 'manual') {
          const module = ManualMockedModule.fromJSON(event, async () => {
            const keys = await getFactoryExports(event.url)
            return Object.fromEntries(keys.map(key => [key, null]))
          })
          registry.add(module)
        }
        else {
          if (event.type === 'redirect') {
            const redirectUrl = new URL(event.redirect)
            const redirect = join(server.config.root, redirectUrl.pathname)
            // the redirect is served through the `load` hook above, so it must
            // stay inside the project root and never escape it
            if (!isPathInsideRoot(server.config.root, redirect)) {
              server.ws.send('vitest:interceptor:register:result')
              return
            }
            event.redirect = redirect
          }
          registry.register(event)
        }
        server.ws.send('vitest:interceptor:register:result')
      })
      server.ws.on('vitest:interceptor:delete', (id: string) => {
        registry.delete(id)
        server.ws.send('vitest:interceptor:delete:result')
      })
      server.ws.on('vitest:interceptor:invalidate', () => {
        registry.clear()
        server.ws.send('vitest:interceptor:invalidate:result')
      })

      function getFactoryExports(url: string) {
        server.ws.send('vitest:interceptor:resolve', url)
        let timeout: NodeJS.Timeout
        return new Promise<string[]>((resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`Timeout while waiting for factory exports of ${url}`))
          }, 10_000)
          server.ws.on('vitest:interceptor:resolved', ({ url: resolvedUrl, keys }: { url: string; keys: string[] }) => {
            if (resolvedUrl === url) {
              clearTimeout(timeout)
              resolve(keys)
            }
          })
        })
      }
    },
  }
}
