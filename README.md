# DeepSeek Harness Desktop

<p align="center">
  <strong>A minimal native desktop shell for the <a href="https://www.npmjs.com/package/@deepseek-ai/dsh">DeepSeek Harness</a> web GUI on macOS.</strong>
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20(arm64)-blue">
  <a href="https://github.com/jerrytoge/dsh-desktop/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/jerrytoge/dsh-desktop/build.yml?branch=main"></a>
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh"><img alt="dsh" src="https://img.shields.io/npm/v/@deepseek-ai/dsh"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
</p>

给 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) 套上一个轻量
Electron 壳，用原生 macOS 桌面应用的方式使用它。Harness 本体不做任何改动 —— 它以
sidecar Node 进程的形式运行，本 shell 只负责承载它的 Web UI。

## 特性

- 原生桌面窗口承载 DSH 的 Web UI
- sidecar 架构，无需 `electron-rebuild`
- 内置 Node runtime，用户机器无需安装 Node
- 单实例锁 + 优雅退出，不留孤儿进程
- 启动时自动检查 harness 新版本
- GitHub Actions 自动打包 `.dmg` 并发布 Release
- 完整保留 DSH 原有插件生态，兼容 web profile 插件

## 保持 DSH 插件生态

桌面应用只是 Electron 外壳：它启动一个 `dsh web` sidecar 进程来承载 Web UI。
`dsh web` 等价于 `dsh --profile web`，因此与命令行共用
`$DSH_HOME/profiles/web`，插件安装、数据与配置完全一致，无需为桌面端单独
维护一套生态。

安装插件依旧用标准命令：

```sh
dsh plugin --profile web add dsh-plugin-subscriptions
```

声明了 `dsh.bundle` 的插件会进入 profile 组合层，重启桌面应用后加载。

```text
dsh plugin --profile web add <plugin>
        │
        ▼
$DSH_HOME/profiles/web（写入插件依赖）
        │
        ▼
声明 dsh.bundle → profile 组合层
        │
        ▼
重启桌面应用 → 插件加载
```

> 安装、移除、升级插件后请重启桌面应用；`cordis.patch.yml` 则遵循 DSH 热更新，
> 无需重启。

### Desktop 内置插件

除 DSH 官方的 `@deepseek-ai/dsh-base` 和 `@deepseek-ai/dsh-web-app` Bundle 外，
Desktop 还随 App 打包并默认加载以下桌面专属插件：

| 插件 | 作用 |
|---|---|
| `@local/dsh-client-ui-settings-desktop` | 在设置中增加“个人扩展”页面，用于管理个人安装的插件、重启 sidecar，以及安装或修复 Desktop 命令行入口。 |
| `@local/dsh-agent-communication-policy` | 向 agent system prompt 注入统一的沟通行为约定，使不同模型在任务进度、阻塞反馈和最终总结方面保持一致。 |

这些插件位于仓库的 `packages/` 目录，由 `desktop.cordis.patch.yml` 挂载，只服务于
Desktop，不会写入用户 profile 的直接依赖，也不会出现在“个人扩展”的可移除列表中。

沟通策略插件支持三档策略：`quiet`（仅保留必要反馈）、`milestones`（在关键节点
反馈，Desktop 默认值）和 `frequent`（每个操作前后均反馈）。可在 **Desktop 设置 →
沟通策略** 中切换；保存后 Desktop 会重启 sidecar 并应用到后续会话。选择结果持久化在
`$DSH_HOME/desktop/settings.json`。该策略只影响 agent 的过程沟通提示，不会修改
agent loop、模型适配器、UI 或会话事件。

### Desktop 个人扩展管理

Desktop 会额外挂载一个独立的“个人扩展”设置页，但不会修改或替换 DSH
官方的插件列表与插件配置入口。个人扩展页只读取
`$DSH_HOME/profiles/web/package.json` 中的直接依赖，因此官方内置 Bundle 和传递依赖
不会出现在可移除列表中。

它提供：

- 安装、更新和移除个人直接依赖；
- 检查 Registry、Git 与本地（link/file）来源的更新；
- 启用或停用个人插件（见下）；
- 显示有界的包管理操作日志；
- 变更后重启 sidecar；
- 安装或修复 `~/.local/bin/dsh` 命令入口。

### 启用 / 停用

个人插件卡片会按激活方式显示开关：

- **DSH Bundle**（声明 `dsh.bundle.patch`）：切换写入 `dsh.profile.bundles`；
- **普通 Cordis 插件**（依赖里声明了 `@deepseek-ai/cordis`，但没有 `dsh.bundle`）：
  切换写入 profile 的 `cordis.patch.yml`，生成/移除对应的 `insert` 条目，
  其 `name` 使用包名作为模块名。

两种方式都会在变更后要求重启 sidecar 生效。普通库（既不声明 bundle 也不声明
cordis 插件）不显示开关。官方内置 Bundle（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`）
不受个人开关影响。

Desktop 固定使用随 App 打包的 Node 与 pnpm，不要求用户另外安装这些工具。出于安全
考虑，图形界面的第一版只接受 npm Registry 包名/版本，不接受 `file:`、`link:` 或
本地路径；这些高级来源仍可通过官方 `dsh plugin` 命令管理。命令入口安装不会自动
修改 `.zprofile` 或其他 Shell 启动文件，也不会覆盖用户已有的同名命令。

## 安装

从 [Releases](../../releases) 下载 `.dmg`，把 `DeepSeek Harness.app` 拖进
`Applications` 即可。

> 当前使用 ad-hoc 签名，若 macOS 提示「已损坏」或「无法验证开发者」，执行：
>
> ```sh
> xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"
> ```

## 从源码构建

要求：macOS（arm64）、Node.js ≥ 22。

```sh
pnpm install
pnpm run fetch-node   # 首次构建前拉取内置 Node runtime
pnpm start            # 开发模式启动
pnpm run build        # 自动准备 Electron dist，并打包 .dmg
```

`pnpm` 默认可能阻止 Electron 的 dependency install script，因此仅有
`node_modules/electron` 并不意味着 `node_modules/electron/dist` 已存在。项目的
`prepare:build` 会在每次构建前检查该目录，并在缺失或版本不匹配时自动下载固定版本的
macOS arm64 Electron。可用 `ELECTRON_MIRROR` 指定镜像。

产物输出到 `dist/`。

## 配置

通过环境变量覆盖默认行为，常用项：

| 变量 | 作用 |
|---|---|
| `DSH_BIN` | 指定 `dsh` 入口 |
| `DSH_PORT` | 固定端口 |
| `DSH_HOME` | harness 数据目录（默认 `~/.dsh`） |
| `DSH_UPDATE_CHECK` | 设为 `0` 关闭版本检查与应用内更新 |
| `DSH_UPDATE_URL` | 覆盖兜底的 Releases 页面地址 |
| `DSH_REPO` | 覆盖检查更新所查询的仓库（默认 `jerrytoge/dsh-desktop`） |

## 自动更新

采用「自动提 PR → 验证成品 → 人工合并 → 发布完整 App」流程，不在已安装的
App 内执行 `pnpm update`，也不热替换 Harness。

### 应用内更新

App 启动后检查 GitHub Releases，发现新版本时提供三个选项：

| 选项 | 行为 |
|---|---|
| 下载并安装 | 在应用内下载 `.dmg`，校验 GitHub 公布的 sha256 摘要，然后打开磁盘映像 |
| 前往下载页 | 打开 Releases 页面（原行为，作为兜底保留） |
| 稍后 | 忽略本次提示 |

安装包保存在 `~/Library/Application Support/dsh-desktop/updates/`：下载前会复用已存在
且校验通过的安装包，完成后清理旧的 `.dmg` 与残留 `.part`；下载进度显示在 Dock 图标上。
**摘要不符、大小不符、或下载源不是 GitHub 域名时一律拒绝**，并把错误暴露给用户而不
是静默降级。中途退出 App 会中止下载，不留下半成品文件。

应用内更新**不自动安装**：macOS 自安装走 Squirrel.Mac，要求 Developer ID 签名，而本
项目当前是 ad-hoc 签名。因此最后一步仍由用户把 App 拖入「应用程序」完成。

### 自动 PR

[Renovate](https://github.com/renovatebot/renovate) 跟踪 DeepSeek 包，排除 alpha，
等待版本发布 **48 小时**后提出分组更新。自动合并已关闭。Renovate **只管理依赖范围**
（含本地插件 peer 依赖），由其 pnpm manager 一并更新锁文件。

DeepSeek 每次发布把新版本放在 npm 的 `next` 标签上，`latest` 标签可能滞后。
Renovate 的 `respectLatest`（默认 `true`）只在「当前版本本身已超过 `latest`」时才允许
升到高于 `latest` 的版本。因此**必须同时设置 `respectLatest: false`**：否则一旦某个包的
`latest` 标签没跟上（例如 `@deepseek-ai/dsh` 停在 `0.1.5-rc.1`，而 80 个子包的 `latest`
还很旧），就只有它被扣住、其余全部前进，产出混合版本的 PR 并卡死 CI。官方文档也建议
`ignoreUnstable: false` 与 `respectLatest: false` 配套使用。

Renovate 刻意不管理根 `version` 字段：依赖范围是唯一真源，根 `version` 仅作参考，
CI 打包时会用「Harness 版本 + run_number」覆盖它。一致性检查对根 `version` 落后只给
警告，不会让 PR 变红。

`package.json` 中的 `allowScripts` 也已删除：pnpm 11 从不读取该键，原先是需要手工
跟版本的死配置；原生构建许可由 `pnpm-workspace.yaml#allowBuilds` 按包名管理，无需
随版本更新。

若 Renovate 的 artifact 更新失败，不应合并只有 manifest 的 PR，可用下面的脚本修复。
仓库需要保持 Renovate GitHub App 启用。

### 人工升级 / 修复更新 PR

使用仓库固定的 pnpm 和可用的 Node：

```sh
pnpm run update:harness -- 0.1.5-rc.1
# 仅在明确决定提前试用时跳过 48 小时观察期：
pnpm run update:harness -- 0.1.5-rc.1 --bypass-release-age
pnpm run check:harness
pnpm test
```

脚本验证发布包，统一同步应用版本、Harness 直接依赖和本地插件 peer 依赖，然后运行
安装、更新锁文件并输出依赖变化。新功能包优先由 Harness 的传递依赖引入，不把所有
npm 上的新包盲目加为直接依赖。一致性检查以**依赖范围**为准，根 `version` 落后只会
输出警告，不会让 Renovate 的 PR 变红。若安装失败，改动保留供
诊断；修复后重跑，不应提交半完成的锁文件。提前试用时 pnpm 可能写入精确版本的
`minimumReleaseAgeExclude`，应一并 review，禁止用全局关闭保护代替。

### 合并门禁

CI 在修改发行构建号之前执行冻结锁文件安装、版本一致性检查和单元测试。随后构建
macOS `.app`，核对 DeepSeek 依赖未被裁剪，并执行隔离成品冒烟测试：

```sh
pnpm run fetch-node
pnpm run build:dir
pnpm run smoke:packaged
```

冒烟测试使用临时数据目录，不使用个人 profile；运行打包成品而不是另起开发服务器。
成品启动失败会阻止构建任务通过及后续发布。请在 GitHub 分支保护中将此 workflow 的
`build` 检查设为必需检查，并要求 PR review（这些是仓库服务端设置，不由本地配置
自动启用）。

### 安装与回退

合并 main 后，CI 发布完整安装包；已安装的客户端下次启动即可在应用内下载。保留旧版
安装包方便回退，但会话数据格式迁移不保证向后兼容，升级前应备份数据。Developer ID
签名、公证与真正的静默自动安装属于后续阶段，本流程不引入这些能力。

## License

MIT
