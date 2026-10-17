# dsh-model-persona

**当前模型变了，注入的系统提示词跟着变。** 一个模型一套人格：写完保存，**下一步生效、免重启**。

- **按模型分流** —— 不是手动切预设，是宿主真实模型 id 一变，注入内容自动跟着变
- **两种模式** —— 追加（安全）或整段替换（除工具外全换）
- **网页设置面板** —— 模型下拉框、提示词库、真实装配预览，不用碰 JSON
- **零运行时依赖** —— 纯 ESM，不装第三方包
- **提示词可复用** —— 库里的条目被多个模型引用，改一处全生效

---

## 工作原理

`dsh-model-persona` 复用 DSH 的能力接缝，不重新发明：

| DSH 能力 | 插件用法 |
|---|---|
| `ctx.systemPrompt.section()` | `append` 模式：注册一个人格段，段文本**每步求值** |
| `system-prompt/assemble` waterfall | `replace` 模式：整体替换 sections，返回值权威 |
| `ctx.sessionController.modelCatalog()` | 取运行时模型目录（`id` + 人话 `name`），喂模型下拉框 |
| `ctx.webServer.register()` | 提供 6 条面板数据路由 `/model-persona/*` |
| `ctx.web.fetch()` | 「从网址导入」提示词（可选服务，没有则提示手贴） |
| 文件系统 | 配置与提示词库落在 `$DSH_HOME/model-persona/` |

**数据流**：模型 id（每步求值）→ 匹配 `byModel` → 渲染人格文本 → 注入系统提示词。

**匹配优先级**：精确键（忽略大小写）→ 最长子串 → 退回 `default`。

> 为什么不用官方的 `complete: true`：它是**注册期静态开关**，一挂上就接管所有模型，
> 做不到「只对写了覆盖的模型生效」；且官方源码里它发生在 waterfall **之后**，
> 会覆盖掉 waterfall 的结果，两者不能叠加。

## Web UI

两个形态（v4 已砍掉浮层面板和三形态切换器）：

| 位置 | 内容 |
|---|---|
| 设置 → 插件 → 「按模型换人格」 | 完整编辑：模型下拉框、模式、映射列表、提示词库、真实装配预览、高级项 |
| 输入框下方状态条 | 只看状态（当前命中哪条映射），三种颜色区分 关闭 / 追加 / 替换 |

面板数据链路：浏览器 `fetch` → `/model-persona/*` 六条路由 → Host 内存/磁盘。样式只用官方主题 token（`--dsw-alias-*`），不引入自带配色。

## 安装

```sh
# 用官方 plugin_manager（推荐，不要手写 cordis.patch.yml、不要跑 pnpm）
# 在 DSH 会话里调用工具：
plugin_manager({ action: "install_bundle", target: "/absolute/path/to/dsh-model-persona" })
```

安装后 `plugin_manager` 会把包名写进该 profile 的 `dependencies` 与 `dsh.profile.bundles`。

> **生效时机**：安装本身要重启 DSH 才加载（Node 模块缓存）。之后改 `config.json`
> 里的映射/文本**不用重启**，下一步就生效。只有改 `sectionName` / `order`
> 或增删挂载行才需要重启。

**卸载**：`plugin_manager({ action: "remove_bundle", target: "dsh-model-persona" })`
**临时关**：`set_plugin` 把该行置 `enabled: false`

## 配置

配置文件：`$DSH_HOME/model-persona/config.json`（首次运行自动生成）。

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；`false` = 完全不注入 |
| `mode` | `"append"` | `append`（追加）\| `replace`（除工具外全换） |
| `default` | `""` | 兜底条目；字符串或对象均可 |
| `byModel` | `{}` | 按模型映射；值是字符串、`{text}` 或 `{promptId}` |
| `order` | `1` | append 段的排序位置 |
| `sectionName` | `"model-persona:main"` | 段名（同层唯一，撞了就改这个） |
| `replaceContexts` | `false` | replace 模式下是否连运行上下文一起清 |
| `debug` | `false` | 把本次 assembly 的段名落盘到 `last-assembly.json` 供排查 |

**映射条目三种写法**（v4 新增后两种）：

```jsonc
{
  "mode": "replace",
  "byModel": {
    "some-model-id": "直接写一段文本",                    // ① 内联字符串
    "other-model-id": { "text": "内联一段" },             // ② 内联对象
    "third-model-id": { "promptId": "builtin-concise" }   // ③ 引用提示词库
  }
}
```

提示词库（`$DSH_HOME/model-persona/prompts.json`）与配置**分开存**：库是可复用素材，
映射是「哪个模型用哪条」。内置条目删不掉，误删会自动恢复。

## 使用

装好后打开 **设置 → 插件 → 「按模型换人格」**：

1. 面板顶部显示**当前真实模型 id**（这就是要匹配的值）
2. 「按模型映射」区点「新增一条」→ 从**模型下拉框**选模型（显示人话名，内部存真实 id）
3. 选提示词来源：内联一段文本，或引用提示词库里的条目
4. 「真实装配预览」会告诉你：一共几个段、本插件那段占多少字符、工具还在不在

> 下拉框里的模型来自 `ctx.sessionController.modelCatalog()`。如果你的部署没有这个服务，
> 面板会显示手贴目录的输入框，也可以直接手打模型 id。

## 验证

### 0. 已在真实实例上验证

本插件在 DSH 0.2.0-rc.2 / web profile 上实测：

- 六条路由全部注册成功（实测状态码）：
  `/model-persona/state` `200` · `/config` `200`（POST）· `/library` `200` ·
  `/preview` `200` · `/catalog` `400`（POST，空目录被拒）· `/fetch` `400`（POST，非法 URL 被拒）
- 段被真实调用：`$DSH_HOME/model-persona/last-model.json` 按会话持续刷新
- 真环境暴露并修掉两个问题：模型目录在加载期为空（改懒拉取）、
  模型 id 前缀随部署变化导致映射不命中

### 1. 离线验证（不启动任何服务）

```sh
cd /path/to/dsh-model-persona
node --check index.js core.js panel-host.js prompt-lib.js client.js
node test.mjs        # 157 条测试，应看到 "pass 157 / fail 0"
```

> `node test.mjs` 而不是 `node --test`：后者会 spawn 子进程，在受限沙箱里可能被拦。

### 2. 端到端验证（需要重启服务）

```sh
# 装好后重启 dsh，然后在面板里操作，或直接打接口：
curl http://127.0.0.1:3080/model-persona/state
# 应看到 ok:true、state.model 是真实模型 id、models 非空
```

**面板自查清单**：模型下拉框有内容吗 / 选中后映射键写对了吗 / 预览里的文本和预期一致吗 /
replace 模式下警示条在吗。

## 已知限制

| 现象 | 原因 | 缓解 |
|---|---|---|
| 写了关键词却没命中 | 界面显示名 ≠ 宿主真实 id；**同一个模型在不同部署下 id 前缀也会变** | 用面板下拉框选，别手打；或读 `last-model.json` 的 `model` 字段 |
| replace 模式下模型不太会用工具 | harness 的工具使用指导段被换掉，schema 还在 | 用 `append`；或 `keepSections: ["tool:*"]` 保留工具段 |
| 切模型会让 prefix cache 失效 | 系统提示词是请求第 0 字节，人格段变了前缀就变 | 无解，是「按模型换人格」的固有代价 |
| 改了 JS 不生效 | Node 模块缓存 | 重启 DSH。改配置不用重启 |
| 只覆盖安装的那个 profile | 插件挂在 profile 层 | 要对别的 profile 生效就再装一次 |
| `/fetch` 返回 503 | 该 profile 没有可用的 `ctx.web` 服务（**本机 web profile 实测就是 503**，尽管装了 4 个搜索插件） | 在面板里手动粘贴提示词；提示词库其余功能照常 |

## License

MIT