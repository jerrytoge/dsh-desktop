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
npm install
npm run fetch-node   # 首次构建前拉取内置 Node runtime
npm start            # 开发模式启动
npm run build        # 打包 .dmg
```

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
