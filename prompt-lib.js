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
  return { ok: true, value: { id, name, source, url, text, at } }
}

/** 校验整个库；内置条目始终在场且不可删（由调用方过滤 id 以 builtin- 开头） */
export function normalizeLibrary(raw) {
  if (raw === undefined || raw === null) return { ...BUILTIN_PROMPTS.map((p) => ({ ...p })) }
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
    list[idx] = {
      ...entry,
      // 保留内置标记，不允许把内置条目改成非内置（防误删后来源漂移）
      source: String(old.source).startsWith('builtin-') || old.source === 'builtin' ? old.source : entry.source,
      at: entry.at || old.at,
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
  return library.filter((e) => !e || e.id !== id)
}

export function findPrompt(library, id) {
  if (typeof id !== 'string' || !id) return null
  return (library || []).find((e) => e && e.id === id) || null
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
    if (inLlm && /^\s*-\s*id:\s*\S/.test(line) && !/llm-pi-ai/.test(line)) {
      // 下一个顶层 loader 行 → 离开
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
    if (/^\s{8}\S/.test(line) && !/^\s{10}-/.test(line) && inModels) {
      // 缩进回到 providers 同级 → 离开 models
      if (!/^\s*-\s*id:/.test(line)) {
        flush()
        inModels = false
      }
    }
    if (!inModels) continue

    const idm = line.match(/^\s*-\s*id:\s*(\S+)\s*$/)
    if (idm) {
      flush()
      current = { id: idm[1], name: '' }
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
