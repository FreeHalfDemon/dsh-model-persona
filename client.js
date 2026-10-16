/**
 * dsh-model-persona —— 浏览器半区（v4）
 *
 * 手写 `window.__ModuleLoader__.load({ id, factory(require) })` 懒加载 CJS 工厂 ——
 * 官方模板与 dsh-budget 的真实实现都是这个形状，**不需要任何构建工具**。
 * React 从浏览器模块表 `require('react')` 取，**不安装第二份 React**。
 *
 * v4 只保留两个形态（v3 的三形态 + 切换器已砍掉：没人要求，且切换器本身
 * 就是「过度设计」的典型）：
 *   ① 设置页 Tab   → settings.plugins.tab（完整编辑）
 *   ② 输入框状态条 → conversation.composer.dock（只看状态，点它跳不出浮层了）
 *
 * v4 解决 v3 最大的 UX 硬伤：**用户被迫手打模型 id**。
 * 现在模型选择是**下拉框**——界面显示人话 name，配置里存真实 id。
 * 这个坑从根上消失，不靠提示文案绕。
 *
 * 数据通道：fetch 本插件自己的路由（/model-persona/*）。
 * 样式只用官方主题 token（--dsw-alias-*），不引入自带配色。
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-persona',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'model-persona'
    const API = '/model-persona'

    // ── 本地化字典 ──────────────────────────────────────────
    const zh = {
      tab: '按模型换人格',
      title: '按模型换人格',
      subtitle: '当前模型变了，注入的系统提示词跟着变。改完保存，下一步生效，不用重启。',
      currentModel: '当前真实模型 id',
      matched: '命中的映射',
      noMatch: '未命中任何按模型映射',
      mode: '模式',
      modeAppend: '追加（安全）',
      modeReplace: '整体替换（除工具外全换）',
      replaceWarn:
        '⚠️ 整体替换会丢掉 harness 自带的工具使用指导，模型可能变得不太会用工具。除非确定要全换，否则用「追加」。',
      enabled: '启用',
      mappings: '按模型映射',
      model: '模型',
      modelPick: '从下拉选一个模型',
      modelCustom: '手打模型 id',
      modelCustomHint: '下拉里没有？直接填宿主真实模型 id。',
      catalogEmpty: '模型目录还没加载出来，可以先手打 id。',
      catalogFrom: '目录来源',
      catalogService: '宿主服务',
      catalogFallback: '手贴',
      catalogNone: '无',
      source: '提示词来源',
      sourceInline: '内联一段文本',
      sourceLibrary: '引用提示词库',
      text: '人格文本',
      prompt: '库条目',
      add: '新增一条',
      remove: '删除',
      fallback: '兜底文本（都没命中时用）',
      preview: '实时预览',
      previewHint: '这段就是当前模型会注入的文本。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      failed: '保存失败',
      reload: '刷新',
      empty: '还没有任何映射。点「新增一条」开始。',
      library: '提示词库',
      libraryEmpty: '库里还没有自定义条目。',
      libraryNew: '新建条目',
      libraryName: '条目名',
      libraryBuiltin: '内置',
      useCurrent: '用当前模型',
      loadFail: '读不到插件状态',
      advanced: '高级选项',
      advancedHint: '一般不用动。改错可能让人格不生效。',
      replaceContexts: '连运行上下文一起替换',
      sectionName: '段名',
      order: '排序',
    }
    const en = {
      tab: 'Per-model persona',
      title: 'Per-model persona',
      subtitle:
        'The injected system prompt follows the current model. Save, then it applies on the next step without a restart.',
      currentModel: 'Current real model id',
      matched: 'Matched mapping',
      noMatch: 'No per-model mapping matched',
      mode: 'Mode',
      modeAppend: 'Append (safe)',
      modeReplace: 'Full replace (everything but tools)',
      replaceWarn:
        '⚠️ Full replace drops the harness tool-usage guidance, so the model may use tools less well. Use Append unless you really want a full swap.',
      enabled: 'Enabled',
      mappings: 'Per-model mappings',
      model: 'Model',
      modelPick: 'Pick a model',
      modelCustom: 'Type a model id',
      modelCustomHint: 'Not in the list? Type the host real model id directly.',
      catalogEmpty: 'The model catalog is not loaded yet; you can still type an id.',
      catalogFrom: 'Catalog source',
      catalogService: 'Host service',
      catalogFallback: 'Pasted',
      catalogNone: 'None',
      source: 'Prompt source',
      sourceInline: 'Inline text',
      sourceLibrary: 'From library',
      text: 'Persona text',
      prompt: 'Library entry',
      add: 'Add entry',
      remove: 'Remove',
      fallback: 'Fallback text (when nothing matches)',
      preview: 'Live preview',
      previewHint: 'This is exactly what the current model receives.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      failed: 'Save failed',
      reload: 'Refresh',
      empty: 'No mappings yet. Click "Add entry" to start.',
      library: 'Prompt library',
      libraryEmpty: 'No custom entries yet.',
      libraryNew: 'New entry',
      libraryName: 'Entry name',
      libraryBuiltin: 'Built-in',
      useCurrent: 'Use current model',
      loadFail: 'Cannot read plugin state',
      advanced: 'Advanced',
      advancedHint: 'Usually leave these alone. A wrong value can silence the persona.',
      replaceContexts: 'Replace runtime contexts too',
      sectionName: 'Section name',
      order: 'Order',
    }

    // ── 样式（只用官方 token）────────────────────────────────
    const CSS = `
[data-dmp] { display: flex; flex-direction: column; gap: 12px; min-width: 0; color: var(--dsw-alias-label-primary); }
[data-dmp] .dmp-head { display: flex; flex-direction: column; gap: 4px; }
[data-dmp] .dmp-h { margin: 0; font-size: 1.05em; font-weight: 600; }
[data-dmp] .dmp-sub { margin: 0; color: var(--dsw-alias-label-secondary); font-size: .92em; line-height: 1.5; }
[data-dmp] .dmp-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
[data-dmp] .dmp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 200px; }
[data-dmp] .dmp-label { font-size: .86em; color: var(--dsw-alias-label-secondary); }
[data-dmp] .dmp-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-layer-1); }
[data-dmp] .dmp-card-head { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
[data-dmp] input[type=text], [data-dmp] textarea, [data-dmp] select {
  font: inherit; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 6px 8px; width: 100%; box-sizing: border-box;
}
[data-dmp] textarea { min-height: 72px; resize: vertical; line-height: 1.5; }
[data-dmp] button {
  font: inherit; cursor: pointer; border-radius: 6px; padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
}
[data-dmp] button.dmp-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
[data-dmp] button.dmp-danger { color: var(--dsw-alias-state-error-primary); }
[data-dmp] button:disabled { opacity: .5; cursor: default; }
/* 常驻警示条：replace 模式的代价必须一直在眼前，不能只在该模式下闪现一下 */
[data-dmp] .dmp-banner { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-state-warn-primary); font-size: .9em; line-height: 1.55; }
[data-dmp] .dmp-err { color: var(--dsw-alias-state-error-primary); font-size: .9em; margin: 0; }
[data-dmp] .dmp-ok { color: var(--dsw-alias-state-success-primary); font-size: .9em; margin: 0; }
[data-dmp] .dmp-code { font-family: ui-monospace, Consolas, monospace; font-size: .88em; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 8px; white-space: pre-wrap; word-break: break-word; margin: 0; max-height: 220px; overflow: auto; }
[data-dmp] .dmp-id { font-family: ui-monospace, Consolas, monospace; font-size: .9em; word-break: break-all; }
[data-dmp] .dmp-sep { border: 0; border-top: 1px solid var(--dsw-alias-border-l1); margin: 2px 0; }
[data-dmp] .dmp-chip { font-size: .85em; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
[data-dmp] .dmp-librow { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
[data-dmp] .dmp-libname { font-size: .9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 状态条（composer dock）*/
[data-dmp-dock] { display: inline-flex; align-items: center; gap: 6px; font-size: .82em; color: var(--dsw-alias-label-secondary); user-select: none; }
[data-dmp-dock] .dmp-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: none; }
[data-dmp-dock].dmp-off .dmp-dot { background: var(--dsw-alias-state-idle-primary); }
[data-dmp-dock].dmp-replace .dmp-dot { background: var(--dsw-alias-state-warn-primary); }
`

    function installStyles() {
      const stale = document.querySelector('style[data-dmp-style]')
      if (stale) stale.remove()
      const el = document.createElement('style')
      el.dataset.dmpStyle = ''
      el.textContent = CSS
      document.head.append(el)
      return () => el.remove()
    }

    // ── 与 Host 的通信 ──────────────────────────────────────
    async function getState() {
      const r = await fetch(`${API}/state`, { headers: { accept: 'application/json' } })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'state failed')
      // 面板要的不只是 state：还有模型目录（双轨）与来源标注
      return {
        state: j.state,
        models: Array.isArray(j.models) ? j.models : [],
        catalogSource: j.catalogSource || 'none',
        catalogError: j.catalogError || '',
      }
    }
    async function saveConfig(cfg) {
      const r = await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-model-persona': '1' },
        body: JSON.stringify(cfg),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'save failed')
      return true
    }
    async function postCatalog(catalog) {
      const r = await fetch(`${API}/catalog`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-model-persona': '1' },
        body: JSON.stringify({ catalog }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'catalog failed')
      return j.count
    }

    // ── 映射条目的两种形态 ──────────────────────────────────
    // 兼容旧配置：byModel[key] 可能是字符串（纯内联），也可能是对象
    // { text } 或 { promptId }。面板统一按对象编辑，保存时按来源决定写哪种。
    function entryOf(v) {
      if (typeof v === 'string') return { source: 'inline', text: v, promptId: '' }
      if (v && typeof v === 'object') {
        if (typeof v.promptId === 'string' && v.promptId) {
          return { source: 'library', text: v.text || '', promptId: v.promptId }
        }
        return { source: 'inline', text: v.text || '', promptId: '' }
      }
      return { source: 'inline', text: '', promptId: '' }
    }
    function entryToValue(e) {
      if (e.source === 'library' && e.promptId) return { promptId: e.promptId }
      return { text: e.text }
    }

    // ── 主面板组件 ──────────────────────────────────────────
    function Panel({ t, compact }) {
      const [bundle, setBundle] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [showAdvanced, setShowAdvanced] = React.useState(false)
      const [libDraft, setLibDraft] = React.useState(null)
      const [catalogDraft, setCatalogDraft] = React.useState('')

      const load = React.useCallback(async () => {
        try {
          const b = await getState()
          setBundle(b)
          setDraft({ ...b.state })
          setMsg(null)
        } catch (e) {
          setMsg({ kind: 'err', text: `${t('loadFail')}: ${e.message}` })
        }
      }, [t])

      React.useEffect(() => {
        load()
      }, [load])

      if (!bundle || !draft) {
        return h('div', { 'data-dmp': '' }, h('p', { className: 'dmp-sub' }, '…'))
      }

      const { state, models, catalogSource } = bundle
      const rows = Object.entries(draft.byModel || {})
      const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
      const setEntry = (key, patch) =>
        setDraft((d) => {
          const cur = entryOf(d.byModel[key])
          const next = { ...cur, ...patch }
          return { ...d, byModel: { ...d.byModel, [key]: entryToValue(next) } }
        })
      const renameKey = (oldKey, newKey) =>
        setDraft((d) => {
          if (oldKey === newKey || !newKey) return d
          const next = {}
          for (const [k, v] of Object.entries(d.byModel)) next[k === oldKey ? newKey : k] = v
          return { ...d, byModel: next }
        })
      const removeKey = (key) =>
        setDraft((d) => {
          const next = { ...d.byModel }
          delete next[key]
          return { ...d, byModel: next }
        })
      const addKey = () =>
        setDraft((d) => {
          const base = state.model || 'new-model'
          let k = base
          let i = 2
          while (k in d.byModel) k = `${base}-${i++}`
          return { ...d, byModel: { ...d.byModel, [k]: { text: '' } } }
        })

      const onSave = async () => {
        setBusy(true)
        setMsg(null)
        try {
          // 面板提交的是**完整配置**；Host 侧会严格校验后再原子写盘
          const payload = {
            enabled: draft.enabled,
            mode: draft.mode,
            replaceContexts: draft.replaceContexts,
            debug: draft.debug,
            sectionName: draft.sectionName,
            order: draft.order,
            default: draft.default,
            byModel: draft.byModel,
          }
          await saveConfig(payload)
          await load()
          setMsg({ kind: 'ok', text: t('saved') })
        } catch (e) {
          setMsg({ kind: 'err', text: `${t('failed')}: ${e.message}` })
        } finally {
          setBusy(false)
        }
      }

      const onSaveCatalog = async () => {
        setBusy(true)
        setMsg(null)
        try {
          const n = await postCatalog(JSON.parse(catalogDraft))
          setMsg({ kind: 'ok', text: `目录已更新：${n} 个模型` })
          await load()
        } catch (e) {
          setMsg({ kind: 'err', text: `${t('failed')}: ${e.message}` })
        } finally {
          setBusy(false)
        }
      }

      const nameOf = (id) => {
        const hit = models.find((m) => m.id === id)
        return hit ? hit.name : id
      }
      const catalogLabel =
        catalogSource === 'service'
          ? t('catalogService')
          : catalogSource === 'fallback'
            ? t('catalogFallback')
            : t('catalogNone')

      return h(
        'div',
        { 'data-dmp': '' },
        h(
          'div',
          { className: 'dmp-head' },
          h('h3', { className: 'dmp-h' }, t('title')),
          !compact && h('p', { className: 'dmp-sub' }, t('subtitle')),
        ),

        // replace 模式的代价必须**常驻**，不是只在该模式下闪现一下
        draft.mode === 'replace' && h('div', { className: 'dmp-banner' }, h('span', null, t('replaceWarn'))),

        // ① 当前模型 + 命中情况
        h(
          'div',
          { className: 'dmp-card' },
          h('span', { className: 'dmp-label' }, t('currentModel')),
          h('code', { className: 'dmp-id' }, state.model || '—'),
          h(
            'div',
            { className: 'dmp-row' },
            h(
              'span',
              { className: 'dmp-chip' },
              state.matchedKey ? `${t('matched')}: ${nameOf(state.matchedKey)}` : t('noMatch'),
            ),
            h('span', { className: 'dmp-chip' }, `${t('mode')}: ${state.effectiveMode}`),
            h('span', { className: 'dmp-chip' }, `${t('catalogFrom')}: ${catalogLabel}`),
          ),
          !models.length && h('p', { className: 'dmp-sub' }, t('catalogEmpty')),
        ),

        h('hr', { className: 'dmp-sep' }),

        // ② 开关 + 模式
        h(
          'div',
          { className: 'dmp-row' },
          h(
            'label',
            { className: 'dmp-row' },
            h('input', {
              type: 'checkbox',
              checked: draft.enabled !== false,
              onChange: (e) => setField('enabled', e.target.checked),
            }),
            h('span', { className: 'dmp-label' }, t('enabled')),
          ),
          h(
            'div',
            { className: 'dmp-field' },
            h('span', { className: 'dmp-label' }, t('mode')),
            h(
              'select',
              { value: draft.mode, onChange: (e) => setField('mode', e.target.value) },
              h('option', { value: 'append' }, t('modeAppend')),
              h('option', { value: 'replace' }, t('modeReplace')),
            ),
          ),
        ),

        h('hr', { className: 'dmp-sep' }),

        // ③ 映射列表
        h(
          'div',
          { className: 'dmp-card-head' },
          h('span', { className: 'dmp-label' }, `${t('mappings')} (${rows.length})`),
          h(
            'div',
            { className: 'dmp-row' },
            h('button', { onClick: load }, t('reload')),
            h('button', { onClick: addKey }, t('add')),
          ),
        ),
        rows.length === 0 && h('p', { className: 'dmp-sub' }, t('empty')),
        ...rows.map(([key, val]) => {
          const e = entryOf(val)
          return h(
            'div',
            { className: 'dmp-card', key },
            // 模型选择：下拉显示 name、存 id；同时保留手打入口
            h(
              'div',
              { className: 'dmp-row' },
              h(
                'div',
                { className: 'dmp-field' },
                h('span', { className: 'dmp-label' }, t('model')),
                h(
                  'select',
                  {
                    value: models.some((m) => m.id === key) ? key : '',
                    onChange: (ev) => renameKey(key, ev.target.value),
                  },
                  h('option', { value: '' }, models.length ? t('modelCustom') : t('catalogEmpty')),
                  ...models.map((m) => h('option', { key: m.id, value: m.id }, m.name)),
                ),
              ),
              h(
                'div',
                { className: 'dmp-field' },
                h('span', { className: 'dmp-label' }, t('modelCustom')),
                h('input', {
                  type: 'text',
                  value: key,
                  'aria-label': t('modelCustom'),
                  onChange: (ev) => renameKey(key, ev.target.value.trim()),
                }),
                h('span', { className: 'dmp-label' }, t('modelCustomHint')),
              ),
              state.model &&
                h(
                  'button',
                  { title: t('useCurrent'), onClick: () => renameKey(key, state.model) },
                  t('useCurrent'),
                ),
              h('button', { className: 'dmp-danger', onClick: () => removeKey(key) }, t('remove')),
            ),

            // 提示词来源：内联 or 引用库
            h(
              'div',
              { className: 'dmp-row' },
              h(
                'div',
                { className: 'dmp-field', style: { flex: '0 0 auto' } },
                h('span', { className: 'dmp-label' }, t('source')),
                h(
                  'select',
                  {
                    value: e.source,
                    onChange: (ev) => setEntry(key, { source: ev.target.value }),
                  },
                  h('option', { value: 'inline' }, t('sourceInline')),
                  h('option', { value: 'library' }, t('sourceLibrary')),
                ),
              ),
            ),
            e.source === 'library'
              ? h(
                  'div',
                  { className: 'dmp-field' },
                  h('span', { className: 'dmp-label' }, t('prompt')),
                  h('input', {
                    type: 'text',
                    value: e.promptId,
                    placeholder: 'prompt-id',
                    onChange: (ev) => setEntry(key, { promptId: ev.target.value.trim() }),
                  }),
                )
              : h('textarea', {
                  value: e.text,
                  'aria-label': t('text'),
                  placeholder: t('text'),
                  onChange: (ev) => setEntry(key, { text: ev.target.value }),
                }),
          )
        }),

        h('hr', { className: 'dmp-sep' }),

        // ④ 兜底
        h(
          'div',
          { className: 'dmp-field' },
          h('span', { className: 'dmp-label' }, t('fallback')),
          h('textarea', {
            value: typeof draft.default === 'string' ? draft.default : '',
            onChange: (e) => setField('default', e.target.value),
          }),
        ),

        // ⑤ 预览
        h('hr', { className: 'dmp-sep' }),
        h('span', { className: 'dmp-label' }, t('preview')),
        h('p', { className: 'dmp-sub' }, t('previewHint')),
        h('pre', { className: 'dmp-code' }, state.injectedText || '（空）'),

        // ⑥ 高级选项（默认收起，避免 v3 那种「选项堆砌」）
        h('hr', { className: 'dmp-sep' }),
        h(
          'button',
          { onClick: () => setShowAdvanced((v) => !v) },
          `${showAdvanced ? '▾' : '▸'} ${t('advanced')}`,
        ),
        showAdvanced &&
          h(
            'div',
            { className: 'dmp-card' },
            h('p', { className: 'dmp-sub' }, t('advancedHint')),
            h(
              'label',
              { className: 'dmp-row' },
              h('input', {
                type: 'checkbox',
                checked: draft.replaceContexts === true,
                onChange: (e) => setField('replaceContexts', e.target.checked),
              }),
              h('span', { className: 'dmp-label' }, t('replaceContexts')),
            ),
            h(
              'div',
              { className: 'dmp-row' },
              h(
                'div',
                { className: 'dmp-field' },
                h('span', { className: 'dmp-label' }, t('sectionName')),
                h('input', {
                  type: 'text',
                  value: draft.sectionName || '',
                  onChange: (e) => setField('sectionName', e.target.value),
                }),
              ),
              h(
                'div',
                { className: 'dmp-field', style: { flex: '0 0 120px' } },
                h('span', { className: 'dmp-label' }, t('order')),
                h('input', {
                  type: 'text',
                  value: String(draft.order ?? ''),
                  onChange: (e) => setField('order', Number(e.target.value) || 0),
                }),
              ),
            ),
          ),

        // ⑦ 保存
        h(
          'div',
          { className: 'dmp-row' },
          h(
            'button',
            { className: 'dmp-primary', disabled: busy, onClick: onSave },
            busy ? t('saving') : t('save'),
          ),
          msg && h('p', { className: msg.kind === 'ok' ? 'dmp-ok' : 'dmp-err' }, msg.text),
        ),

        // ⑧ 模型目录兜底轨：服务没给出目录时，允许手贴一份
        catalogSource !== 'service' &&
          h(
            'div',
            { className: 'dmp-card' },
            h('span', { className: 'dmp-label' }, `${t('catalogFrom')}: ${catalogLabel}`),
            h('textarea', {
              value: catalogDraft,
              placeholder: '{"providers":[{"id":"p","name":"P","models":[{"id":"a/b","name":"AB"}]}]}',
              onChange: (e) => setCatalogDraft(e.target.value),
            }),
            h(
              'button',
              { disabled: busy || !catalogDraft.trim(), onClick: onSaveCatalog },
              t('save'),
            ),
          ),
      )
    }

    /** 状态条（输入框下方）。只显示状态，不再挂浮层 —— 浮层形态已砍掉。 */
    function Dock({ t }) {
      const [state, setState] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const b = await getState()
            if (alive) setState(b.state)
          } catch {
            /* 读不到就不显示 */
          }
        }
        tick()
        const id = setInterval(tick, 5000)
        return () => {
          alive = false
          clearInterval(id)
        }
      }, [])
      if (!state) return null
      const cls = state.enabled === false ? 'dmp-off' : state.effectiveMode === 'replace' ? 'dmp-replace' : ''
      return h(
        'span',
        {
          'data-dmp-dock': '',
          className: cls,
          title: `${t('title')} — ${state.model || ''}`,
        },
        h('span', { className: 'dmp-dot' }),
        `${t('tab')}: ${state.matchedKey || t('noMatch')}`,
      )
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-model-persona: dictionaries')
        ctx.effect(() => installStyles(), 'dsh-model-persona: stylesheet')

        const t = ctx.locale.bind(NS)
        const slots = ctx.slots

        // ① 设置页 Tab（官方设置页的一级 Tab，与 budget / dsh-market 同级）
        slots.inject('settings.plugins.tab', () =>
          slots.register(
            {
              name: 'settings.plugins.tab',
              id: 'model-persona',
              order: 45,
              label: () => t('tab'),
              locale: NS,
            },
            (props) => h(Panel, { t, compact: false, ...props }),
          ),
        )

        // ② 输入框状态条
        slots.inject('conversation.composer.dock', () =>
          slots.register(
            { name: 'conversation.composer.dock', id: 'model-persona-dock', order: 30 },
            () => h(Dock, { t }),
          ),
        )
      },
    }
  },
})
