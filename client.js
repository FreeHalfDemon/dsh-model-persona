/**
 * dsh-model-persona —— 浏览器半区（v3）
 *
 * 手写 `window.__ModuleLoader__.load({ id, factory(require) })` 懒加载 CJS 工厂 ——
 * 官方模板与 dsh-budget 的真实实现都是这个形状，**不需要任何构建工具**。
 * React 从浏览器模块表 `require('react')` 取，**不安装第二份 React**。
 *
 * 提供三种形态（可在面板里切换，偏好存本地）：
 *   ① 设置页 Tab   → settings.plugins.tab
 *   ② 输入框状态条 → conversation.composer.dock
 *   ③ 浮层面板     → shell.overlay
 *
 * 数据通道：fetch 本插件自己的三个路由（/model-persona/*）。
 * 形态偏好存 localStorage（客户端本地，不上报任何东西）。
 *
 * 样式只用官方主题 token（--dsw-alias-*），不引入自带配色。
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-persona',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'model-persona'
    const API = '/model-persona'
    const PREF_KEY = 'dsh-model-persona:shape'

    // ── 本地化字典 ──────────────────────────────────────────
    const zh = {
      tab: '按模型换人格',
      title: '按模型换人格',
      subtitle: '当前模型变了，注入的系统提示词跟着变。改完保存，下一步生效，不用重启。',
      currentModel: '当前真实模型 id',
      matched: '命中的映射键',
      noMatch: '未命中任何按模型键',
      shape: '面板形态',
      shapeTab: '设置页 Tab',
      shapeDock: '输入框状态条',
      shapeOverlay: '浮层面板',
      mode: '模式',
      modeAppend: '追加（安全）',
      modeReplace: '整体替换（除工具外全换）',
      replaceWarn:
        '⚠️ 整体替换会丢掉 harness 自带的工具使用指导，模型可能变得不太会用工具。除非你确定要全换，否则用「追加」。',
      enabled: '启用',
      mappings: '按模型映射',
      key: '模型 id 关键词',
      text: '人格文本',
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
      realIdHint:
        '写关键词要用宿主真实模型 id，不是界面显示名 —— 照显示名写永远命中不了，且不报错。',
      useCurrent: '用当前模型',
      loadFail: '读不到插件状态',
    }
    const en = {
      tab: 'Per-model persona',
      title: 'Per-model persona',
      subtitle:
        'The injected system prompt follows the current model. Save, then it applies on the next step without a restart.',
      currentModel: 'Current real model id',
      matched: 'Matched key',
      noMatch: 'No per-model key matched',
      shape: 'Panel shape',
      shapeTab: 'Settings tab',
      shapeDock: 'Composer dock',
      shapeOverlay: 'Overlay',
      mode: 'Mode',
      modeAppend: 'Append (safe)',
      modeReplace: 'Full replace (everything but tools)',
      replaceWarn:
        '⚠️ Full replace drops the harness tool-usage guidance, so the model may use tools less well. Use Append unless you really want a full swap.',
      enabled: 'Enabled',
      mappings: 'Per-model mappings',
      key: 'Model id keyword',
      text: 'Persona text',
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
      realIdHint:
        'Use the host real model id as the keyword, not the display name — a display name never matches, and it fails silently.',
      useCurrent: 'Use current model',
      loadFail: 'Cannot read plugin state',
    }

    // ── 样式（只用官方 token）────────────────────────────────
    const CSS = `
[data-dmp] { display: flex; flex-direction: column; gap: 12px; min-width: 0; color: var(--dsw-alias-label-primary); }
[data-dmp] .dmp-head { display: flex; flex-direction: column; gap: 4px; }
[data-dmp] .dmp-h { margin: 0; font-size: 1.05em; font-weight: 600; }
[data-dmp] .dmp-sub { margin: 0; color: var(--dsw-alias-label-secondary); font-size: .92em; line-height: 1.5; }
[data-dmp] .dmp-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
[data-dmp] .dmp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
[data-dmp] .dmp-label { font-size: .86em; color: var(--dsw-alias-label-secondary); }
[data-dmp] .dmp-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-layer-1); }
[data-dmp] .dmp-card-head { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
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
[data-dmp] button:disabled { opacity: .5; cursor: default; }
[data-dmp] .dmp-warn { color: var(--dsw-alias-state-warn-primary); font-size: .9em; line-height: 1.5; margin: 0; }
[data-dmp] .dmp-err { color: var(--dsw-alias-state-error-primary); font-size: .9em; margin: 0; }
[data-dmp] .dmp-ok { color: var(--dsw-alias-state-success-primary); font-size: .9em; margin: 0; }
[data-dmp] .dmp-code { font-family: ui-monospace, Consolas, monospace; font-size: .88em; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 8px; white-space: pre-wrap; word-break: break-word; margin: 0; max-height: 220px; overflow: auto; }
[data-dmp] .dmp-id { font-family: ui-monospace, Consolas, monospace; font-size: .9em; }
[data-dmp] .dmp-sep { border: 0; border-top: 1px solid var(--dsw-alias-border-l1); margin: 2px 0; }
[data-dmp] .dmp-chip { font-size: .85em; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
/* 状态条（composer dock）*/
[data-dmp-dock] { display: inline-flex; align-items: center; gap: 6px; font-size: .82em; color: var(--dsw-alias-label-secondary); cursor: pointer; user-select: none; }
[data-dmp-dock] .dmp-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: none; }
[data-dmp-dock].dmp-off .dmp-dot { background: var(--dsw-alias-state-idle-primary); }
[data-dmp-dock].dmp-replace .dmp-dot { background: var(--dsw-alias-state-warn-primary); }
/* 浮层 */
[data-dmp-overlay] { position: fixed; right: 16px; bottom: 16px; width: min(520px, calc(100vw - 32px)); max-height: min(72vh, 640px); overflow: auto; pointer-events: auto; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.28); padding: 14px; z-index: 40; }
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
      return j.state
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

    // ── 形态偏好（纯本地）────────────────────────────────────
    const SHAPES = ['tab', 'dock', 'overlay']
    function readShape() {
      try {
        const v = localStorage.getItem(PREF_KEY)
        return SHAPES.includes(v) ? v : 'tab'
      } catch {
        return 'tab'
      }
    }
    function writeShape(v) {
      try {
        localStorage.setItem(PREF_KEY, v)
      } catch {
        /* 存不了就退回默认 */
      }
    }

    // ── 主面板组件 ──────────────────────────────────────────
    function Panel({ t, compact }) {
      const [state, setState] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [shape, setShape] = React.useState(readShape())
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        try {
          const s = await getState()
          setState(s)
          setDraft(s)
          setMsg(null)
        } catch (e) {
          setMsg({ kind: 'err', text: `${t('loadFail')}: ${e.message}` })
        }
      }, [t])

      React.useEffect(() => {
        load()
      }, [load])

      if (!state || !draft) {
        return h('div', { 'data-dmp': '' }, h('p', { className: 'dmp-sub' }, '…'))
      }

      const rows = Object.entries(draft.byModel || {})
      const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
      const setEntry = (key, patch) =>
        setDraft((d) => {
          const cur = d.byModel[key]
          const obj = typeof cur === 'string' ? { text: cur } : { ...(cur || {}) }
          return { ...d, byModel: { ...d.byModel, [key]: { ...obj, ...patch } } }
        })
      const renameKey = (oldKey, newKey) =>
        setDraft((d) => {
          if (oldKey === newKey) return d
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
          let base = d.model || 'new-model'
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

      const entryText = (v) => (typeof v === 'string' ? v : (v && v.text) || '')
      const entryMode = (v) => (v && typeof v === 'object' && v.mode) || draft.mode

      return h(
        'div',
        { 'data-dmp': '' },
        h(
          'div',
          { className: 'dmp-head' },
          h('h3', { className: 'dmp-h' }, t('title')),
          !compact && h('p', { className: 'dmp-sub' }, t('subtitle')),
        ),

        // 当前模型 + 命中情况
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
              state.matchedKey ? `${t('matched')}: ${state.matchedKey}` : t('noMatch'),
            ),
            h('span', { className: 'dmp-chip' }, `${t('mode')}: ${state.effectiveMode}`),
          ),
          h('p', { className: 'dmp-sub' }, t('realIdHint')),
        ),

        // 形态切换
        h(
          'div',
          { className: 'dmp-field' },
          h('span', { className: 'dmp-label' }, t('shape')),
          h(
            'div',
            { className: 'dmp-row' },
            ...[
              ['tab', t('shapeTab')],
              ['dock', t('shapeDock')],
              ['overlay', t('shapeOverlay')],
            ].map(([v, label]) =>
              h(
                'button',
                {
                  key: v,
                  className: shape === v ? 'dmp-primary' : '',
                  onClick: () => {
                    setShape(v)
                    writeShape(v)
                  },
                },
                label,
              ),
            ),
          ),
        ),

        h('hr', { className: 'dmp-sep' }),

        // 开关 + 模式
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
            { className: 'dmp-field', style: { flex: '1 1 220px' } },
            h('span', { className: 'dmp-label' }, t('mode')),
            h(
              'select',
              { value: draft.mode, onChange: (e) => setField('mode', e.target.value) },
              h('option', { value: 'append' }, t('modeAppend')),
              h('option', { value: 'replace' }, t('modeReplace')),
            ),
          ),
        ),
        draft.mode === 'replace' && h('p', { className: 'dmp-warn' }, t('replaceWarn')),

        h('hr', { className: 'dmp-sep' }),

        // 映射列表
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
        ...rows.map(([key, val]) =>
          h(
            'div',
            { className: 'dmp-card', key },
            h(
              'div',
              { className: 'dmp-card-head' },
              h('input', {
                type: 'text',
                value: key,
                'aria-label': t('key'),
                onChange: (e) => renameKey(key, e.target.value),
              }),
              h(
                'div',
                { className: 'dmp-row' },
                state.model &&
                  h(
                    'button',
                    {
                      title: t('useCurrent'),
                      onClick: () => renameKey(key, state.model),
                    },
                    t('useCurrent'),
                  ),
                h('button', { onClick: () => removeKey(key) }, t('remove')),
              ),
            ),
            h('textarea', {
              value: entryText(val),
              'aria-label': t('text'),
              placeholder: t('text'),
              onChange: (e) => setEntry(key, { text: e.target.value }),
            }),
            h(
              'div',
              { className: 'dmp-row' },
              h('span', { className: 'dmp-chip' }, `${t('mode')}: ${entryMode(val)}`),
            ),
          ),
        ),

        h('hr', { className: 'dmp-sep' }),

        // 兜底
        h(
          'div',
          { className: 'dmp-field' },
          h('span', { className: 'dmp-label' }, t('fallback')),
          h('textarea', {
            value: typeof draft.default === 'string' ? draft.default : '',
            onChange: (e) => setField('default', e.target.value),
          }),
        ),

        // 预览
        h('hr', { className: 'dmp-sep' }),
        h('span', { className: 'dmp-label' }, t('preview')),
        h('p', { className: 'dmp-sub' }, t('previewHint')),
        h('pre', { className: 'dmp-code' }, state.injectedText || '（空）'),

        // 保存
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
      )
    }

    /** 状态条（输入框下方）*/
    function Dock({ t }) {
      const [state, setState] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const s = await getState()
            if (alive) setState(s)
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
        React.Fragment,
        null,
        h(
          'span',
          {
            'data-dmp-dock': '',
            className: cls,
            title: `${t('title')} — ${state.model || ''}`,
            onClick: () => setOpen((v) => !v),
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') setOpen((v) => !v)
            },
          },
          h('span', { className: 'dmp-dot' }),
          `${t('tab')}: ${state.matchedKey || t('noMatch')}`,
        ),
        open &&
          h(
            'div',
            { 'data-dmp-overlay': '' },
            h(Panel, { t, compact: true }),
          ),
      )
    }

    /** 浮层形态 */
    function Overlay({ t }) {
      const [open, setOpen] = React.useState(false)
      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            'data-dmp-dock': '',
            style: { pointerEvents: 'auto' },
            onClick: () => setOpen((v) => !v),
          },
          `⚙ ${t('tab')}`,
        ),
        open &&
          h(
            'div',
            { 'data-dmp-overlay': '' },
            h(Panel, { t, compact: false }),
          ),
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

        // ③ 浮层面板
        slots.inject('shell.overlay', () =>
          slots.register({ name: 'shell.overlay', id: 'model-persona-overlay', order: 900 }, () =>
            h(Overlay, { t }),
          ),
        )
      },
    }
  },
})
