/**
 * dsh-model-persona —— 按当前模型切换系统提示词/人格
 *
 * 两种模式（config.json 的 mode 或单条条目的 mode）：
 *   · append  —— 往系统提示词里**追加**一段人格（安全，v1 行为）
 *   · replace —— 把整个系统提示词**换掉**（默认保留工具 schema；运行上下文默认也保留）
 *
 * 机制（已核官方契约，见 docs/01-调研报告.md）：
 *   · append 用 `ctx.systemPrompt.section()` 注册一个段，段文本**每步求值**，
 *     此时 context.agent.options.model 就是宿主真实模型 id；
 *   · replace 用 `system-prompt/assemble` waterfall —— 它拿到完整 assembly
 *     `{ sections, contexts, tools, variables }` 且**返回值权威**，
 *     所以可以只替换 sections（提示词正文），把 tools 原样留下。
 *
 * ⚠️ 为什么不用官方的 `complete: true`：
 *   它是**注册期静态开关**，一挂上就接管**所有**模型，做不到「只有写了覆盖的模型才换」。
 *   而且它发生在 waterfall **之后**（官方源码：`completeSection === undefined ? transformed.sections : [completeSection]`），
 *   会覆盖掉 waterfall 的结果。所以 replace 必须走 waterfall。
 *
 * 失败语义（底线）：任何异常都降级为「不改变 assembly」/空文本。
 * 最坏结果是「没有人设」，**绝不让 DSH 起不来、绝不让会话发不出消息**。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  configPaths,
  stateDir,
  createConfigReader,
  createModelRecorder,
  createAssemblyDumper,
  renderPersona,
  resolveEntry,
  applyReplace,
  DEFAULT_CONFIG,
} from './core.js'
import { registerPanelRoutes } from './panel-host.js'

export const name = 'dsh-model-persona'

/** 依赖 dsh-system-prompt 提供的 systemPrompt 服务 */
export const inject = ['systemPrompt']

const LOG = '[model-persona]'

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))

const warn = (msg) => {
  try {
    console.warn(msg)
  } catch {
    /* 连日志都打不了就算了 */
  }
}

/** 从 assembly 上下文里取真实模型 id */
function modelOf(context) {
  try {
    return context?.agent?.options?.model
  } catch {
    return undefined
  }
}

export function apply(ctx) {
  const readConfig = createConfigReader(configPaths(PLUGIN_DIR), { warn })
  const recordModel = createModelRecorder(stateDir(PLUGIN_DIR))
  const dumpAssembly = createAssemblyDumper(stateDir(PLUGIN_DIR))

  const safeRead = () => {
    try {
      return readConfig()
    } catch {
      return DEFAULT_CONFIG
    }
  }

  const boot = safeRead()

  /**
   * ① append 模式：注册一个段。
   * 注册失败（同层重名）只 warn，不让整棵插件树起不来。
   */
  try {
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: boot.sectionName || DEFAULT_CONFIG.sectionName,
          order: Number.isFinite(boot.order) ? boot.order : DEFAULT_CONFIG.order,
          // ★ interpolate:false —— 用户正文里的 {{...}} 必须原样保留。
          // 默认 true 时，一个未知变量就会让提示词组装失败 → 会话发不出消息。
          interpolate: false,
          text: (context) => {
            try {
              const model = modelOf(context)
              recordModel(model)
              const cfg = safeRead()
              const entry = resolveEntry(cfg, model)
              // replace 模式不靠段注入（由 waterfall 整体替换），此处返回空
              if (entry.mode === 'replace') return ''
              return renderPersona(cfg, model)
            } catch (e) {
              warn(`${LOG} 渲染失败（本步不注入人设）：${(e && e.message) || e}`)
              return ''
            }
          },
        }),
      'dsh-model-persona.section()',
    )
  } catch (e) {
    warn(
      `${LOG} 段注册失败（DSH 照常运行，append 模式不生效）：${(e && e.message) || e}` +
        `\n  · 段名「${boot.sectionName}」可能已被同层其它插件占用；改 config.json 的 sectionName 可避开。`,
    )
  }

  /**
   * ② replace 模式：在 system-prompt/assemble waterfall 里整体替换 sections。
   *
   * 只动 sections；tools 永远原样保留（replace 语义：除工具外全部替换）。
   * contexts（运行上下文：cwd / 沙箱策略 / 审批策略）默认**也保留** —— 见 README「为什么默认保留运行上下文」。
   * 想连它一起换：config.json 设 replaceContexts: true。
   *
   * 铁律：**不接管时必须原样 return next()**（官方 practices.md 要求）。
   */
  try {
    ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      try {
        const cfg = safeRead()
        const model = modelOf(context)
        if (cfg.debug) dumpAssembly(assembly, model)

        const entry = resolveEntry(cfg, model)
        // 不是 replace，或没写内容 → 完全不介入，交还原链路
        if (cfg.enabled === false || entry.mode !== 'replace' || !entry.text) {
          return await next()
        }

        const result = await next()
        const replaced = applyReplace(result, entry, {
          sectionName: cfg.sectionName || DEFAULT_CONFIG.sectionName,
          replaceContexts: cfg.replaceContexts === true,
        })
        // 变换不成立（形状不对等）→ 保持原样
        return replaced || result
      } catch (e) {
        warn(`${LOG} assemble 介入失败（本步保持原提示词）：${(e && e.message) || e}`)
        return await next()
      }
    })
  } catch (e) {
    warn(`${LOG} system-prompt/assemble 监听注册失败（replace 模式不生效）：${(e && e.message) || e}`)
  }

  /**
   * ③ 网页面板的数据通道（v3）。
   *
   * 用**可选注入** `ctx.inject(['webServer'], ...)` 而不是硬 `inject`：
   * headless / 无 webServer 的 profile 里，插件本体照常工作，只是面板不出现。
   * 路由由 panel-host.js 注册，走官方 `ctx.webServer.register`（基于 node:http，零依赖）。
   */
  try {
    ctx.inject(['webServer'], (scope) => {
      try {
        const dispose = registerPanelRoutes(scope, {
          configPath: configPaths(PLUGIN_DIR)[0],
          lastModelPath: path.join(stateDir(PLUGIN_DIR), 'last-model.json'),
          readConfig: safeRead,
          warn,
        })
        scope.effect(() => dispose, 'dsh-model-persona.panel-routes()')
      } catch (e) {
        warn(`${LOG} 面板路由注册失败（面板不可用，插件本体不受影响）：${(e && e.message) || e}`)
      }
    })
  } catch (e) {
    warn(`${LOG} 注入 webServer 失败（面板不可用）：${(e && e.message) || e}`)
  }

  warn(
    `${LOG} 已加载：段「${boot.sectionName || DEFAULT_CONFIG.sectionName}」，` +
      `默认模式 ${boot.mode}，按模型映射 ${Object.keys(boot.byModel || {}).length} 条，` +
      `配置 ${configPaths(PLUGIN_DIR)[0] || '(默认)'}`,
  )
}
