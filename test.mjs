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
