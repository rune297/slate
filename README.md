<div align="center">

<img src="build/slate-icon.png" width="128" height="128" alt="Slate logo">

# Slate

从屏幕顶部下拉即用的本地桌面工作台。

待办、速记、链接、录音与应用启动，都收在一块随用随走的面板里。

[功能](#功能) · [安装](#安装) · [使用方式](#使用方式) · [本地开发](#本地开发) · [路线图](#路线图)

</div>

> [!NOTE]
> Slate 支持 Windows x64，并提供适用于 M1、M2、M3、M4 等 Apple Silicon Mac 的 arm64 构建。macOS 版本仍需持续进行真机交互验证。

## 为什么做 Slate

常驻侧边栏会持续占用屏幕空间，普通桌面应用又需要经过查找和打开窗口。Slate 把常用的小工具放进屏幕顶部的隐藏面板：平时移出屏幕，需要时通过下拉手势或快捷键唤出，完成操作后自动收起。

顶部手势会判断鼠标按键状态，拖动窗口时不会触发面板。需要连续编辑时，也可以固定面板，暂停自动收起。

## 功能

- **待办事项**：今天、已排期、收件箱和已完成四个视角；支持分类、自然语言日期、到期提醒与批量操作
- **速记**：快速记录、搜索和归档临时想法
- **链接收藏**：粘贴网址后自动获取标题和站点图标，并支持分组
- **全局搜索**：按 `Ctrl+K` 搜索待办、笔记和链接并直接定位
- **录音与转写**：在本地录音，可选接入转写服务；API Key 使用系统安全存储保存
- **快速启动**：添加常用软件，一键启动或切换到已运行的窗口
- **剪贴板历史**：可在设置中按需开启，支持关键词搜索并与文字、图片、收藏筛选叠加
- **任务完成提醒**：通过本地 WebSocket 接收 Codex / Claude 的任务完成通知
- **浅色与深色主题**：可手动切换，也可以跟随系统主题
- **面板固定**：连续操作时可暂停自动收起，让工作区保持展开

## 安装

### Windows

1. 在仓库的 **Releases** 页面下载最新的 `slate-*-windows-x64-setup.exe`。
2. 运行安装程序并选择安装位置。
3. 启动 Slate。应用会常驻系统托盘。

当前版本暂未提供自动更新。升级时直接运行新版安装程序覆盖安装即可，用户数据会保留。

### macOS（M 系列）

1. 在仓库的 **Actions** 页面打开 **Build macOS (Apple Silicon)**。
2. 点击 **Run workflow**，等待构建完成。
3. 在该次运行的 **Artifacts** 区域下载 `slate-macos-arm64-dmg`。
4. 解压后得到 `slate-*-arm64.dmg`，打开并将 Slate 拖入“应用程序”。

当前自动构建包使用 ad-hoc 签名，没有经过 Apple 公证。首次打开时若系统拦截，请在 Finder 中右键 Slate 并选择“打开”，或到“系统设置 → 隐私与安全性”中允许打开。正式公开分发时，应配置 Apple Developer ID 签名与公证。

### 从源码运行

需要 [Node.js](https://nodejs.org/) 22.12 或更高版本。

```bash
npm install
npm start
```

## 使用方式

- 将鼠标移到屏幕顶部，再向下移动约 40 px，即可拉出面板
- 按 `Ctrl+Alt+S` 可直接切换面板显示状态
- 点击面板外部或将鼠标移出面板，面板会自动收起
- 点击面板右上角的固定按钮，可让面板保持展开
- 按 `Ctrl+K` 打开全局搜索
- 托盘菜单可打开面板、切换固定状态、进入设置或退出应用

## 数据与隐私

- 待办、笔记、链接和设置默认保存在本机
- Slate 不要求注册账户，也不包含云同步
- 剪贴板历史默认关闭，由用户主动开启
- 录音转写只有在用户配置服务并主动使用时才会发送音频
- API Key 通过 Electron `safeStorage` 使用操作系统提供的能力加密保存

## 技术栈

- [Electron 44](https://www.electronjs.org/) + 原生 JavaScript
- HTML 与 CSS，无前端框架和前端编译步骤
- [electron-builder](https://www.electron.build/) 打包 Windows NSIS 和 macOS DMG
- Node.js 内置测试运行器与 Electron 端到端脚本

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发版本
npm start

# 运行自动化测试
npm test

# 构建 Windows x64 安装包
npm run build:win

# 在 Apple Silicon Mac 上构建 arm64 DMG
npm run build
```

Windows 安装包生成在 `dist.noindex/` 目录。

### 项目结构

```text
main.js             Electron 主进程、窗口与手势管理
main-services.js    数据持久化、转写、链接抓取等服务
platform.js         不同平台的窗口尺寸与位置策略
preload.js          主进程与渲染层之间的安全 IPC 桥接
hotzone.html        顶部透明手势感应层
renderer/           界面、主题与工作台功能
build/              应用图标和打包配置
scripts/            测试与通知辅助脚本
tests/              单元测试和 Electron 端到端测试
```

## 构建说明

- Windows 安装包建议在 Windows 环境构建
- Apple Silicon DMG 可由 `.github/workflows/build-macos.yml` 在 GitHub 的 macOS 构建机生成
- 当前工作流生成 ad-hoc 签名测试包；公开分发前需配置 Developer ID 签名与 Apple 公证
- Electron 端到端测试依赖可用的桌面和 GPU 合成；锁屏、无头或受限会话可能导致测试失败

## 路线图

- [ ] 多显示器分别记忆面板位置
- [ ] 为待办和速记关联当前窗口或文件上下文
- [ ] 将剪贴板历史接入全局搜索
- [ ] 增加完整的键盘搜索结果导航
- [ ] 自动更新

路线图代表计划方向，不承诺具体发布日期。欢迎通过 Issues 提交问题和建议。

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交代码前请先运行：

```bash
npm test
```

请在 Issue 中写清楚系统版本、Slate 版本、复现步骤和预期行为。涉及界面调整时，建议同时附上浅色和深色主题截图。

## License

本项目基于 [MIT License](LICENSE) 开源。
