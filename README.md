# dsh-model-persona —— 按模型换人格

**当前模型变了，注入的系统提示词跟着变。** 改配置文件**下一步生效、免重启**。

两种模式：

| 模式 | 行为 |
|---|---|
| `append` | 往系统提示词里**追加**一段人格（安全，默认） |
| `replace` | 把整个系统提示词**换掉**，只保留工具（工具 schema + 工具使用指导） |

- 触发条件：**当前模型**（不是手动切预设、不是按工作区）
- 零运行时依赖，纯 ESM
- 带网页设置面板，不用碰 JSON

---

## ⚠️ 第一条：按模型写关键词，必须写「真实模型 id」

**界面上的显示名不是宿主传给插件的模型 id。** 二者不是同一套命名，照显示名写关键词
永远命中不了，而且不报错、不告警。

真实 id 有几种拿法：

1. **面板里直接看** —— 设置页会显示「当前真实模型 id」，一键填进键
2. **看落盘文件** —— 跑过一轮对话后，读 `$DSH_HOME/model-persona/last-model.json`
   ```json
   { "model": "<真实 id>", "at": "2026-01-01T00:00:00.000Z" }
   ```

> 真实 id **随部署 / provider 配置而变**，务必现读，别照抄任何文档里的例子。

## 配置

**两种改法**：网页设置面板（推荐）或直接改 JSON 文件。

### 网页面板

装好后在 DSH 网页里 **设置 → 插件 → 「按模型换人格」** 即可，不用碰 JSON。

面板里能：编辑按模型映射 · 看**当前真实模型 id**（一键填进键）· 切 append/replace ·
**实时预览**当前模型会注入什么。

### 直接改文件

```
$DSH_HOME/model-persona/config.json
```

### append 模式（安全，往提示词里加一段）

```jsonc
{
  "mode": "append",
  "default": "（所有模型通用的兜底人格）",
  "byModel": {
    "some-model-id": "你是简洁高效的工程助手：先给结论，再给依据。",
    "other-model-id": "你是严谨的资深工程师：先质疑需求，再给方案。"
  }
}
```

### replace 模式（除工具外全换）

```jsonc
{
  "mode": "replace",
  "byModel": {
    "some-model-id": {
      "text": "你运行在这个模型上。先给结论，再给依据，不铺垫。",
      "keepSections": []          // 想额外保留哪些原有段，见下
    },
    "other-model-id": { "text": "..." }
  }
}
```

`replace` 模式下**保留什么**：

| 保留 | 不保留 |
|---|---|
| ✅ `tools` schema（模型仍知道有哪些工具） | ❌ harness 身份段 |
| ✅ `tool:*` 段（文字版工具使用指导） | ❌ deployment persona |
| ✅ 运行上下文（`contexts`：cwd / 沙箱 / 审批）默认保留 | ❌ plan policy、文件引用等其余段 |

- `keepSections: ["plan:policy"]` 可**额外保留**指定段；`"前缀*"` 是通配
- `"replaceContexts": true` 可连运行上下文一起清（**不建议**，见下）

### 匹配规则

**精确键（忽略大小写）→ 最长子串 → 回退 `default`**

- 键 `claude` 会命中 `claude-opus-4.6`、`claude-sonnet-4.6`（子串匹配）
- 键同时有 `flash` 和 `deepseek-flash` 时，`deepseek-flash-high` 命中**更长的**
  `deepseek-flash`（不会错命中短键）
- 都没命中 → 用 `default`；`default` 也空 → **不注入**

### 改了怎么生效

改 `config.json` → **下一步立即生效**。只有改 `sectionName` / `order` 或增删挂载行才需重启 DSH。

## 完整配置键

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；`false` = 完全不注入 |
| `mode` | `"append"` | `append` \| `replace` |
| `default` | `""` | 兜底条目；字符串或对象均可 |
| `byModel` | `{}` | 按模型映射；值是字符串或 `{mode,text,keepSections}` |
| `order` | `1` | append 段的排序位置 |
| `sectionName` | `"model-persona:main"` | 段名（同层唯一，撞了改这个） |
| `replaceContexts` | `false` | replace 模式下是否清运行上下文 |
| `debug` | `false` | 把本次 assembly 的段名落盘到 `last-assembly.json` 供排查 |

单条条目可覆盖全局 `mode`：

```jsonc
{ "mode": "replace", "byModel": { "special": { "mode": "append", "text": "这条只追加" } } }
```

## ⚠️ replace 模式的两个已知代价

1. **模型可能不会用工具了** —— harness 的工具使用指导段被替换掉了，工具 schema 还在，
   但「什么时候该用、怎么用」的指导没了。工具少的模型影响明显。
2. **切模型会让 prefix cache 失效** —— 系统提示词是请求第 0 字节，人格段变了前缀就变，
   上游缓存重算。这是「按模型换人格」的固有代价，非 bug。

⇒ 建议：**先只用 append 模式**，确认需要全换再对特定模型开 replace。

## 安装 / 卸载

用官方的 `plugin_manager` 工具（**不要手写 `cordis.patch.yml`、不要跑 pnpm**）：

```
plugin_manager({ action: "install_bundle", target: "<本仓库绝对路径>" })
```

- **临时关**：`set_plugin` 把 `model-persona-main` 置 `enabled: false`
- **卸载**：`remove_bundle` 移除 `dsh-model-persona`
- **改了 JS 要生效**：需重启 DSH（Node 模块缓存，官方说明如此）。改配置不用重启。

## 覆盖范围

挂在 profile 层，用自有段名 `model-persona:main`。

- ✅ 该 profile 的所有会话（含子代理）
- ❌ 其它 profile / headless 一次性任务（要覆盖就对该 profile 再装一次）

## 目录

```
├─ index.js        宿主入口（注册段 + assemble waterfall + 面板路由接线）
├─ core.js         纯逻辑（匹配/渲染/配置读取/replace 变换/校验/原子写），可独立测试
├─ prompt-lib.js   提示词库 + 模型目录解析（纯逻辑）
├─ panel-host.js   面板的 Host 数据通道（webServer 路由，零依赖）
├─ client.js       浏览器半区（面板 UI，手写懒加载工厂，零构建）
├─ test.mjs        回归测试
├─ config.json     默认配置（出厂 = 不注入，零行为改变）
├─ cordis.patch.yml 插入插件行
├─ package.json    bundle 清单（含 dsh.client 段）
└─ publish.ps1     一键发布自检脚本
```

## 开发

```powershell
cd <本仓库目录>
node --check index.js
node --check core.js
node --check panel-host.js
node --check client.js
node test.mjs
```
