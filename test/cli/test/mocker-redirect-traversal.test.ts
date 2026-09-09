import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { expect, it, onTestFinished } from 'vitest'
import { WebSocket } from 'ws'
// `test/cli` doesn't depend on `@vitest/mocker`, so the plugin is imported
// from the source directly (same approach as `reported-tasks.test.ts`)
import { interceptorPlugin } from '../../../packages/mocker/src/node/interceptorPlugin'

const root = fileURLToPath(
  new URL('../fixtures/mocker/redirect-security/root', import.meta.url),
)

async function createMockerServer() {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: {
      fs: { allow: [root] },
    },
    plugins: [
      {
        name: 'test:virtual-mock',
        enforce: 'pre',
        resolveId(id) {
          if (id === '/mock') {
            return id
          }
        },
      },
      interceptorPlugin(),
    ],
  })
  await server.listen()
  onTestFinished(() => server.close())
  const port = new URL(server.resolvedUrls!.local[0]).port
  return { server, port }
}

function registerRedirect(port: string, redirect: string) {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, 'vite-hmr')
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('timed out waiting for the register result'))
    }, 20_000)
    ws.on('message', (raw) => {
      let message: any
      try {
        message = JSON.parse(raw.toString())
      }
      catch {
        return
      }
      if (message.type === 'custom' && message.event === 'vitest:interceptor:register:result') {
        clearTimeout(timeout)
        ws.close()
        resolve()
      }
    })
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'custom',
        event: 'vitest:interceptor:register',
        data: { type: 'redirect', raw: '', id: '/mock', url: '/mock', redirect },
      }))
    })
    ws.on('error', reject)
  })
}

// an opaque URL scheme keeps the `..` segments (a hierarchical URL would
// normalize them away), so join(root, pathname) resolves outside the root
const traversals = [
  'traversal:../secret.txt',
  'traversal:./../secret.txt',
  'traversal:sub/../../secret.txt',
]

traversals.forEach((redirect) => {
  it(`rejects a redirect mock whose target escapes the project root: ${redirect}`, async () => {
    const { server, port } = await createMockerServer()
    await registerRedirect(port, redirect)
    const result = await server.transformRequest('/mock').catch(() => null)
    expect(result?.code ?? '').not.toContain('should-never-be-served-as-a-module')
    expect(result).toBe(null)
  })
})

it('serves a redirect mock whose target stays inside the project root', async () => {
  const { server, port } = await createMockerServer()
  await registerRedirect(port, 'traversal:inroot.js')
  const result = await server.transformRequest('/mock').catch(() => null)
  expect(result?.code).toContain('in-root-redirect-ok')
})

it('does not register websocket events when they are disabled', () => {
  const registered: string[] = []
  const server: any = {
    config: { root },
    ws: {
      on: (event: string) => registered.push(event),
      send: () => {},
    },
  }

  const enabled: any = interceptorPlugin()
  enabled.configureServer.call({}, server)
  expect(registered).toContain('vitest:interceptor:register')

  registered.length = 0
  const disabled: any = interceptorPlugin({ registerWebSocketEvents: false })
  disabled.configureServer.call({}, server)
  expect(registered).toEqual([])
})
