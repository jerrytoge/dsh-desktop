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
| `DSH_UPDATE_CHECK` | 设为 `0` 关闭版本检查 |

## 自动更新

项目用 [Renovate](https://github.com/renovatebot/renovate) 跟踪
`@deepseek-ai/dsh` 的新版本，自动开 PR 同步依赖；合并后 CI 自动打包并发布新
Release。

## License

MIT
