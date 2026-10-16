/**
 * dsh-model-persona —— 纯逻辑层（零依赖、无框架）
 *
 * 只放**可独立测试的纯函数**与配置读取，不含任何 Cordis/宿主 API。
 *
 * 两种模式：
 *   · append  —— 往系统提示词里**追加**一段人格（v1 行为，安全）
 *   · replace —— 把整个系统提示词**换掉**（工具 schema 保留；运行上下文默认保留）
 *
 * 依据（详见 docs/01-调研报告.md）：
 *   · 段文本是「每步求值」的函数，context.agent.options.model 是宿主真实模型 id；
 *   · replace 走 `system-prompt/assemble` waterfall，它拿到完整 assembly 且返回值权威；
 *   · 显示名 ≠ 真实 id（官方实测坑），故用 last-model.json 记录真实值供排查。
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const LOG = '[model-persona]'

/** 兜底配置：连 config.json 都没有时用它（= 不注入，零行为改变） */
export const DEFAULT_CONFIG = {
  enabled: true,
  mode: 'append',
  default: '',
  byModel: {},
  order: 1,
  sectionName: 'model-persona:main',
  replaceContexts: false,
  debug: false,
}

/** DSH_HOME：环境变量优先，其次 ~/.dsh（与宿主约定一致） */
function dshHome() {
  const h = process.env.DSH_HOME
  if (h && h.trim()) return h.trim()
  const home = process.env.USERPROFILE || process.env.HOME || ''
  return home ? path.join(home, '.dsh') : ''
}

/**
 * 配置真源路径（按优先级）：
 *   1. 环境变量 DSH_MODEL_PERSONA_CONFIG（显式指定，便于测试/多套配置）
 *   2. $DSH_HOME/model-persona/config.json（正常使用路径）
 *   3. 插件自带目录的 config.json（出厂模板 / 兜底）
 */
export function configPaths(pluginDir) {
  const out = []
  const env = process.env.DSH_MODEL_PERSONA_CONFIG
  if (env && env.trim()) out.push(env.trim())
  const home = dshHome()
  if (home) out.push(path.join(home, 'model-persona', 'config.json'))
  if (pluginDir) out.push(path.join(pluginDir, 'config.json'))
  return out
}

/** 运行期状态目录（与生效的 config 同目录；都取不到就用插件目录） */
export function stateDir(pluginDir) {
  const home = dshHome()
  if (home) return path.join(home, 'model-persona')
  return pluginDir || ''
}

/**
 * 核心匹配：精确键（忽略大小写）→ 最长子串 → 回退 fallback。
 * 返回**原始值**（可能是字符串或对象），由调用方归一化。
 *
 * 为什么「最长子串」：模型 id 常同时包含 `flash` 与 `deepseek-flash` 这类嵌套键，
 * 取最长的才符合直觉（写更具体的键优先）。
 */
export function pickRawValue(byModel, model, fallback = '') {
  if (!byModel || typeof byModel !== 'object') return fallback
  const keys = Object.keys(byModel).filter((k) => {
    const v = byModel[k]
    return k && (typeof v === 'string' || (v && typeof v === 'object'))
  })
  if (keys.length === 0) return fallback
  const id = typeof model === 'string' ? model : ''
  if (!id.trim()) return fallback

  // ① 精确（忽略大小写）
  const lower = id.toLowerCase()
  for (const k of keys) {
    if (k.trim().toLowerCase() === lower) return byModel[k]
  }

  // ② 最长子串（同样忽略大小写）；同长度取先定义的，保证确定性
  let bestKey = ''
  for (const k of keys) {
    const kk = k.trim().toLowerCase()
    if (!kk) continue
    if (lower.includes(kk) && kk.length > bestKey.length) bestKey = kk
  }
  if (bestKey) {
    const hit = keys.find((k) => k.trim().toLowerCase() === bestKey)
    if (hit) return byModel[hit]
  }

  // ③ 回退
  return fallback
}

/** 兼容 v1：只取字符串文本（测试与旧调用方用） */
export function pickByModel(byModel, model, fallback = '') {
  const fb = typeof fallback === 'string' ? fallback : ''
  const raw = pickRawValue(byModel, model, fb)
  if (typeof raw === 'string') return raw.trim() ? raw : fb
  if (raw && typeof raw === 'object' && typeof raw.text === 'string') {
    return raw.text.trim() ? raw.text : fb
  }
  return fb
}

/**
 * 归一化一条模型配置。支持两种写法：
 *   "文本"                          → { mode: 默认模式, text, keepSections: [] }
 *   { mode, text, keepSections }    → 显式指定
 */
export function normalizeEntry(raw, defaultMode = 'append') {
  const mode = defaultMode === 'replace' ? 'replace' : 'append'
  if (typeof raw === 'string') return { mode, text: raw, keepSections: [] }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return {
      mode: raw.mode === 'replace' ? 'replace' : raw.mode === 'append' ? 'append' : mode,
      text: typeof raw.text === 'string' ? raw.text : '',
      keepSections: Array.isArray(raw.keepSections)
        ? raw.keepSections.filter((s) => typeof s === 'string' && s)
        : [],
    }
  }
  return { mode, text: '', keepSections: [] }
}

/** 解析某模型最终生效的条目（byModel 命中 → default → 空） */
export function resolveEntry(cfg, model) {
  const defaultMode = cfg && cfg.mode === 'replace' ? 'replace' : 'append'
  if (!cfg || cfg.enabled === false) return { mode: defaultMode, text: '', keepSections: [] }
  const raw = pickRawValue(cfg.byModel, model, cfg.default)
  return normalizeEntry(raw, defaultMode)
}

/** 归一化配置：补默认值、把坏类型按默认值处理（永不抛） */
export function normalizeConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cfg
  if (typeof raw.enabled === 'boolean') cfg.enabled = raw.enabled
  if (raw.mode === 'append' || raw.mode === 'replace') cfg.mode = raw.mode
  if (typeof raw.default === 'string' || (raw.default && typeof raw.default === 'object')) {
    cfg.default = raw.default
  }
  if (typeof raw.order === 'number' && Number.isFinite(raw.order)) cfg.order = raw.order
  if (typeof raw.sectionName === 'string' && raw.sectionName.trim()) {
    cfg.sectionName = raw.sectionName.trim()
  }
  if (raw.byModel && typeof raw.byModel === 'object' && !Array.isArray(raw.byModel)) {
    cfg.byModel = raw.byModel
  }
  if (typeof raw.replaceContexts === 'boolean') cfg.replaceContexts = raw.replaceContexts
  if (typeof raw.debug === 'boolean') cfg.debug = raw.debug
  return cfg
}

/**
 * append 模式下要注入的文本；replace 模式返回 ''（由 waterfall 整体替换，不走段）。
 * enabled=false 或没内容 → 空串（= 不注入）。
 */
export function renderPersona(cfg, model) {
  if (!cfg || cfg.enabled === false) return ''
  const entry = resolveEntry(cfg, model)
  if (entry.mode !== 'append') return ''
  return entry.text || ''
}

/**
 * keepSections 匹配：`tool:*` 前缀匹配，其它精确匹配。
 * 用于 replace 模式——替换时想保留哪些原有段。
 */
export function matchSections(name, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false
  const n = typeof name === 'string' ? name : ''
  for (const p of patterns) {
    if (typeof p !== 'string' || !p) continue
    if (p.endsWith('*')) {
      if (n.startsWith(p.slice(0, -1))) return true
    } else if (n === p) {
      return true
    }
  }
  return false
}

/**
 * 带 mtime 缓存的配置读取器。
 * 段文本每步都要求值，不能每步读盘；只在 mtime 变化时重读 → 改完下一步生效。
 * 坏 JSON 降级到「上一次成功读到的配置」，再降级到默认值。**永不抛**。
 */
export function createConfigReader(paths, { warn = () => {} } = {}) {
  let cached = null
  let cachedMtime = -1
  let cachedPath = ''
  let warned = ''

  function readOnce() {
    for (const p of paths) {
      try {
        const st = statSync(p)
        if (!st.isFile()) continue
        if (cached && p === cachedPath && st.mtimeMs === cachedMtime) return cached
        const cfg = normalizeConfig(JSON.parse(readFileSync(p, 'utf8')))
        cached = cfg
        cachedMtime = st.mtimeMs
        cachedPath = p
        warned = ''
        return cfg
      } catch (e) {
        if (e && e.code === 'ENOENT') continue
        const msg = `${p} 读取失败：${(e && e.message) || e}`
        if (warned !== msg) {
          warned = msg
          warn(`${LOG} 配置${msg}（已降级）`)
        }
      }
    }
    return cached || { ...DEFAULT_CONFIG }
  }

  readOnce.paths = paths
  return readOnce
}

/**
 * ★ replace 模式的核心变换（纯函数，可测）。
 *
 * 把一次 assembly 的 sections **整体替换**为「保留的段 + 我们的人格段」。
 * 关键约束（replace 语义）：除工具外全部替换。
 *   · `tools` 永远原样保留 —— 模型仍知道有哪些工具可用；
 *   · `tool:*` 段（文字版工具使用指导）也一并保留 —— 它属于「工具」范畴；
 *   · 其余段（harness 身份、plan policy、文件引用…）一律丢弃；
 *   · `contexts`（cwd/沙箱/审批等运行上下文）默认保留，见 README 说明。
 *
 * 纯函数：不改入参，返回新对象。assembly 形状不对时返回 null（调用方保持原样）。
 *
 * @param {object} assembly next() 的结果 { sections, contexts, tools, variables }
 * @param {object} entry    resolveEntry() 的结果 { text, keepSections }
 * @param {object} opts     { sectionName, replaceContexts }
 * @returns {object|null}   新的 assembly；无法处理时 null
 */
export function applyReplace(assembly, entry, opts = {}) {
  if (!assembly || typeof assembly !== 'object') return null
  if (!Array.isArray(assembly.sections)) return null
  if (!entry || typeof entry.text !== 'string' || !entry.text) return null

  const keepPatterns = Array.isArray(entry.keepSections) ? entry.keepSections : []

  // 保留：用户显式声明要留的段 + 所有 tool:* 段（工具使用指导属于「工具」范畴）
  const kept = assembly.sections.filter(
    (s) => s && (matchSections(s.name, keepPatterns) || matchSections(s.name, ['tool:*'])),
  )

  const injected = {
    name: typeof opts.sectionName === 'string' && opts.sectionName ? opts.sectionName : 'model-persona:main',
    text: entry.text,
    // 用户正文里的 {{}} 一律原样保留，避免未注册变量让组装失败
    interpolate: false,
  }

  return {
    ...assembly,
    sections: [...kept, injected],
    // replaceContexts=true 时才清运行上下文；默认原样保留
    contexts: opts.replaceContexts === true ? [] : assembly.contexts,
  }
}

/** 记录宿主真实模型 id，供排查「写了关键词却没命中」。纯辅助，失败无所谓 */export function createModelRecorder(dir) {
  let last = ''
  let seeded = false
  const file = dir ? path.join(dir, 'last-model.json') : ''

  return function record(model) {
    try {
      if (!file) return
      const id = typeof model === 'string' ? model.trim() : ''
      if (!id) return
      if (!seeded) {
        seeded = true
        try {
          last = String(JSON.parse(readFileSync(file, 'utf8')).model || '')
        } catch {
          last = ''
        }
      }
      if (id === last) return
      last = id
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify({ model: id, at: new Date().toISOString() }, null, 2) + '\n', 'utf8')
    } catch {
      /* 记不下来不影响人设注入 */
    }
  }
}

/**
 * 排查用：把本次 assembly 的段名/上下文名/工具数落盘（debug 打开时）。
 * 用途：replace 模式下想知道「到底有哪些段、keepSections 该写什么」。
 * 内容变化才写盘，避免每步都写。
 */
export function createAssemblyDumper(dir) {
  const file = dir ? path.join(dir, 'last-assembly.json') : ''
  let last = ''
  return function dump(assembly, model) {
    try {
      if (!file || !assembly) return
      const payload = {
        model: typeof model === 'string' ? model : '',
        at: new Date().toISOString(),
        sections: (assembly.sections || []).map((s) => ({
          name: s.name,
          chars: typeof s.text === 'string' ? s.text.length : 0,
        })),
        contexts: (assembly.contexts || []).map((c) => ({
          name: c.name,
          chars: typeof c.text === 'string' ? c.text.length : 0,
        })),
        toolCount: Array.isArray(assembly.tools) ? assembly.tools.length : 0,
      }
      const txt = JSON.stringify(payload, null, 2) + '\n'
      if (txt === last) return
      last = txt
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, txt, 'utf8')
    } catch {
      /* 纯排查用，失败无所谓 */
    }
  }
}

// ─────────────────── 面板支持（v3）───────────────────

/**
 * 面板提交的配置做**严格校验**后再落盘。
 * 面板是「用户输入」通道，不能盲信：宁可拒绝，也不要写坏 config.json
 * 让插件静默失效（配置坏了插件会降级成「没有人设」，用户只会看到人设消失）。
 *
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function validateConfigInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '配置必须是一个 JSON 对象' }
  }
  const out = { ...DEFAULT_CONFIG }

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') return { ok: false, error: 'enabled 必须是布尔值' }
    out.enabled = raw.enabled
  }
  if (raw.mode !== undefined) {
    if (raw.mode !== 'append' && raw.mode !== 'replace') {
      return { ok: false, error: 'mode 只能是 "append" 或 "replace"' }
    }
    out.mode = raw.mode
  }
  if (raw.replaceContexts !== undefined) {
    if (typeof raw.replaceContexts !== 'boolean') {
      return { ok: false, error: 'replaceContexts 必须是布尔值' }
    }
    out.replaceContexts = raw.replaceContexts
  }
  if (raw.debug !== undefined) {
    if (typeof raw.debug !== 'boolean') return { ok: false, error: 'debug 必须是布尔值' }
    out.debug = raw.debug
  }
  if (raw.order !== undefined) {
    if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) {
      return { ok: false, error: 'order 必须是有限数字' }
    }
    out.order = raw.order
  }
  if (raw.sectionName !== undefined) {
    if (typeof raw.sectionName !== 'string' || !raw.sectionName.trim()) {
      return { ok: false, error: 'sectionName 必须是非空字符串' }
    }
    out.sectionName = raw.sectionName.trim()
  }
  if (raw.default !== undefined) {
    if (typeof raw.default !== 'string' && (typeof raw.default !== 'object' || raw.default === null || Array.isArray(raw.default))) {
      return { ok: false, error: 'default 必须是字符串或对象' }
    }
    out.default = raw.default
  }
  if (raw.byModel !== undefined) {
    if (!raw.byModel || typeof raw.byModel !== 'object' || Array.isArray(raw.byModel)) {
      return { ok: false, error: 'byModel 必须是一个对象' }
    }
    for (const [k, v] of Object.entries(raw.byModel)) {
      if (!k.trim()) return { ok: false, error: 'byModel 里有空键' }
      if (typeof v === 'string') continue
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return { ok: false, error: `byModel["${k}"] 必须是字符串或对象` }
      }
      if (v.mode !== undefined && v.mode !== 'append' && v.mode !== 'replace') {
        return { ok: false, error: `byModel["${k}"].mode 只能是 "append" 或 "replace"` }
      }
      if (v.text !== undefined && typeof v.text !== 'string') {
        return { ok: false, error: `byModel["${k}"].text 必须是字符串` }
      }
      if (v.keepSections !== undefined) {
        if (!Array.isArray(v.keepSections) || v.keepSections.some((s) => typeof s !== 'string')) {
          return { ok: false, error: `byModel["${k}"].keepSections 必须是字符串数组` }
        }
      }
    }
    out.byModel = raw.byModel
  }

  return { ok: true, value: out }
}

/**
 * 面板用的状态快照（纯函数，便于测试）。
 * 一次性告诉界面：配置现状 + 当前真实模型 + 命中了哪条 + 会注入什么文本。
 */
export function buildPanelState(cfg, model) {
  const c = cfg || DEFAULT_CONFIG
  const entry = resolveEntry(c, model)
  const matched = (() => {
    // 复现 pickRawValue 的命中来源，供界面显示「命中的是哪条键」
    if (!c.byModel || typeof c.byModel !== 'object') return null
    const keys = Object.keys(c.byModel)
    const id = typeof model === 'string' ? model.trim().toLowerCase() : ''
    if (!id) return null
    for (const k of keys) if (k.trim().toLowerCase() === id) return k
    let best = ''
    for (const k of keys) {
      const kk = k.trim().toLowerCase()
      if (kk && id.includes(kk) && kk.length > best.length) best = kk
    }
    if (best) return keys.find((k) => k.trim().toLowerCase() === best) || null
    return null
  })()

  const mode = c.enabled === false ? 'off' : entry.mode
  const injected = entry.mode === 'replace'
    ? entry.text
    : (c.enabled === false ? '' : entry.text)

  return {
    enabled: c.enabled !== false,
    mode: c.mode,
    replaceContexts: c.replaceContexts === true,
    debug: c.debug === true,
    sectionName: c.sectionName,
    order: c.order,
    byModel: c.byModel || {},
    default: c.default,
    model: typeof model === 'string' ? model : '',
    matchedKey: matched,
    effectiveMode: mode,
    injectedText: injected || '',
  }
}

/**
 * 把一次真实装配（PromptAssembly）摘要成面板可读的结构。
 *
 * 为什么要它：v3 的预览只是「把配置重算一遍」，用户看不到**真实的系统提示词
 * 长什么样**——不知道有哪些段、顺序如何、自己的人格段插在哪、被 replace 掉了什么。
 * 现在调 `ctx.systemPrompt.assemble()` 拿真结果，逐段列出来。
 *
 * 纯函数：不碰 ctx、不碰文件，可在 Node 里单测，也可在浏览器里跑。
 *
 * @param {object} assembly  assemble() 的返回值 { sections, contexts, tools, variables }
 * @param {object} opts      { ownSection: 本插件段名, replaced: 是否走了 replace, model }
 * @returns {{sections: Array, totalChars: number, ownChars: number, toolCount: number}}
 */
export function summarizeAssembly(assembly, opts = {}) {
  const own = typeof opts.ownSection === 'string' ? opts.ownSection : ''
  const sections = []
  let totalChars = 0
  let ownChars = 0

  const list = assembly && Array.isArray(assembly.sections) ? assembly.sections : []
  for (const s of list) {
    if (!s || typeof s !== 'object') continue
    // 既没有段名也没有可求值文本的项是噪音（例如 `{}`），跳过，
    // 否则面板会多出一行「(未命名) 0 字符」的垃圾。
    const hasName = typeof s.name === 'string' && s.name
    const hasText = typeof s.text === 'string' || typeof s.text === 'function'
    if (!hasName && !hasText) continue
    // 段的 text 可能是字符串，也可能是「每步求值」的函数（本插件自己就是函数）
    let text = ''
    let lazy = false
    if (typeof s.text === 'string') text = s.text
    else if (typeof s.text === 'function') {
      lazy = true
      try {
        const v = s.text({ agent: { options: { model: opts.model || '' } } })
        text = typeof v === 'string' ? v : ''
      } catch {
        text = ''
      }
    }
    const chars = text.length
    totalChars += chars
    const isOwn = !!own && s.name === own
    if (isOwn) ownChars += chars
    sections.push({
      name: typeof s.name === 'string' ? s.name : '(未命名)',
      order: Number.isFinite(s.order) ? s.order : null,
      chars,
      own: isOwn,
      lazy,
      // 只给前 200 字，避免面板被整篇提示词撑爆
      head: text.slice(0, 200),
    })
  }

  const tools = assembly && Array.isArray(assembly.tools) ? assembly.tools : []
  const contexts = assembly && Array.isArray(assembly.contexts) ? assembly.contexts : []
  const variables = assembly && Array.isArray(assembly.variables) ? assembly.variables : []

  return {
    sections,
    sectionCount: sections.length,
    totalChars,
    ownChars,
    ownInjected: ownChars > 0,
    toolCount: tools.length,
    toolNames: tools
      .map((t) => (t && typeof t.name === 'string' ? t.name : ''))
      .filter(Boolean)
      .slice(0, 40),
    contextCount: contexts.length,
    variableCount: variables.length,
    replaced: opts.replaced === true,
  }
}

/**
 * 原子写配置：先写同目录临时文件，再 rename 覆盖。
 * 直接覆写有「写到一半崩 → config.json 半截 → 插件降级」的风险，rename 在
 * 同一文件系统内是原子的，最坏情况是保留旧文件。
 *
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function writeConfigAtomic(file, cfg, { fs = {} } = {}) {
  const wf = fs.writeFileSync || writeFileSync
  const rn = fs.renameSync || renameSync
  const mk = fs.mkdirSync || mkdirSync
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    mk(path.dirname(file), { recursive: true })
    wf(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
    rn(tmp, file)
    return { ok: true }
  } catch (e) {
    try {
      const rm = fs.unlinkSync || unlinkSync
      rm(tmp)
    } catch {
      /* 清理失败无所谓 */
    }
    return { ok: false, error: (e && e.message) || String(e) }
  }
}
