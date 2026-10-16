/**
 * 纯逻辑回归测试（零依赖，Node 内置 test runner）
 *   node test.mjs          ← 本机沙箱用这条（node --test 会 spawn 子进程被拦）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pickByModel,
  pickRawValue,
  normalizeEntry,
  resolveEntry,
  matchSections,
  normalizeConfig,
  renderPersona,
  applyReplace,
  validateConfigInput,
  buildPanelState,
  writeConfigAtomic,
  summarizeAssembly,
  DEFAULT_CONFIG,
} from './core.js'

test('精确命中：大小写不同也算命中（忽略大小写）', () => {
  const m = { 'DeepSeek-Flash': 'A' }
  assert.equal(pickByModel(m, 'deepseek-flash', 'FB'), 'A')
})

test('精确命中：同大小写', () => {
  const m = { 'deepseek-flash': 'A' }
  assert.equal(pickByModel(m, 'deepseek-flash', 'FB'), 'A')
})

test('无精确、有唯一子串 → 命中该条', () => {
  const m = { claude: 'C' }
  assert.equal(pickByModel(m, 'claude-opus-4.6', 'FB'), 'C')
})

test('★ 多子串取最长（关键用例）', () => {
  const m = { flash: '短', 'deepseek-flash': '长' }
  assert.equal(pickByModel(m, 'deepseek-flash-high', 'FB'), '长')
})

test('★ 多子串取最长：与定义顺序无关', () => {
  const m = { 'deepseek-flash': '长', flash: '短' }
  assert.equal(pickByModel(m, 'deepseek-flash-high', 'FB'), '长')
})

test('精确命中优先于更长子串', () => {
  // 精确键 `deepseek` 命中，即使 `deepseek-flash-x` 是更长子串
  const m = { deepseek: '精确', 'deepseek-flash-x': '子串' }
  assert.equal(pickByModel(m, 'deepseek', 'FB'), '精确')
})

test('无任何命中 → 回退 default', () => {
  const m = { gpt: 'G' }
  assert.equal(pickByModel(m, 'deepseek-flash', 'FB'), 'FB')
})

test('空 byModel → 回退 default', () => {
  assert.equal(pickByModel({}, 'whatever', 'FB'), 'FB')
})

test('byModel 非对象 → 回退 default', () => {
  assert.equal(pickByModel(null, 'x', 'FB'), 'FB')
  assert.equal(pickByModel(undefined, 'x', 'FB'), 'FB')
  assert.equal(pickByModel('nope', 'x', 'FB'), 'FB')
})

test('模型 id 为空 / null → 回退 default，不抛', () => {
  const m = { flash: 'F' }
  assert.equal(pickByModel(m, '', 'FB'), 'FB')
  assert.equal(pickByModel(m, null, 'FB'), 'FB')
  assert.equal(pickByModel(m, undefined, 'FB'), 'FB')
})

test('命中键但值为空串 → 回退 default', () => {
  const m = { flash: '   ' }
  assert.equal(pickByModel(m, 'flash', 'FB'), 'FB')
})

test('非字符串的值被忽略', () => {
  const m = { flash: 123, other: 'OK' }
  assert.equal(pickByModel(m, 'other-x', 'FB'), 'OK')
})

test('default 也空 → 返回空串（= 不注入）', () => {
  assert.equal(pickByModel({}, 'x', ''), '')
  assert.equal(pickByModel({}, 'x'), '')
})

test('空键被忽略，不会命中一切', () => {
  const m = { '': '危险', flash: 'F' }
  assert.equal(pickByModel(m, 'deepseek-flash', 'FB'), 'F')
})

test('normalizeConfig：坏类型一律按默认值处理', () => {
  const c = normalizeConfig({ enabled: 'yes', byModel: [], order: NaN, default: 42 })
  assert.equal(c.enabled, DEFAULT_CONFIG.enabled)
  assert.deepEqual(c.byModel, {})
  assert.equal(c.order, DEFAULT_CONFIG.order)
  assert.equal(c.default, DEFAULT_CONFIG.default)
})

test('normalizeConfig：非对象输入不抛', () => {
  assert.equal(normalizeConfig(null).sectionName, DEFAULT_CONFIG.sectionName)
  assert.equal(normalizeConfig('x').sectionName, DEFAULT_CONFIG.sectionName)
  assert.equal(normalizeConfig([1, 2]).sectionName, DEFAULT_CONFIG.sectionName)
})

test('normalizeConfig：正常值被采纳', () => {
  const c = normalizeConfig({
    enabled: false,
    default: 'D',
    byModel: { a: 'A' },
    order: 7,
    sectionName: 'x:y',
  })
  assert.equal(c.enabled, false)
  assert.equal(c.default, 'D')
  assert.deepEqual(c.byModel, { a: 'A' })
  assert.equal(c.order, 7)
  assert.equal(c.sectionName, 'x:y')
})

test('renderPersona：enabled=false → 空串（= 不注入）', () => {
  const cfg = normalizeConfig({ enabled: false, default: 'D' })
  assert.equal(renderPersona(cfg, 'any'), '')
})

test('renderPersona：正常按模型选', () => {
  const cfg = normalizeConfig({ default: 'D', byModel: { flash: 'F' } })
  assert.equal(renderPersona(cfg, 'deepseek-flash'), 'F')
  assert.equal(renderPersona(cfg, 'gpt-5.4'), 'D')
})

test('renderPersona：cfg 为 null 不抛', () => {
  assert.equal(renderPersona(null, 'x'), '')
})

// ─────────────── v2：replace 模式 ───────────────

test('normalizeEntry：字符串 → 默认模式的条目', () => {
  assert.deepEqual(normalizeEntry('文本', 'append'), { mode: 'append', text: '文本', keepSections: [] })
  assert.deepEqual(normalizeEntry('文本', 'replace'), { mode: 'replace', text: '文本', keepSections: [] })
})

test('normalizeEntry：对象写法，显式 mode 覆盖默认', () => {
  const e = normalizeEntry({ mode: 'replace', text: 'T', keepSections: ['a', 'tool:*'] }, 'append')
  assert.equal(e.mode, 'replace')
  assert.equal(e.text, 'T')
  assert.deepEqual(e.keepSections, ['a', 'tool:*'])
})

test('normalizeEntry：坏输入不抛，回落空文本', () => {
  assert.equal(normalizeEntry(null, 'append').text, '')
  assert.equal(normalizeEntry(123, 'append').text, '')
  assert.deepEqual(normalizeEntry({ keepSections: 'nope' }, 'append').keepSections, [])
  assert.deepEqual(normalizeEntry({ keepSections: ['ok', '', 5] }, 'append').keepSections, ['ok'])
})

test('★ resolveEntry：全局 mode=replace，但单条可覆盖回 append', () => {
  const cfg = normalizeConfig({
    mode: 'replace',
    default: 'D',
    byModel: { special: { mode: 'append', text: 'S' } },
  })
  assert.equal(resolveEntry(cfg, 'special').mode, 'append')
  assert.equal(resolveEntry(cfg, 'special').text, 'S')
  assert.equal(resolveEntry(cfg, 'other').mode, 'replace')
  assert.equal(resolveEntry(cfg, 'other').text, 'D')
})

test('resolveEntry：enabled=false → 空文本（两种模式都不注入）', () => {
  const cfg = normalizeConfig({ enabled: false, mode: 'replace', default: 'D' })
  assert.equal(resolveEntry(cfg, 'x').text, '')
})

test('★ renderPersona：replace 模式不通过段注入（返回空）', () => {
  const cfg = normalizeConfig({ mode: 'replace', default: '整份替换' })
  assert.equal(renderPersona(cfg, 'any'), '')
})

test('★ renderPersona：append 模式正常注入', () => {
  const cfg = normalizeConfig({ mode: 'append', default: '追加段' })
  assert.equal(renderPersona(cfg, 'any'), '追加段')
})

test('★ matchSections：tool:* 前缀匹配', () => {
  assert.equal(matchSections('tool:bash', ['tool:*']), true)
  assert.equal(matchSections('tool:read', ['tool:*']), true)
  assert.equal(matchSections('deployment:persona-prefix', ['tool:*']), false)
})

test('★ matchSections：非通配是精确匹配', () => {
  assert.equal(matchSections('abc', ['abc']), true)
  assert.equal(matchSections('abcd', ['abc']), false)
  assert.equal(matchSections('xabc', ['abc']), false)
})

test('matchSections：空模式表 → 一律 false', () => {
  assert.equal(matchSections('anything', []), false)
  assert.equal(matchSections('anything', null), false)
})

test('matchSections：混合模式', () => {
  const p = ['tool:*', 'plan:policy']
  assert.equal(matchSections('tool:grep', p), true)
  assert.equal(matchSections('plan:policy', p), true)
  assert.equal(matchSections('other', p), false)
})

test('★ pickRawValue：能返回对象值（replace 条目）', () => {
  const byModel = { claude: { mode: 'replace', text: 'C' } }
  const v = pickRawValue(byModel, 'claude-opus-4.6', 'FB')
  assert.equal(v.mode, 'replace')
  assert.equal(v.text, 'C')
})

test('★ pickRawValue：对象与字符串混合，精确优先', () => {
  const byModel = { 'gpt-5.4': '精确', gpt: { text: '子串' } }
  assert.equal(pickRawValue(byModel, 'gpt-5.4', 'FB'), '精确')
  assert.equal(pickRawValue(byModel, 'gpt-6-astra', 'FB').text, '子串')
})

test('pickByModel：对象值取 .text', () => {
  const byModel = { claude: { mode: 'replace', text: 'C' } }
  assert.equal(pickByModel(byModel, 'claude-x', 'FB'), 'C')
})

test('pickByModel：对象但 text 空 → 回退', () => {
  const byModel = { claude: { mode: 'replace', text: '  ' } }
  assert.equal(pickByModel(byModel, 'claude-x', 'FB'), 'FB')
})

test('normalizeConfig：新键 mode/replaceContexts/debug', () => {
  const c = normalizeConfig({ mode: 'replace', replaceContexts: true, debug: true })
  assert.equal(c.mode, 'replace')
  assert.equal(c.replaceContexts, true)
  assert.equal(c.debug, true)
})

test('normalizeConfig：坏 mode 值 → 默认 append', () => {
  assert.equal(normalizeConfig({ mode: 'nope' }).mode, 'append')
})

test('normalizeConfig：default 可以是对象', () => {
  const c = normalizeConfig({ default: { mode: 'replace', text: 'D' } })
  assert.equal(c.default.mode, 'replace')
})

// ─────────────── v2：applyReplace（replace 核心变换）───────────────

const mkAssembly = () => ({
  sections: [
    { name: 'harness:identity', text: '你是 AI agent' },
    { name: 'deployment:persona-prefix', text: '原人格' },
    { name: 'plan:policy', text: '计划策略' },
    { name: 'tool:bash', text: 'bash 怎么用' },
    { name: 'tool:read', text: 'read 怎么用' },
    { name: 'file:references', text: '文件引用' },
  ],
  contexts: [{ name: 'working-directory', text: 'cwd=/x' }],
  tools: [{ name: 'bash' }, { name: 'read' }],
  variables: { provider: 'x' },
})

test('★ applyReplace：非 tool:* 段全部丢弃，只留人格段', () => {
  const out = applyReplace(mkAssembly(), { text: '新人设', keepSections: [] }, {})
  const names = out.sections.map((s) => s.name)
  assert.ok(!names.includes('harness:identity'))
  assert.ok(!names.includes('deployment:persona-prefix'))
  assert.ok(!names.includes('plan:policy'))
  assert.ok(!names.includes('file:references'))
  assert.equal(names[names.length - 1], 'model-persona:main')
})

test('★ applyReplace：tool:* 段被保留（工具指导属于工具范畴）', () => {
  const out = applyReplace(mkAssembly(), { text: '新人设', keepSections: [] }, {})
  const names = out.sections.map((s) => s.name)
  assert.ok(names.includes('tool:bash'))
  assert.ok(names.includes('tool:read'))
})

test('★ applyReplace：tools schema 原样保留（核心需求）', () => {
  const a = mkAssembly()
  const out = applyReplace(a, { text: '新人设', keepSections: [] }, {})
  assert.deepEqual(out.tools, a.tools)
})

test('★ applyReplace：contexts 默认保留', () => {
  const a = mkAssembly()
  const out = applyReplace(a, { text: '新人设', keepSections: [] }, {})
  assert.deepEqual(out.contexts, a.contexts)
})

test('★ applyReplace：replaceContexts=true 时清空 contexts', () => {
  const out = applyReplace(mkAssembly(), { text: 'X', keepSections: [] }, { replaceContexts: true })
  assert.deepEqual(out.contexts, [])
})

test('applyReplace：keepSections 额外保留指定段', () => {
  const out = applyReplace(
    mkAssembly(),
    { text: 'X', keepSections: ['plan:policy', 'harness:*'] },
    {},
  )
  const names = out.sections.map((s) => s.name)
  assert.ok(names.includes('plan:policy'))
  assert.ok(names.includes('harness:identity'))
  assert.ok(!names.includes('file:references'))
})

test('applyReplace：variables 原样保留', () => {
  const a = mkAssembly()
  const out = applyReplace(a, { text: 'X', keepSections: [] }, {})
  assert.deepEqual(out.variables, a.variables)
})

test('★ applyReplace：不改入参（纯函数）', () => {
  const a = mkAssembly()
  const before = JSON.stringify(a)
  applyReplace(a, { text: 'X', keepSections: [] }, {})
  assert.equal(JSON.stringify(a), before)
})

test('applyReplace：自定义 sectionName 生效', () => {
  const out = applyReplace(mkAssembly(), { text: 'X', keepSections: [] }, { sectionName: 'my:name' })
  assert.equal(out.sections[out.sections.length - 1].name, 'my:name')
})

test('applyReplace：注入段 interpolate=false（保护 {{}}）', () => {
  const out = applyReplace(mkAssembly(), { text: 'X', keepSections: [] }, {})
  assert.equal(out.sections[out.sections.length - 1].interpolate, false)
})

test('★ applyReplace：text 为空 → null（不接管）', () => {
  assert.equal(applyReplace(mkAssembly(), { text: '', keepSections: [] }, {}), null)
})

test('★ applyReplace：assembly 形状不对 → null（不接管）', () => {
  assert.equal(applyReplace(null, { text: 'X' }, {}), null)
  assert.equal(applyReplace({}, { text: 'X' }, {}), null)
  assert.equal(applyReplace({ sections: 'nope' }, { text: 'X' }, {}), null)
})

test('applyReplace：entry 为 null → null', () => {
  assert.equal(applyReplace(mkAssembly(), null, {}), null)
})

test('applyReplace：空 sections 也能注入', () => {
  const out = applyReplace({ sections: [], contexts: [], tools: [], variables: {} }, { text: 'X' }, {})
  assert.equal(out.sections.length, 1)
  assert.equal(out.sections[0].text, 'X')
})

// ─────────────── v3：面板支持 ───────────────

test('★ validateConfigInput：拒绝非对象', () => {
  for (const bad of [null, undefined, 'x', 1, [], true]) {
    const r = validateConfigInput(bad)
    assert.equal(r.ok, false, `应拒绝：${JSON.stringify(bad)}`)
  }
})

test('★ validateConfigInput：拒绝非法 mode', () => {
  assert.equal(validateConfigInput({ mode: 'nope' }).ok, false)
  assert.equal(validateConfigInput({ mode: 'append' }).ok, true)
  assert.equal(validateConfigInput({ mode: 'replace' }).ok, true)
})

test('★ validateConfigInput：拒绝非布尔开关', () => {
  assert.equal(validateConfigInput({ enabled: 'true' }).ok, false)
  assert.equal(validateConfigInput({ replaceContexts: 1 }).ok, false)
  assert.equal(validateConfigInput({ debug: 'y' }).ok, false)
})

test('★ validateConfigInput：拒绝坏 order / sectionName', () => {
  assert.equal(validateConfigInput({ order: 'x' }).ok, false)
  assert.equal(validateConfigInput({ order: NaN }).ok, false)
  assert.equal(validateConfigInput({ sectionName: '' }).ok, false)
  assert.equal(validateConfigInput({ sectionName: '  ' }).ok, false)
})

test('★ validateConfigInput：byModel 必须是对象', () => {
  assert.equal(validateConfigInput({ byModel: [] }).ok, false)
  assert.equal(validateConfigInput({ byModel: 'x' }).ok, false)
  assert.equal(validateConfigInput({ byModel: null }).ok, false)
})

test('★ validateConfigInput：拒绝空键', () => {
  assert.equal(validateConfigInput({ byModel: { '': 'x' } }).ok, false)
  assert.equal(validateConfigInput({ byModel: { ' ': 'x' } }).ok, false)
})

test('★ validateConfigInput：条目 mode / text / keepSections 校验', () => {
  assert.equal(validateConfigInput({ byModel: { a: { mode: 'nope' } } }).ok, false)
  assert.equal(validateConfigInput({ byModel: { a: { text: 1 } } }).ok, false)
  assert.equal(validateConfigInput({ byModel: { a: { keepSections: 'x' } } }).ok, false)
  assert.equal(validateConfigInput({ byModel: { a: { keepSections: [1] } } }).ok, false)
  assert.equal(validateConfigInput({ byModel: { a: { keepSections: ['ok'] } } }).ok, true)
})

test('★ validateConfigInput：合法配置通过并补齐默认值', () => {
  const r = validateConfigInput({ mode: 'replace', byModel: { flash: 'F' } })
  assert.equal(r.ok, true)
  assert.equal(r.value.mode, 'replace')
  assert.deepEqual(r.value.byModel, { flash: 'F' })
  assert.equal(r.value.sectionName, DEFAULT_CONFIG.sectionName)
})

test('★ buildPanelState：报告命中键与注入文本（append）', () => {
  const cfg = normalizeConfig({ mode: 'append', byModel: { flash: 'F' } })
  const s = buildPanelState(cfg, 'deepseek-flash')
  assert.equal(s.matchedKey, 'flash')
  assert.equal(s.injectedText, 'F')
  assert.equal(s.effectiveMode, 'append')
  assert.equal(s.model, 'deepseek-flash')
})

test('★ buildPanelState：未命中时回退 default', () => {
  const cfg = normalizeConfig({ default: 'D', byModel: { flash: 'F' } })
  const s = buildPanelState(cfg, 'gpt-5.4')
  assert.equal(s.matchedKey, null)
  assert.equal(s.injectedText, 'D')
})

test('★ buildPanelState：enabled=false → effectiveMode=off 且不注入', () => {
  const cfg = normalizeConfig({ enabled: false, default: 'D' })
  const s = buildPanelState(cfg, 'x')
  assert.equal(s.effectiveMode, 'off')
  assert.equal(s.injectedText, '')
})

test('★ buildPanelState：replace 模式报告注入文本', () => {
  const cfg = normalizeConfig({ mode: 'replace', default: 'R' })
  const s = buildPanelState(cfg, 'x')
  assert.equal(s.effectiveMode, 'replace')
  assert.equal(s.injectedText, 'R')
})

test('buildPanelState：空模型 id 不抛', () => {
  const cfg = normalizeConfig({ default: 'D' })
  const s = buildPanelState(cfg, undefined)
  assert.equal(s.model, '')
  assert.equal(s.matchedKey, null)
  assert.equal(s.injectedText, 'D')
})

test('buildPanelState：cfg 为 null 不抛', () => {
  const s = buildPanelState(null, 'x')
  assert.equal(s.enabled, true)
  assert.equal(s.injectedText, '')
})

test('★ writeConfigAtomic：正常写入并返回 ok', () => {
  const calls = []
  const fs = {
    mkdirSync: () => calls.push('mkdir'),
    writeFileSync: (p, t) => calls.push(['write', p, t]),
    renameSync: (a, b) => calls.push(['rename', a, b]),
    unlinkSync: () => calls.push('unlink'),
  }
  const r = writeConfigAtomic('/tmp/x/config.json', { a: 1 }, { fs })
  assert.equal(r.ok, true)
  // 必须走「写临时文件 → rename」，不能直接覆写目标
  const wrote = calls.find((c) => Array.isArray(c) && c[0] === 'write')
  assert.ok(wrote[1].startsWith('/tmp/x/config.json.tmp-'), '应先写临时文件')
  const renamed = calls.find((c) => Array.isArray(c) && c[0] === 'rename')
  assert.equal(renamed[2], '/tmp/x/config.json')
  assert.ok(!calls.includes('unlink'), '成功路径不该清理')
})

test('★ writeConfigAtomic：写失败时清理临时文件且返回错误', () => {
  const calls = []
  const fs = {
    mkdirSync: () => {},
    writeFileSync: () => {
      throw new Error('disk full')
    },
    renameSync: () => {},
    unlinkSync: (p) => calls.push(['unlink', p]),
  }
  const r = writeConfigAtomic('/tmp/x/config.json', { a: 1 }, { fs })
  assert.equal(r.ok, false)
  assert.match(r.error, /disk full/)
  assert.equal(calls.length, 1, '应尝试清理临时文件')
  assert.match(calls[0][1], /\.tmp-/, '清理的是临时文件')
})

// ════════════════════════════════════════════════════════════════
// v4：提示词库 prompt-lib.js
// ════════════════════════════════════════════════════════════════
import {
  BUILTIN_PROMPTS,
  SOURCES,
  nextPromptId,
  normalizePrompt,
  normalizeLibrary,
  upsertPrompt,
  removePrompt,
  findPrompt,
  parseModelCatalog,
} from './prompt-lib.js'

test('BUILTIN_PROMPTS：三条内置，id 均以 builtin- 开头', () => {
  assert.ok(Array.isArray(BUILTIN_PROMPTS))
  assert.ok(BUILTIN_PROMPTS.length >= 3)
  for (const p of BUILTIN_PROMPTS) {
    assert.ok(String(p.id).startsWith('builtin-'), `id 应以 builtin- 开头：${p.id}`)
    assert.ok(p.text && p.text.trim(), '内置条目不能为空文本')
    assert.equal(p.source, 'builtin')
  }
})

test('nextPromptId：不冲突时返回 base 本身', () => {
  assert.equal(nextPromptId([], 'prompt'), 'prompt')
  assert.equal(nextPromptId([{ id: 'other' }], 'prompt'), 'prompt')
})

test('nextPromptId：冲突时递增后缀', () => {
  const lib = [{ id: 'prompt' }, { id: 'prompt-2' }]
  assert.equal(nextPromptId(lib, 'prompt'), 'prompt-3')
})

test('nextPromptId：跳过空洞', () => {
  const lib = [{ id: 'prompt' }, { id: 'prompt-3' }]
  assert.equal(nextPromptId(lib, 'prompt'), 'prompt-2')
})

test('normalizePrompt：合法输入补全默认字段', () => {
  const r = normalizePrompt({ text: '你好' })
  assert.equal(r.ok, true)
  assert.equal(r.value.text, '你好')
  assert.equal(r.value.source, 'manual', '未指定 source 应回落 manual')
  assert.ok(r.value.at, '应补 at 时间戳')
})

test('normalizePrompt：拒绝空文本与非对象', () => {
  assert.equal(normalizePrompt({ text: '   ' }).ok, false)
  assert.equal(normalizePrompt(null).ok, false)
  assert.equal(normalizePrompt('string').ok, false)
  assert.equal(normalizePrompt([]).ok, false)
})

test('normalizePrompt：source 不在白名单则回落 manual', () => {
  const r = normalizePrompt({ text: 'x', source: 'evil' })
  assert.equal(r.ok, true)
  assert.equal(r.value.source, 'manual')
})

test('★ normalizeLibrary：null/undefined 返回内置副本（且是数组）', () => {
  const a = normalizeLibrary(null)
  const b = normalizeLibrary(undefined)
  assert.ok(Array.isArray(a), '必须返回数组，不能是类数组对象')
  assert.ok(Array.isArray(b))
  assert.ok(a.length >= 3)
})

test('★ normalizeLibrary：返回的是副本，改它不影响 BUILTIN_PROMPTS', () => {
  const lib = normalizeLibrary(null)
  lib[0].text = '被改坏了'
  assert.notEqual(BUILTIN_PROMPTS[0].text, '被改坏了', '不允许污染内置常量')
})

test('normalizeLibrary：丢弃空文本与非对象条目', () => {
  const lib = normalizeLibrary([{ id: 'a', text: 'ok' }, { id: 'b', text: '' }, null, 'str'])
  assert.equal(lib.length, 1 + BUILTIN_PROMPTS.length)
  assert.equal(lib[0].id, 'a')
})

test('normalizeLibrary：id 去重，保留首条', () => {
  const lib = normalizeLibrary([
    { id: 'dup', text: '第一条' },
    { id: 'dup', text: '第二条' },
  ])
  const dups = lib.filter((e) => e.id === 'dup')
  assert.equal(dups.length, 1)
  assert.equal(dups[0].text, '第一条')
})

test('normalizeLibrary：无 id 自动分配且不撞已有', () => {
  const lib = normalizeLibrary([{ text: '一' }, { id: 'prompt', text: '二' }, { text: '三' }])
  const ids = lib.map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'id 必须唯一')
  assert.ok(ids.includes('prompt'))
})

test('★ normalizeLibrary：内置条目被删后自动恢复', () => {
  const lib = normalizeLibrary([{ id: 'my', text: '我的' }])
  for (const b of BUILTIN_PROMPTS) {
    assert.ok(lib.some((e) => e.id === b.id), `内置条目 ${b.id} 应被恢复`)
  }
})

test('normalizeLibrary：非数组入参抛错', () => {
  assert.throws(() => normalizeLibrary('不是数组'), /数组/)
  assert.throws(() => normalizeLibrary({}), /数组/)
})

test('★ upsertPrompt：不改入参（不可变）', () => {
  const lib = [{ id: 'a', name: 'A', source: 'manual', text: '原文', url: '', at: 't1' }]
  const snapshot = JSON.stringify(lib)
  upsertPrompt(lib, { id: 'a', text: '新文' })
  assert.equal(JSON.stringify(lib), snapshot, '入参必须原样不动')
})

test('upsertPrompt：新 id 追加到末尾', () => {
  const lib = [{ id: 'a', text: 'A' }]
  const out = upsertPrompt(lib, { text: 'B' })
  assert.equal(out.length, 2)
  assert.ok(out[1].text === 'B')
})

test('upsertPrompt：同 id 覆盖内容但保留原 source/at', () => {
  const lib = [{ id: 'a', name: '原名', source: 'web', text: '旧', url: 'http://x', at: '2020' }]
  const out = upsertPrompt(lib, { id: 'a', text: '新' })
  assert.equal(out.length, 1)
  assert.equal(out[0].text, '新')
  assert.equal(out[0].source, 'web', '非内置条目的 source 应保留')
  assert.equal(out[0].at, '2020', '未提供 at 应保留旧的')
})

test('★ upsertPrompt：内置条目不可改成非内置（防来源漂移）', () => {
  const lib = normalizeLibrary(null)
  const out = upsertPrompt(lib, { id: 'builtin-concise', source: 'web', text: '改写' })
  const hit = out.find((e) => e.id === 'builtin-concise')
  assert.equal(hit.source, 'builtin', '内置条目的 source 不允许被改成别的')
})

test('upsertPrompt：空文本抛错', () => {
  assert.throws(() => upsertPrompt([], { text: '' }), /不能为空/)
})

test('★ removePrompt：普通条目能删', () => {
  const lib = [{ id: 'a', text: 'A', source: 'manual' }, { id: 'b', text: 'B', source: 'manual' }]
  const out = removePrompt(lib, 'a')
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'b')
})

test('★ removePrompt：内置条目删不掉', () => {
  const lib = normalizeLibrary(null)
  const before = lib.length
  const out = removePrompt(lib, 'builtin-concise')
  assert.equal(out.length, before, '删除内置条目应无效')
  assert.ok(out.some((e) => e.id === 'builtin-concise'))
})

test('removePrompt：id 以 builtin- 开头的一律删不掉（兜底）', () => {
  const lib = [{ id: 'builtin-x', text: 'X', source: 'manual' }]
  const out = removePrompt(lib, 'builtin-x')
  assert.equal(out.length, 1, '按 id 前缀兜底保护')
})

test('removePrompt：删不存在的 id 原样返回', () => {
  const lib = [{ id: 'a', text: 'A', source: 'manual' }]
  assert.equal(removePrompt(lib, 'nope').length, 1)
  assert.equal(removePrompt(lib, '').length, 1)
  assert.equal(removePrompt(null, 'a'), null)
})

test('removePrompt：不改入参', () => {
  const lib = [{ id: 'a', text: 'A', source: 'manual' }]
  const snap = JSON.stringify(lib)
  removePrompt(lib, 'a')
  assert.equal(JSON.stringify(lib), snap)
})

test('findPrompt：命中与未命中', () => {
  const lib = [{ id: 'a', text: 'A' }]
  assert.equal(findPrompt(lib, 'a').text, 'A')
  assert.equal(findPrompt(lib, 'nope'), null)
  assert.equal(findPrompt(lib, ''), null)
  assert.equal(findPrompt(null, 'a'), null)
})

// ── parseModelCatalog ──────────────────────────────────────────

const SAMPLE_YAML = [
  '- insert:',
  '    - id: llm-pi-ai',
  '      name: llm-pi-ai',
  '      config:',
  '        providers:',
  '          - id: provider-a',
  '            name: A 家',
  '            models:',
  '              - id: vendor/model-one',
  '                name: Model One',
  '              - id: vendor/model-two',
  '                name: "Model Two"',
  '          - id: provider-b',
  '            models:',
  '              - id: other/model-three',
  '                name: Model Three',
  '    - id: some-other-plugin',
  '      config:',
  '        providers:',
  '          - id: provider-c',
  '            models:',
  '              - id: should/not-appear',
  '                name: Nope',
  '',
].join('\n')

test('★ parseModelCatalog：跨多个 provider 抽出全部模型', () => {
  const out = parseModelCatalog(SAMPLE_YAML)
  assert.equal(out.length, 3, `应抽出 3 个，实得 ${out.length}`)
  assert.deepEqual(out.map((m) => m.id), [
    'vendor/model-one',
    'vendor/model-two',
    'other/model-three',
  ])
})

test('★ parseModelCatalog：name 成对提取，去引号', () => {
  const out = parseModelCatalog(SAMPLE_YAML)
  assert.equal(out[0].name, 'Model One')
  assert.equal(out[1].name, 'Model Two', '双引号应被剥掉')
})

test('★ parseModelCatalog：只认 llm-pi-ai 段，别的 loader 行不越界', () => {
  const out = parseModelCatalog(SAMPLE_YAML)
  assert.ok(!out.some((m) => m.id === 'should/not-appear'), '不应跨出 llm-pi-ai')
})

test('parseModelCatalog：忽略注释与空行', () => {
  const out = parseModelCatalog('# 注释\n\n- insert:\n    - id: llm-pi-ai\n      config:\n        providers:\n          - id: p\n            models:\n              - id: a/b\n                name: AB\n')
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'a/b')
})

test('parseModelCatalog：没有 llm-pi-ai 时返回空数组', () => {
  assert.deepEqual(parseModelCatalog('- insert:\n    - id: other\n'), [])
  assert.deepEqual(parseModelCatalog(''), [])
  assert.deepEqual(parseModelCatalog(null), [])
})

test('parseModelCatalog：models 为空或模型无 name 也安全', () => {
  const y = [
    '- insert:',
    '    - id: llm-pi-ai',
    '      config:',
    '        providers:',
    '          - id: p',
    '            models:',
    '              - id: only/id',
    '',
  ].join('\n')
  const out = parseModelCatalog(y)
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'only/id')
  assert.equal(out[0].name, '', '无 name 时应为空串而非 undefined')
})

test('parseModelCatalog：重复 id 不去重（目录原样）', () => {
  const y = [
    '- insert:',
    '    - id: llm-pi-ai',
    '      config:',
    '        providers:',
    '          - id: p',
    '            models:',
    '              - id: a/b',
    '                name: AB',
    '              - id: a/b',
    '                name: AB2',
    '',
  ].join('\n')
  const out = parseModelCatalog(y)
  assert.equal(out.length, 2, '模型目录按原样输出，去重交给界面')
})

// ── normalizeModelCatalog（v4 双轨：服务返回 or 手贴） ──────────
import { normalizeModelCatalog } from './prompt-lib.js'

test('★ normalizeModelCatalog：ModelCatalog 形态跨 provider 拍平', () => {
  const cat = {
    default: { id: 'vendor/def', name: '默认模型' },
    providers: [
      { id: 'pa', name: 'A 家', models: [
        { id: 'vendor/one', name: 'One' },
        { id: 'vendor/two', name: 'Two', description: '描述' },
      ] },
      { id: 'pb', name: 'B 家', models: [{ id: 'other/three', name: 'Three' }] },
    ],
  }
  const out = normalizeModelCatalog(cat)
  assert.equal(out.length, 4)
  assert.deepEqual(out.map((m) => m.id), [
    'vendor/one',
    'vendor/two',
    'other/three',
    'vendor/def',
  ])
  assert.equal(out[0].name, 'One')
})

test('normalizeModelCatalog：扁平数组形态', () => {
  const out = normalizeModelCatalog([{ id: 'a/b', name: 'AB' }])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], { id: 'a/b', name: 'AB' })
})

test('★ normalizeModelCatalog：按 id 去重，保留首条', () => {
  const out = normalizeModelCatalog([
    { id: 'a/b', name: '第一个名字' },
    { id: 'a/b', name: '第二个名字' },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].name, '第一个名字')
})

test('normalizeModelCatalog：跨 provider 的重复 id 也去重', () => {
  const cat = {
    providers: [
      { id: 'p1', models: [{ id: 'x/y', name: 'X' }] },
      { id: 'p2', models: [{ id: 'x/y', name: 'X again' }] },
    ],
  }
  const out = normalizeModelCatalog(cat)
  assert.equal(out.length, 1, '同一个 id 在两个 provider 下只留一个')
})

test('normalizeModelCatalog：缺 name 时回退成 id', () => {
  const out = normalizeModelCatalog([{ id: 'a/b' }])
  assert.equal(out[0].name, 'a/b', '没有 name 就用 id 顶着，别显示空白')
})

test('normalizeModelCatalog：丢弃无 id / 非对象条目', () => {
  const out = normalizeModelCatalog([
    { name: '没 id' },
    null,
    '字符串',
    { id: '  ', name: '空白 id' },
    { id: 'ok', name: 'OK' },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'ok')
})

test('normalizeModelCatalog：default 不在任何组里也要收', () => {
  const cat = {
    default: { id: 'solo/def', name: 'D' },
    providers: [{ id: 'p', models: [{ id: 'a/b', name: 'AB' }] }],
  }
  const out = normalizeModelCatalog(cat)
  assert.ok(out.some((m) => m.id === 'solo/def'), 'default 不能被漏掉')
})

test('normalizeModelCatalog：default 与某组重复时不重复收', () => {
  const cat = {
    default: { id: 'a/b', name: 'D' },
    providers: [{ id: 'p', models: [{ id: 'a/b', name: 'AB' }] }],
  }
  assert.equal(normalizeModelCatalog(cat).length, 1)
})

test('normalizeModelCatalog：畸形输入一律返回空数组，绝不抛', () => {
  assert.deepEqual(normalizeModelCatalog(null), [])
  assert.deepEqual(normalizeModelCatalog(undefined), [])
  assert.deepEqual(normalizeModelCatalog('字符串'), [])
  assert.deepEqual(normalizeModelCatalog(42), [])
  assert.deepEqual(normalizeModelCatalog([]), [])
  assert.deepEqual(normalizeModelCatalog({}), [])
  assert.deepEqual(normalizeModelCatalog({ providers: '不是数组' }), [])
  assert.deepEqual(normalizeModelCatalog({ providers: [null, {}, { models: 'x' }] }), [])
})

test('normalizeModelCatalog：providers 里某组无 models 不影响其它组', () => {
  const cat = {
    providers: [
      { id: 'broken' },
      { id: 'ok', models: [{ id: 'a/b', name: 'AB' }] },
    ],
  }
  assert.equal(normalizeModelCatalog(cat).length, 1)
})

test('normalizeModelCatalog：不改入参', () => {
  const cat = { providers: [{ id: 'p', models: [{ id: 'a/b', name: 'AB' }] }] }
  const snap = JSON.stringify(cat)
  normalizeModelCatalog(cat)
  assert.equal(JSON.stringify(cat), snap)
})

// ── removePrompt 的 null 条目回归（曾因 `!e ||` 写成死代码） ────
test('★ removePrompt：库里有 null 条目时仍能删除目标', () => {
  const lib = [
    { id: 'a', text: 'A', source: 'manual' },
    null,
    { id: 'b', text: 'B', source: 'manual' },
  ]
  const out = removePrompt(lib, 'a')
  assert.equal(out.length, 1, 'null 应被一并清掉，只留 b')
  assert.equal(out[0].id, 'b')
})

test('★ removePrompt：只删目标，null 条目仍被清理', () => {
  const lib = [null, { id: 'a', text: 'A', source: 'manual' }, null]
  const out = removePrompt(lib, 'a')
  assert.equal(out.length, 0)
})

// ── summarizeAssembly（v4 真实装配预览） ───────────────────


const fakeAssembly = () => ({
  sections: [
    { name: 'harness:identity', order: 0, text: '你是 DSH 助手。' },
    { name: 'harness:tools', order: 5, text: '工具使用指导：...'.repeat(20) },
    { name: 'model-persona:main', order: 1, text: '你运行在某个模型上。先给结论。' },
    { name: 'plan:policy', order: 9, text: '计划策略...' },
  ],
  contexts: [{ name: 'cwd' }, { name: 'sandbox' }],
  tools: [{ name: 'read' }, { name: 'write' }, { name: 'bash' }],
  variables: [{ name: 'date' }],
})

test('★ summarizeAssembly：逐段摘要，标出本插件的段', () => {
  const s = summarizeAssembly(fakeAssembly(), { ownSection: 'model-persona:main' })
  assert.equal(s.sectionCount, 4)
  assert.equal(s.sections.length, 4)
  const own = s.sections.find((x) => x.name === 'model-persona:main')
  assert.equal(own.own, true, '本插件段必须被标出来')
  assert.ok(own.chars > 0)
  assert.equal(s.sections.filter((x) => x.own).length, 1, '只应有一段是本插件的')
})

test('summarizeAssembly：统计总字符与本插件字符', () => {
  const s = summarizeAssembly(fakeAssembly(), { ownSection: 'model-persona:main' })
  assert.ok(s.totalChars > s.ownChars, '总字符应大于本插件字符')
  assert.equal(s.ownInjected, true)
  assert.equal(s.ownChars, '你运行在某个模型上。先给结论。'.length)
})

test('summarizeAssembly：工具数量与名字', () => {
  const s = summarizeAssembly(fakeAssembly(), {})
  assert.equal(s.toolCount, 3)
  assert.deepEqual(s.toolNames, ['read', 'write', 'bash'])
})

test('summarizeAssembly：contexts / variables 计数', () => {
  const s = summarizeAssembly(fakeAssembly(), {})
  assert.equal(s.contextCount, 2)
  assert.equal(s.variableCount, 1)
})

test('★ summarizeAssembly：函数段被求值（本插件就是函数段）', () => {
  const asm = {
    sections: [
      { name: 'model-persona:main', order: 1, text: (ctx) => `模型=${ctx.agent.options.model}` },
    ],
    tools: [],
    contexts: [],
    variables: [],
  }
  const s = summarizeAssembly(asm, { ownSection: 'model-persona:main', model: 'vendor/x' })
  assert.equal(s.sections[0].lazy, true, '应标记为懒求值段')
  assert.equal(s.sections[0].chars, '模型=vendor/x'.length)
  assert.equal(s.sections[0].head, '模型=vendor/x')
})

test('summarizeAssembly：函数段抛错时降级为空，不崩', () => {
  const asm = {
    sections: [{ name: 'bad', order: 1, text: () => { throw new Error('boom') } }],
    tools: [],
    contexts: [],
    variables: [],
  }
  const s = summarizeAssembly(asm, {})
  assert.equal(s.sections[0].chars, 0)
  assert.equal(s.sections[0].head, '')
})

test('summarizeAssembly：只保留前 200 字，避免面板被撑爆', () => {
  const long = 'x'.repeat(5000)
  const s = summarizeAssembly({ sections: [{ name: 'a', order: 1, text: long }], tools: [] }, {})
  assert.equal(s.sections[0].chars, 5000, '字符数要算全量')
  assert.equal(s.sections[0].head.length, 200, '预览只给前 200 字')
})

test('summarizeAssembly：畸形输入一律降级，绝不抛', () => {
  assert.deepEqual(summarizeAssembly(null, {}).sections, [])
  assert.deepEqual(summarizeAssembly(undefined, {}).sections, [])
  assert.equal(summarizeAssembly({}, {}).sectionCount, 0)
  assert.equal(summarizeAssembly({ sections: '不是数组' }, {}).sectionCount, 0)
  assert.equal(summarizeAssembly({ sections: [null, 'str', {}] }, {}).sectionCount, 0)
  assert.equal(summarizeAssembly({ sections: [{ name: 'a' }] }, {}).sections[0].chars, 0)
})

test('summarizeAssembly：无 name 的段给占位名', () => {
  const s = summarizeAssembly({ sections: [{ text: 'x' }] }, {})
  assert.equal(s.sections[0].name, '(未命名)')
})

test('summarizeAssembly：没传 ownSection 时没有段被标为 own', () => {
  const s = summarizeAssembly(fakeAssembly(), {})
  assert.equal(s.sections.filter((x) => x.own).length, 0)
  assert.equal(s.ownInjected, false)
})

test('summarizeAssembly：工具数超过 40 个只留前 40 个名字', () => {
  const tools = Array.from({ length: 60 }, (_, i) => ({ name: `t${i}` }))
  const s = summarizeAssembly({ sections: [], tools }, {})
  assert.equal(s.toolCount, 60, '数量算全量')
  assert.equal(s.toolNames.length, 40, '名字只留前 40')
})

test('summarizeAssembly：replaced 标记透传', () => {
  assert.equal(summarizeAssembly({ sections: [] }, { replaced: true }).replaced, true)
  assert.equal(summarizeAssembly({ sections: [] }, {}).replaced, false)
})

test('summarizeAssembly：不改入参', () => {
  const asm = fakeAssembly()
  const snap = JSON.stringify(asm)
  summarizeAssembly(asm, { ownSection: 'model-persona:main' })
  assert.equal(JSON.stringify(asm), snap)
})
