/**
 * dsh-model-persona —— 面板的 Host 数据通道（v3）
 *
 * 网页半区（client.js）通过三个只属于本插件的路由读写配置：
 *   GET  /model-persona/state    → 配置现状 + 当前真实模型 id + 命中键 + 会注入的文本
 *   POST /model-persona/config   → 校验后原子写回 config.json
 *   GET  /model-persona/reveal   → 只读：把真实模型 id 落盘供排查（面板也可看）
 *
 * 设计取舍（重要）：
 *   本插件**不引入任何第三方依赖**，所以没有用 dsh-budget 那套
 *   typert/remote 描述符（它要拉 zod）。这里用官方 `ctx.webServer` 的
 *   命名路由 —— 基于 node:http，零依赖，同样能双向通信。
 *
 * 安全边界：
 *   · 只读写 **一个** 已知路径（configPaths 解析出来的那个），不接受请求里带路径
 *   · 只接受 POST + application/json，且必须显式带 X-Model-Persona: 1（防跨站表单）
 *   · 响应不发 CORS 头；Host 头必须是 loopback（防 DNS rebinding）
 *   · 写盘走原子替换（core.writeConfigAtomic）
 *   · 任何异常都返回 JSON 错误，绝不抛进宿主
 */
import { readFileSync } from 'node:fs'
import {
  normalizeConfig,
  validateConfigInput,
  buildPanelState,
  writeConfigAtomic,
  summarizeAssembly,
} from './core.js'
import { upsertPrompt, removePrompt } from './prompt-lib.js'

const PREFIX = '/model-persona'
const LOG = '[model-persona]'

/** 只允许 loopback 的 Host 头 —— 防 DNS rebinding（本地服务被外部域名指过来） */
function isLoopbackHost(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader) return false
  const host = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function sendJson(res, code, payload) {
  try {
    const body = JSON.stringify(payload)
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch {
    /* 响应都发不出去就算了 */
  }
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        try { req.destroy() } catch { /* 已断 */ }
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * 注册面板路由。
 *
 * 调用方必须已经通过 `ctx.inject(['webServer'], scope => ...)` 拿到带
 * `webServer` 的 scope —— 用可选注入而不是硬 `inject`，这样在没有 webServer
 * 的 profile（例如 headless）里插件本体照常工作，只是面板不出现。
 *
 * @param {object} scope   带 webServer 的作用域
 * @param {object} deps    { configPath, lastModelPath, readConfig, warn }
 * @returns {() => void}   disposer
 */
export function registerPanelRoutes(scope, deps) {
  const {
    configPath,
    lastModelPath,
    readConfig,
    modelCatalog = { models: [], source: 'none', error: '' },
    setCatalog = () => {},
    assemblePreview = null,
    // 库读写由调用方注入：panel-host 不直接碰 fs，便于单测与替换
    readLibrary = () => [],
    writeLibrary = () => ({ ok: true }),
    // 网上抓取提示词：调用方注入（内部用 ctx.web.fetch）。null = 本机没这能力
    fetchPrompt = null,
    // 懒拉取模型目录：目录为空时 /state 现拉一次（加载期拉往往还没就绪）
    refreshCatalog = null,
    warn = () => {},
  } = deps

  const webServer = scope && scope.webServer
  if (!webServer || typeof webServer.register !== 'function') {
    warn(`${LOG} 拿不到 webServer，面板不可用（插件本体不受影响）`)
    return () => {}
  }

  const disposers = []

  const guard = (handler) => async (req, res) => {
    try {
      if (!isLoopbackHost(req.headers && req.headers.host)) {
        sendJson(res, 403, { ok: false, error: 'forbidden host' })
        return
      }
      await handler(req, res)
    } catch (e) {
      warn(`${LOG} 面板路由异常：${(e && e.message) || e}`)
      sendJson(res, 500, { ok: false, error: (e && e.message) || 'internal error' })
    }
  }

  // ① 读状态
  try {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: `${PREFIX}/state`,
        handler: guard(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          const cfg = readConfig()
          let model = ''
          try {
            model = String(JSON.parse(readFileSync(lastModelPath, 'utf8')).model || '')
          } catch {
            model = ''
          }
          // 目录为空就现拉一次：插件加载期 providers 常还没注册完，
          // 真环境实测那一刻拿到的是空目录（catalogError: 目录为空）。
          if (typeof refreshCatalog === 'function' && !(modelCatalog.models || []).length) {
            try {
              await refreshCatalog()
            } catch {
              /* 拉不到就用空目录 + 手贴入口 */
            }
          }
          sendJson(res, 200, {
            ok: true,
            state: buildPanelState(cfg, model),
            // 模型目录（双轨）：service 拿到或手贴的，都没有就是空数组
            models: Array.isArray(modelCatalog && modelCatalog.models)
              ? modelCatalog.models
              : [],
            catalogSource: (modelCatalog && modelCatalog.source) || 'none',
            catalogError: (modelCatalog && modelCatalog.error) || '',
          })
        }),
      }),
    )
  } catch (e) {
    warn(`${LOG} 注册 /state 失败：${(e && e.message) || e}`)
  }

  // ② 写配置
  try {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: `${PREFIX}/config`,
        handler: guard(async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          // 自定义头 = 简单 CSRF 防线：跨站表单发不出自定义头
          if (req.headers['x-model-persona'] !== '1') {
            return sendJson(res, 403, { ok: false, error: 'missing X-Model-Persona header' })
          }
          const ctype = String(req.headers['content-type'] || '')
          if (!ctype.includes('application/json')) {
            return sendJson(res, 415, { ok: false, error: 'content-type must be application/json' })
          }
          const raw = await readBody(req)
          let parsed
          try {
            parsed = JSON.parse(raw)
          } catch {
            return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
          }
          const checked = validateConfigInput(parsed)
          if (!checked.ok) return sendJson(res, 400, { ok: false, error: checked.error })

          const w = writeConfigAtomic(configPath, checked.value)
          if (!w.ok) return sendJson(res, 500, { ok: false, error: `写盘失败：${w.error}` })
          sendJson(res, 200, { ok: true })
        }),
      }),
    )
  } catch (e) {
    warn(`${LOG} 注册 /config 失败：${(e && e.message) || e}`)
  }

  // ②b 手贴模型目录（兜底轨：本机没有 sessionController 服务时用）
  try {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: `${PREFIX}/catalog`,
        handler: guard(async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          if (req.headers['x-model-persona'] !== '1') {
            return sendJson(res, 403, { ok: false, error: 'missing X-Model-Persona header' })
          }
          const ctype = String(req.headers['content-type'] || '')
          if (!ctype.includes('application/json')) {
            return sendJson(res, 415, { ok: false, error: 'content-type must be application/json' })
          }
          const raw = await readBody(req)
          let parsed
          try {
            parsed = JSON.parse(raw)
          } catch {
            return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
          }
          // 归一化与校验都在调用方（index.js 的 applyCatalog）里做，
          // 这里只负责把数据递过去，避免两套校验逻辑漂移。
          try {
            setCatalog(parsed && typeof parsed === 'object' ? parsed.catalog : parsed)
          } catch (e) {
            return sendJson(res, 400, { ok: false, error: (e && e.message) || '目录无效' })
          }
          if (!modelCatalog.models.length) {
            return sendJson(res, 400, { ok: false, error: '目录为空或没有可用条目' })
          }
          sendJson(res, 200, { ok: true, count: modelCatalog.models.length })
        }),
      }),
    )
  } catch (e) {
    warn(`${LOG} 注册 /catalog 失败：${(e && e.message) || e}`)
  }

  // ②c 提示词库：读 + 增删改
  //
  // 库存在独立文件（prompts.json），与 config.json 分离 —— 库是「可复用素材」，
  // 映射是「哪个模型用哪条」，混在一起改映射时会误删素材。
  // 内置条目由 prompt-lib 保护：删不掉，误删会自动恢复。
  try {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: `${PREFIX}/library`,
        handler: guard(async (req, res) => {
          if (req.method === 'GET') {
            return sendJson(res, 200, { ok: true, library: readLibrary() })
          }
          if (req.method !== 'POST') {
            return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          }
          if (req.headers['x-model-persona'] !== '1') {
            return sendJson(res, 403, { ok: false, error: 'missing X-Model-Persona header' })
          }
          const ctype = String(req.headers['content-type'] || '')
          if (!ctype.includes('application/json')) {
            return sendJson(res, 415, { ok: false, error: 'content-type must be application/json' })
          }
          const raw = await readBody(req)
          let parsed
          try {
            parsed = JSON.parse(raw)
          } catch {
            return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
          }
          // action: 'upsert' | 'remove'
          const action = parsed && parsed.action
          try {
            if (action === 'upsert') {
              const w = writeLibrary(upsertPrompt(readLibrary(), parsed.prompt))
              if (!w.ok) return sendJson(res, 500, { ok: false, error: `写盘失败：${w.error}` })
            } else if (action === 'remove') {
              const w = writeLibrary(removePrompt(readLibrary(), parsed.id))
              if (!w.ok) return sendJson(res, 500, { ok: false, error: `写盘失败：${w.error}` })
            } else {
              return sendJson(res, 400, { ok: false, error: `未知操作：${action}` })
            }
          } catch (e) {
            // upsertPrompt 对空文本等会抛，转成 400 而不是 500
            return sendJson(res, 400, { ok: false, error: (e && e.message) || '操作失败' })
          }
          sendJson(res, 200, { ok: true, library: readLibrary() })
        }),
      }),
    )
  } catch (e) {
    warn(`${LOG} 注册 /library 失败：${(e && e.message) || e}`)
  }

  // ②d 网上下载提示词（v4）
  //
  // 走官方 ctx.web.fetch（契约见 docs/subsystems/web.md）：WebFetchRequest 只有 url，
  // WebFetchResult 带 statusCode —— ⚠️ 非 2xx 是正常 result 不是异常，
  // 必须显式判，否则 404 页面的「Not Found」会被当成提示词存进库。
  //
  // ctx.web 是**可选服务**（本机装了 4 个 provider，但别的 profile 可能没有），
  // 拿不到就明确报错让用户自己粘贴，不做静默失败。
  try {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: `${PREFIX}/fetch`,
        handler: guard(async (req, res) => {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          if (req.headers['x-model-persona'] !== '1') {
            return sendJson(res, 403, { ok: false, error: 'missing X-Model-Persona header' })
          }
          const ctype = String(req.headers['content-type'] || '')
          if (!ctype.includes('application/json')) {
            return sendJson(res, 415, { ok: false, error: 'content-type must be application/json' })
          }
          const raw = await readBody(req)
          let parsed
          try {
            parsed = JSON.parse(raw)
          } catch {
            return sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' })
          }
          // ⚠️ 先判「能力有没有」再判「参数对不对」。
          // 反过来会让「本机没 ctx.web」伪装成「你 URL 填错了」——
          // 实测踩过：传 https://example.invalid 得到 400，误以为服务可用。
          if (typeof fetchPrompt !== 'function') {
            return sendJson(res, 503, {
              ok: false,
              error: '本机没有可用的联网抓取服务（ctx.web.fetch 不可用），请在下方手动粘贴提示词',
            })
          }
          const url = parsed && typeof parsed.url === 'string' ? parsed.url.trim() : ''
          if (!/^https?:\/\//i.test(url)) {
            return sendJson(res, 400, { ok: false, error: '只接受 http/https 链接' })
          }
          try {
            const out = await fetchPrompt(url)
            if (!out.ok) return sendJson(res, 400, { ok: false, error: out.error })
            sendJson(res, 200, { ok: true, text: out.text, truncated: out.truncated === true })
          } catch (e) {
            // 抓取失败是外部原因，用 502 区分「我们没坏，是对面取不到」
            sendJson(res, 502, { ok: false, error: `抓取失败：${(e && e.message) || e}` })
          }
        }),
      }),
    )
  } catch (e) {
    warn(`${LOG} 注册 /fetch 失败：${(e && e.message) || e}`)
  }

  // ③ 真实装配预览：调 ctx.systemPrompt.assemble() 拿真结果，逐段列出来
  //
  // v3 的预览只是「把配置重算一遍」，用户看不到真实系统提示词的形状。
  // 现在给真东西：有哪些段、顺序、字符数、自己的人格段插在哪、
  // replace 模式下哪些段被换掉了。拿不到 assemble 就降级回旧行为，绝不抛。
  try {
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: `${PREFIX}/preview`,
        handler: guard(async (req, res) => {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
          const cfg = normalizeConfig(readConfig())
          const url = new URL(req.url || '/', 'http://127.0.0.1')
          let model = url.searchParams.get('model') || ''
          if (!model) {
            try {
              model = String(JSON.parse(readFileSync(lastModelPath, 'utf8')).model || '')
            } catch {
              model = ''
            }
          }
          const base = { ok: true, state: buildPanelState(cfg, model) }

          // 真装配：可选，失败就只回旧字段
          if (typeof assemblePreview !== 'function') {
            sendJson(res, 200, { ...base, assembly: null, assemblyError: 'assemble 不可用' })
            return
          }
          try {
            const summary = await assemblePreview(model)
            sendJson(res, 200, { ...base, assembly: summary, assemblyError: '' })
          } catch (e) {
            // 真装配失败不该让预览整个 500 —— 旧字段仍然可用
            sendJson(res, 200, {
              ...base,
              assembly: null,
              assemblyError: (e && e.message) || 'assemble failed',
            })
          }
        }),
      }),
    )
  } catch (e) {
    warn(`${LOG} 注册 /preview 失败：${(e && e.message) || e}`)
  }

  warn(`${LOG} 面板路由已注册 ${disposers.length} 条（${PREFIX}/*）`)

  return () => {
    for (const d of disposers) {
      try {
        d()
      } catch {
        /* 已随 fiber 释放 */
      }
    }
  }
}
