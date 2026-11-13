import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerVoyageIpcHandlers } from './ipc/voyage-handlers'

const LM_STUDIO_URL = 'http://127.0.0.1:1234'

type ModelResponse = {
  data?: Array<{ id?: string }>
}

type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null
      reasoning_content?: string | null
    }
    finish_reason?: string | null
  }>
}

async function lmRequest(path: string, body?: object): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), body ? 120000 : 15000)

  try {
    const response = await fetch(`${LM_STUDIO_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })

    const data = await response.json()

    if (!response.ok) {
      const error = data as { error?: { message?: string } }
      throw new Error(error.error?.message || `LM Studio respondió HTTP ${response.status}`)
    }

    return data
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado. Comprueba que LM Studio esté respondiendo.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

ipcMain.removeHandler('lmstudio:list-models')
ipcMain.removeHandler('lmstudio:chat')

ipcMain.handle('lmstudio:list-models', async () => {
  try {
    const result = (await lmRequest('/v1/models')) as ModelResponse
    return {
      success: true,
      models: (result.data || [])
        .filter((model) => typeof model.id === 'string')
        .map((model) => model.id as string)
    }
  } catch (error) {
    return {
      success: false,
      models: [],
      error: error instanceof Error ? error.message : 'Error desconocido'
    }
  }
})

ipcMain.handle(
  'lmstudio:chat',
  async (_event, payload: { model: string; prompt: string; maxTokens?: number; jsonMode?: boolean }) => {
    try {
      if (!payload || typeof payload.model !== 'string' || !payload.model.trim()) {
        throw new Error('Selecciona un modelo.')
      }

      if (typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
        throw new Error('Escribe una instrucción.')
      }

      const maxTokens = Math.min(8192, Math.max(256, Number(payload.maxTokens) || 4096))

      const requestBody = {
        model: payload.model,
        messages: [{ role: 'user', content: payload.prompt }],
        max_tokens: maxTokens,
        temperature: payload.jsonMode ? 0.2 : 0.7,
        ...(payload.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        stream: false
      }

      let result: ChatResponse
      try {
        result = (await lmRequest('/v1/chat/completions', requestBody)) as ChatResponse
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        // Algunos modelos/servidores compatibles con OpenAI no admiten response_format.
        // Reintentar una sola vez sin modo JSON evita que esa limitación bloquee la generación.
        if (!payload.jsonMode || !message.includes('HTTP 400')) throw error

        const compatibleBody = {
          model: requestBody.model,
          messages: requestBody.messages,
          max_tokens: requestBody.max_tokens,
          temperature: requestBody.temperature,
          stream: requestBody.stream
        }
        result = (await lmRequest('/v1/chat/completions', compatibleBody)) as ChatResponse
      }

      const message = result.choices?.[0]?.message
      const content = typeof message?.content === 'string' ? message.content.trim() : ''

      return {
        success: true,
        content,
        reasoningDetected: Boolean(message?.reasoning_content),
        finishReason: result.choices?.[0]?.finish_reason || null
      }
    } catch (error) {
      return {
        success: false,
        content: '',
        reasoningDetected: false,
        error: error instanceof Error ? error.message : 'Error desconocido'
      }
    }
  }
)

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1150,
    height: 800,
    minWidth: 850,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerVoyageIpcHandlers()
  electronApp.setAppUserModelId('com.voyage.aicompanion')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})