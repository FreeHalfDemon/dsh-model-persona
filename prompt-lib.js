/**
 * prompt-lib.js —— 提示词库 + 模型目录（v4 纯逻辑，零依赖）
 *
 * 两层设计：
 *   第一层  提示词库  一组可复用的提示词，带名字/来源/内容
 *   第二层  模型映射  哪个模型用哪条（**引用库** or **内联一段**，两种都支持）
 *
 * 这样「给模型换提示词」＝ 改映射指向，不用重写内容；
 * 「这个模型就特殊写一段」＝ 直接内联，不用先建库条目。
 */

/** 内置预设提示词（出厂自带，用户可直接选用或复制改造） */
export const BUILTIN_PROMPTS = [
  {
    id: 'builtin-concise',
    name: '简洁工程助手（内置）',
    source: 'builtin',
    text: [
      '你是简洁高效的工程助手。',
      '',
      '- 先给结论，再给依据，不铺垫、不客套。',
      '- 不确定就说不确定，不要编造路径、版本号、API 签名。',
      '- 改动前先说明改哪几个文件、为什么，改完给出验证证据。',
    ].join('\n'),
  },
  {
    id: 'builtin-rigorous',
    name: '严谨资深工程师（内置）',
    source: 'builtin',
    text: [
      '你是严谨的资深工程师。',
      '',
      '- 先质疑需求是否成立，再给方案。',
      '- 每个技术判断给出依据；查不到就明说「没查到，风险是 X」，不要猜。',
      '- 涉及不可逆操作（删除、覆盖、推远端）前必须先确认。',
    ].join('\n'),
  },
  {
    id: 'builtin-chinese-tutor',
    name: '耐心中文技术顾问（内置）',
    source: 'builtin',
    text: [
      '你是耐心的中文技术顾问。',
      '',
      '- 一律用简体中文回答。',
      '- 术语给出中英对照，例子优先于抽象描述。',
      '- 由浅入深，确认对方跟上再继续。',
    ].join('\n'),
  },
]

/** 库条目来源 */
export const SOURCES = ['builtin', 'manual', 'web', 'file']

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** 生成不冲突的 id */
export function nextPromptId(library, base = 'prompt') {
  const used = new Set((library || []).map((e) => e && e.id))
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/** 校验并归一化单条库条目 */
export function normalizePrompt(raw) {
  if (!isPlainObject(raw)) return { ok: false, error: '条目必须是对象' }
  const text = typeof raw.text === 'string' ? raw.text : ''
  if (!text.trim()) return { ok: false, error: '条目内容（text）不能为空' }
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : ''
  const source = SOURCES.includes(raw.source) ? raw.source : 'manual'
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  const at = typeof raw.at === 'string' ? raw.at : new Date().toISOString()
  return {
    ok: true,
    value: { id, name, source, url, text, at },
    // 供 upsertPrompt 区分「调用方显式指定了 source」与「没提」——
    // 没提时必须沿用旧值，否则用户只改文本会把来源标记悄悄降级成 manual
    provided: {
      source: SOURCES.includes(raw.source),
      at: typeof raw.at === 'string' && raw.at.trim() !== '',
    },
  }
}

/** 校验整个库；内置条目始终在场且不可删（由调用方过滤 id 以 builtin- 开头） */
export function normalizeLibrary(raw) {
  if (raw === undefined || raw === null) return BUILTIN_PROMPTS.map((p) => ({ ...p }))
  if (!Array.isArray(raw)) throw new Error('提示词库必须是一个数组')
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!isPlainObject(item)) continue
    const text = typeof item.text === 'string' ? item.text : ''
    if (!text.trim()) continue
    let id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!id) id = nextPromptId(out, 'prompt')
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id,
      source: SOURCES.includes(item.source) ? item.source : 'manual',
      url: typeof item.url === 'string' ? item.url.trim() : '',
      text,
      at: typeof item.at === 'string' ? item.at : new Date().toISOString(),
    })
  }
  // 内置条目兜底补全（用户误删也能恢复）
  for (const b of BUILTIN_PROMPTS) {
    if (!out.some((e) => e.id === b.id)) out.push({ ...b })
  }
  return out
}

/** 增 / 改（同 id 覆盖）；返回新库，不改入参 */
export function upsertPrompt(library, raw) {
  const checked = normalizePrompt(raw)
  if (!checked.ok) throw new Error(checked.error)
  const list = Array.isArray(library) ? library.slice() : []
  const entry = checked.value
  if (!entry.id) entry.id = nextPromptId(list, 'prompt')
  const idx = list.findIndex((e) => e && e.id === entry.id)
  if (idx >= 0) {
    const old = list[idx]
    const oldIsBuiltin = old.source === 'builtin' || String(old.id).startsWith('builtin-')
    list[idx] = {
      ...entry,
      // 内置条目的 source 永远锁死（防误删后来源漂移）；
      // 非内置条目：调用方没显式给 source 就沿用旧值，别悄悄降级成 manual
      source: oldIsBuiltin
        ? old.source
        : checked.provided && checked.provided.source
          ? entry.source
          : old.source,
      // 同理：没显式给 at 就保留旧的，避免每次保存都把时间戳刷成当前时刻
      at: checked.provided && checked.provided.at ? entry.at : (old.at || entry.at),
    }
  } else {
    list.push(entry)
  }
  return list
}

/** 删（内置条目不可删） */
export function removePrompt(library, id) {
  if (typeof id !== 'string' || !id) return library
  const target = (library || []).find((e) => e && e.id === id)
  if (!target) return library
  if (target.source === 'builtin' || String(target.id).startsWith('builtin-')) return library
  // 注意：必须写成 `e && e.id !== id`。若写成 `!e || e.id !== id`，
  // null 条目会因 `!e` 为真而被保留，等于「删不掉任何东西」。
  return library.filter((e) => e && e.id !== id)
}

export function findPrompt(library, id) {
  if (typeof id !== 'string' || !id) return null
  return (library || []).find((e) => e && e.id === id) || null
}

/**
 * 把任意来源的「模型目录」归一成统一的 [{ id, name }]。
 *
 * 这是 v4 模型下拉框的数据层，**双轨设计**：
 *   · 首选来源  `ctx.sessionController.modelCatalog()`（Host 运行时生成，最新、最全）
 *   · 兜底来源  用户手贴的一份目录 JSON（某些 DSH 版本可能没有该服务）
 *
 * 为什么不在这一层读文件/调服务：保持它是**纯函数**，可单测、可在浏览器里跑
 * （面板拿到的数据可能是服务返回的，也可能是用户粘贴的，一律走这里）。
 *
 * 认两种输入形态：
 *   ① ModelCatalog：{ providers: [{ id, name, models: [{id, name}] }] }
 *   ② 扁平数组：   [{ id, name }]
 * 其它形态（null / 字符串 / 空数组）一律返回 []，绝不抛。
 *
 * @returns {Array<{id: string, name: string}>} 已按 id 去重、无 id 的条目被丢弃
 */
export function normalizeModelCatalog(raw) {
  const out = []
  const seen = new Set()
  const push = (m) => {
    if (!isPlainObject(m)) return
    const id = typeof m.id === 'string' ? m.id.trim() : ''
    if (!id || seen.has(id)) return
    seen.add(id)
    const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : id
    out.push({ id, name })
  }

  if (Array.isArray(raw)) {
    for (const m of raw) push(m)
    return out
  }
  if (isPlainObject(raw) && Array.isArray(raw.providers)) {
    for (const g of raw.providers) {
      if (!isPlainObject(g) || !Array.isArray(g.models)) continue
      for (const m of g.models) push(m)
    }
    // 目录自带的 default 也可能不在任何 provider 组里，补上以免漏选
    if (isPlainObject(raw.default) && raw.default.id) push(raw.default)
    return out
  }
  return out
}

/**
 * 从 profile 的 cordis.patch.yml 里**定向提取**模型目录（id + 人话 name）。
 *
 * 为什么自己扫而不是用 YAML 解析器：保持**零依赖**。只认 `llm-pi-ai` 段下
 * `providers:` 里 `- id:` + `name:` 成对出现这一种形态，够了。
 *
 * 这正是 v3 最大的 UX 硬伤的解药：界面显示 `name`、内部存 `id`，
 * 用户不必手打一长串模型 id。
 */
export function parseModelCatalog(yamlText) {
  const out = []
  if (typeof yamlText !== 'string' || !yamlText) return out
  const lines = yamlText.split(/\r?\n/)
  let inLlm = false
  let inModels = false
  let current = null

  const flush = () => {
    if (current && current.id) out.push(current)
    current = null
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')
    if (!line.trim() || line.trim().startsWith('#')) continue

    // 进入/离开 llm-pi-ai 这个 loader 行
    if (/^\s*-\s*id:\s*llm-pi-ai\s*$/.test(line)) {
      inLlm = true
      inModels = false
      flush()
      continue
    }
    // 离开 llm-pi-ai：必须是**下一个顶层 loader 行**。
    // ⚠️ 不能只靠 `- id:` 判断 —— providers 下的 `- id: p`（provider 自己的 id）
    //    与 loader 行的 `- id:` 格式完全一样，只能靠缩进区分：
    //    loader 行缩进 4，provider 行缩进 10。少了缩进约束会把 provider 行
    //    误判成「下一个 loader 行」而提前退出，导致整个目录解析为空。
    if (inLlm && /^\s{0,6}-\s*id:\s*\S/.test(line) && !/llm-pi-ai/.test(line)) {
      flush()
      inLlm = false
      inModels = false
      continue
    }
    if (!inLlm) continue

    if (/^\s*models:\s*$/.test(line)) {
      flush()
      inModels = true
      continue
    }
    if (/^\s{8}\S/.test(line) && inModels) {
      // 缩进比 models: 浅（回到 providers 同级）→ 离开 models 块
      if (!/^\s*models:/.test(line)) {
        flush()
        inModels = false
      }
    }
    if (!inModels) continue

    // models: 块内的模型项缩进固定（比 models: 深两级）；
    // 缩进更浅的 `- id:` 是下一个 provider，不是模型。
    const idm = line.match(/^(\s*)-\s*id:\s*(\S+)\s*$/)
    if (idm && idm[1].length >= 12) {
      flush()
      current = { id: idm[2], name: '' }
      continue
    }
    if (current && /^\s{10,}name:\s*/.test(line)) {
      const nm = line.match(/^\s*name:\s*(.+)$/)
      if (nm) current.name = nm[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  flush()
  return out
}
