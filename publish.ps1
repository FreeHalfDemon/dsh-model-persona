# 一键发布脚本（PowerShell）
#
# 用法：
#   powershell -File publish.ps1 -Repo "owner/dsh-model-persona" [-DryRun]
#
# 做的事（按顺序）：
#   1. 自检：测试全绿、manifest 齐全、无本机绝对路径、无隐私
#   2. git init / add / commit（若尚未初始化）
#   3. 提示你手动 push + 加 topic（这两步要 GitHub 交互，脚本不碰）
#   4. 生成 marketplace-entry.yml（填好 owner/repo）
#
# ⚠️ 本脚本【不】自动 push、不自动建仓库 —— 那需要 GitHub 凭据与人工确认。
# ⚠️ 仓库创建满 1 天才能提 PR（CI 硬检查）。脚本会在最后提醒。

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Repo,                 # 形如 owner/dsh-model-persona

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# 相对脚本自身定位，不硬编码绝对路径（搬目录不断链）
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Bad($m)  { Write-Host "  [FAIL] $m" -ForegroundColor Red; $script:Failed = $true }
function Info($m) { Write-Host "  [..] $m" -ForegroundColor Cyan }
$script:Failed = $false

Write-Host "`n=== 1/4 自检 ===" -ForegroundColor Cyan

# 1.1 测试全绿
# ⚠️⚠️ 本机（DSH 0.2.0 沙箱）实测：**捕获/管道原生命令输出一律失败** ——
#   `$x = & node ...`、`& node ... 2>&1`、`& node ... > 文件 2>&1` 全都报
#   `StandardOutputEncoding is only supported when standard output is redirected`；
#   给 `cmd /c` 接 `| Out-Null` 也会让 cmd.exe 直接 `拒绝访问`。
#   **根因是 PowerShell 对原生命令输出流的捕获/编码协商，不是 node 起不来。**
#   唯一可用姿势：`cmd /c "命令 > 文件 2>&1"` **裸调用**（不赋值、不管道）再读文件。
#   （详见 knowledge/notes/DSH沙箱下的脚本执行.md）
Info "跑回归测试（node test.mjs）..."
$testLog = Join-Path $env:TEMP ("mp_test_" + [guid]::NewGuid().ToString('N') + ".log")
cmd /c "node test.mjs > `"$testLog`" 2>&1"
$testExit = $LASTEXITCODE
$testTail = if (Test-Path $testLog) { Get-Content $testLog -Tail 8 } else { @() }
Remove-Item $testLog -Force -ErrorAction SilentlyContinue
if ($testExit -eq 0 -and ($testTail -match 'fail 0')) {
  $count = ($testTail | Select-String 'tests \d+' | ForEach-Object { $_.Matches[0].Value })
  Ok "测试全绿（$count）"
} else {
  Bad "测试未全绿（exit=$testExit）—— 先修再发"
  $testTail
}

# 1.2 manifest 齐全
$pkg = Get-Content 'package.json' -Raw | ConvertFrom-Json
if ($pkg.dsh -and $pkg.dsh.bundle -and $pkg.dsh.bundle.patch) { Ok "package.json 声明 dsh.bundle.patch" }
else { Bad "package.json 缺 dsh.bundle manifest —— 这是最常见的被拒原因" }
if (Test-Path 'cordis.patch.yml') { Ok "cordis.patch.yml 存在" } else { Bad "缺 cordis.patch.yml" }

# 1.3 无本机绝对路径 / 无隐私
$leaks = Get-ChildItem -Recurse -File -Include *.js,*.json,*.md,*.yml | ForEach-Object {
  # 通用模式：盘符绝对路径、家目录路径、各类 token 形态、以及指代个人的字样
  $m = Select-String -Path $_.FullName -Pattern '([A-Za-z]:\\\\[A-Za-z0-9_.-]+\\\\|/home/[a-z]|/Users/[a-z]|ghp_|github_pat_|sk-[A-Za-z0-9]{20,}|-----BEGIN|\b1[3-9]\d{9}\b)' -ErrorAction SilentlyContinue
  if ($m) { "$($_.Name): $($m.Line -join ' || ')" }
}
if ($leaks) { Bad "发现本机路径/隐私痕迹："; $leaks } else { Ok "无本机绝对路径、无隐私痕迹" }

# 1.4 无 node_modules
if (Test-Path 'node_modules') { Bad "存在 node_modules/ —— .gitignore 应挡住，检查一下" }
else { Ok "无 node_modules" }

if ($script:Failed) {
  Write-Host "`n自检未过，中止。修完再跑。`n" -ForegroundColor Red
  exit 1
}

Write-Host "`n=== 2/4 生成市场条目 ===" -ForegroundColor Cyan
$owner, $name = $Repo -split '/', 2
$entry = @"
name: $Repo
url: https://github.com/$Repo
category: identity
description:
  en: 'Per-model system prompt for DSH: the injected persona follows the current model, either appended or fully replacing the prompt except tools. Config edits take effect on the next step without a restart.'
  zh: '按当前模型切换 DSH 系统提示词：人格跟随当前模型，可追加，也可除工具外整体替换。改配置下一步生效，免重启。'
"@
if ($DryRun) {
  Info "dry-run，将写入 marketplace-entry.yml："
  Write-Host $entry
} else {
  [System.IO.File]::WriteAllText((Join-Path $Root 'marketplace-entry.yml'), $entry, (New-Object System.Text.UTF8Encoding($false)))
  Ok "已写 marketplace-entry.yml"
}

Write-Host "`n=== 3/4 git 提交 ===" -ForegroundColor Cyan
if (-not (Test-Path '.git')) {
  Info "尚未初始化 git，执行 init..."
  if ($DryRun) { Info "dry-run：git init" } else { git init | Out-Null; Ok "git init 完成" }
}
if ($DryRun) {
  Info "dry-run：git add -A ; git commit -m 'dsh-model-persona v1.0.0'"
} else {
  git add -A
  $msg = "dsh-model-persona v1.0.0：按当前模型切换人格/系统提示词"
  $msgFile = Join-Path $env:TEMP ("mp_msg_" + [guid]::NewGuid().ToString('N') + ".txt")
  [System.IO.File]::WriteAllText($msgFile, $msg, (New-Object System.Text.UTF8Encoding($false)))
  git commit -F $msgFile | Out-Null
  Remove-Item $msgFile -Force -ErrorAction SilentlyContinue
  Ok "已提交"
}

Write-Host "`n=== 4/4 剩下的手动步骤 ===" -ForegroundColor Cyan
Write-Host @"

  自检全绿，本地已提交。接下来【手动】做：

  1) 在 GitHub 建空仓库：$Repo
     （不要勾选 README/.gitignore/license，避免冲突）

  2) push：
     git remote add origin https://github.com/$Repo.git
     git branch -M main
     git push -u origin main

  3) 仓库页 → Settings → Topics → 加 `dsh-plugin`

  4) ★ 等仓库创建满 1 天（CI 硬检查，差几小时会被拒）

  5) PR 到 awesome-dsh-plugin：
     把 marketplace-entry.yml 复制成 data/plugins/${owner}__${name}.yml
     （⚠️ 不要手工改它的 README，那两个由脚本生成）

  6) 其它市场（dshmarket / dsh-plugin.org / dsh.so）多为自动扫 GitHub topic，
     加了 topic + 仓库公开，通常自动收录，不用逐个提交。

"@ -ForegroundColor Yellow
Write-Host ""
