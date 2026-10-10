# macOS 安装与配置

[项目首页](../README.md) · [平台差异](PLATFORMS.md) · [本次 Mac 验证范围](MACOS-20261010.md) · [English](#english)

这是基于 2026-10-10 源码同步的 **0.3.0-dev.1 开发候选**，不是经过本轮 Mac 原生验收的稳定安装包。Mac 使用根目录 `code/` 和 Swift / AppKit / WebKit 宿主；Windows 使用独立的 `windows/` 目录与 Electron。两者共享本次产品功能基线，但不要共用二进制、`node_modules`、绝对路径或激活指纹。

本次 Mac 不接入 Windows 的本地 ASR、TTS 或 Ollama 对话扩展。对话、转写、语音合成、感知与后台记忆仍按各自的云端服务配置运行，可能产生费用。可选唤醒词检测是原有独立能力，仍需自行准备相应资源；它不表示支持本地语音转写或完全离线使用。

## 环境与构建

当前固定引擎和唤醒运行时面向 **Apple Silicon / macOS arm64**。准备 Node.js **24.13.1**、npm，以及 Xcode Command Line Tools 中的 Swift、AppKit / WebKit SDK 和签名工具。Intel Mac 没有对应的本次固定引擎验收记录。T3 工具链使用 pnpm **11.10.0**，单独安装其依赖。

从仓库根目录进入 Mac 源码：

```sh
cd code/desktop-pet
npm ci
npm run check
npm run build
```

`build` 编译共享 TypeScript 和微信相关 JavaScript / WASM；它不证明 Mac 原生宿主、音频设备或实际服务可用。Windows 主机只能执行这类共享代码检查，不能替代下面的 Mac 构建。

在 Mac 上准备好授权资源后执行完整构建：

```sh
npm run build:macos
```

该命令依次构建后端、桌面网页与管理页预览、Darwin arm64 唤醒依赖、Swift 原生宿主。也可分别运行 `build:desktop`、`build:wake`、`build:native` 排查问题。原生脚本生成 `desktop/build/星月陪伴.app` 并做本机 ad-hoc 签名；这不是 Developer ID 签名或公证安装包。

## 角色素材与第三方来源

默认角色模式为视频。把自己有权使用且与目录匹配的 `catalog.json`、`assets/webm/*.webm` 及目录中引用的 `assets/memes/*.png` 放到 `code/desktop-pet/desktop/assets/local-model/dsh-pet/`。目录需包含有效的 `idle` 动作，所有被引用文件都必须存在；首配和后台会验证目录与资源。视频角色不要求 Live2D 模型或 Cubism SDK。没有视频资源时会显示缺项，可在桌面角色选择器中切换到已经自行配置的 Live2D；不会把缺资源状态当作加载成功。

按 [Live2D 接入说明](LIVE2D.md) 准备自己有权使用的模型、匹配的预设目录、参数映射和 Cubism SDK。资源缺失的公开源码可以构建网页外壳，但 Live2D 会明确显示不可用；补齐资源后需重新构建。构建成功不等于已有角色资源或已通过模型兼容性检查。

从 [Live2D 官方](https://www.live2d.com/en/sdk/download/web/) 获取适用的 Cubism SDK for Web，按其许可在本机准备 `desktop/vendor/cubism/Core/live2dcubismcore.min.js`、`desktop/vendor/cubism/Framework/src/` 及 Framework 所需的 WebGL shader 资源。自己的模型入口为 `desktop/assets/local-model/pet.model3.json`；运行 `node tools/configure-model.mjs` 生成初始禁用目录后，还需配置参数映射和验证预设。不要将这些 vendor 或模型文件提交到公开仓库。

视频桌宠来源为 PC2005-cloud 的 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)：代码采用 MIT，动画、提示词和源视频适用上游非商业条款。T3 工作台基于 [T3 Code](https://github.com/pingdotgg/t3code)。本仓库不附带私人视频、购买的 Live2D、Cubism vendor、模型权重、参考录音或账号资料，详见 [第三方来源与许可](../THIRD_PARTY_NOTICES.md)。不要把购买使用权理解为公开再分发授权。

## 首次设置与云端凭据

后端构建完成即可打开首次设置，不要求事先有 Key、音色或手写 JSON：

```sh
npm run configure-local
```

保留终端，打开它显示的本机链接。链接含会话授权，不要公开转发。首次打开只启动本机设置网页，不会自动调用模型或打开设备；缺角色资源或原生构建时，仍能准备凭据、模型设置和音色，但不能完成正式启动条件。

- 对话及相关文字处理使用 **DeepSeek** Key；ASR、多模态与百炼托管语音模型使用 **阿里云百炼** Key。分别在 [DeepSeek 控制台](https://platform.deepseek.com/api_keys) 和 [百炼控制台](https://bailian.console.aliyun.com/) 开通所需服务，参考 [百炼 Key 说明](https://help.aliyun.com/zh/model-studio/get-api-key)。
- 显式保存 Key 后会测试对应供应商的模型目录，产生一次联网请求，但不生成内容。失败保留配置并显示脱敏错误；刷新不会自动重试。模型目录认证成功不代表每个型号都已开通。
- Key 仅清除首尾粘贴空白，保留包括点号在内的有效内容；仍检查非空、长度及请求头安全。凭据保存在项目外、当前用户所有的受限文件中，页面只显示引用和状态。不要把凭据搬进仓库来绕过检查。
- 可以选择已适配的系统音色，或上传有权使用的 MP3 / M4A / WAV 参考音频：10 秒至 5 分钟、最多 20 MB。上传和本机格式转换不等于已发起云端克隆。创建、试听与首次正式启用分别按页面流程确认；新登记音色不会自动替换当前选择。

语音创建与正式合成都可能收费，金额和确认范围以页面及调用时供应商规则为准。参见 [MiniMax 合成](https://help.aliyun.com/zh/model-studio/minimax-synchronous-speech-synthesis-api) 与 [音色复刻](https://help.aliyun.com/zh/model-studio/voice-clone-design-http-api)。账本保留费用估算与未知结果；超时、断线、取消或样音下载失败不会自动重做付费操作。

## 激活、启动与已有数据

设置页列出的资源和构建缺项处理完后，点击完成会写入“已准备”配置，再显式激活和启动：

```sh
npm run configure-local -- --activate-existing
npm start
```

激活会重新验证当前目录、配置摘要、运行文件指纹和外部凭据权限，本身不调用模型或打开设备。启动后使用云端功能可能计费。管理页通过当前运行会话打开，不要复用旧端口或过期链接。

当前公开版统一使用以下私有目录：

| 内容 | 仓库根目录下的位置 |
| --- | --- |
| 配置、激活、管理会话 | `.local/model-evaluation/trial/user-trial/` |
| 费用账本及运行锁 | `.local/model-evaluation/` |
| 陪伴记忆、微信、音色与工作台状态 | `.local/data/` |
| 项目引擎与构建资源 | `artifacts/runtime/`，不包含在源码分发中 |

升级前退出正在使用的实例，保留 `.local/`、外部凭据和授权素材。重新构建会改变指纹，应使用与该版本匹配的配置登记或审核更新流程；不要删除数据库、修改摘要或关闭权限检查来强行启动。此更新不自动导入私下交接目录中的 `artifacts/W0-I/` 或 `data/desktop-pet/` 账号和数据。

已有真实音色注册资料的用户也可使用 `config/providers.example.json` 与 `node tools/configure-local.mjs /absolute/path/to/config.local.json --activate`。占位音色和示例凭据不能代替自己的配置。该工具拒绝覆盖已有私人状态。

## T3、Codex 与 DeepSeek Harness

固定版本为 Codex **0.160.0**、DeepSeek Harness **0.2.0-rc.2**、Node **24.13.1**，目标锁为 `darwin-arm64`。T3 使用固定上游源码与本项目覆盖层；引擎、账号、订阅、运行包和已登录 profile 均需自行准备。按 [Mac 项目引擎说明](../code/workbench/integration/engine-pins/README.md) 安装和登记，保留归档、运行清单、源码及身份校验。

源码构建出的 T3 Web / Server 文件，还需完成项目运行包与 profile 登记，不能直接当成已激活工作台。已有原生会话按准确 SID 续聊；未知结果先查状态，不自动重发。任务派发仍需核对完整卡片并确认，工具批准也使用对应原生流程。

首次安装的顺序是：固定引擎与桌宠共享构建 → T3 普通 Web / Server 构建 → `package-macos-t3.mjs` 打包 → `install.mjs --new-isolated-home` 登记 `.local/data/t3-home` → 独立 `/native/` 网页构建并安装到 `code/desktop-pet/t3-native/apps/web/dist/` → 首次设置及激活。完整命令在引擎说明中。首次设置会登记已安装的 profile、运行清单和内嵌网页；检测到不完整或已变更的项目引擎时拒绝完成。请在配置前完成所需构建，不能用独立 T3 启动成功代替内嵌工作台验收。

完整工作台与已有原生 Mac App 的互通是不同验证项。包内历史 Mac 记录和本轮可复用检查见 [本次 Mac 验证范围](MACOS-20261010.md)；本轮没有在 Windows 主机上证明 Swift 窗口、Mac App 双向同步或真实设备可用。

## 测试与公开分发

`npm test`、`npm run test:release`、`npm run test:setup` 检查不同范围的共享逻辑；部分文件权限、符号链接和原生运行时测试必须在 Mac 上执行。合成凭据、音频和 mock 服务结果不能替代真实账号与设备验收。

提交前在干净副本运行 `python3 tools/check-release.py`，排除依赖、构建产物、`.local/`、数据、密钥、参考音频、模型和 SDK，并保留第三方许可。检查器只核对已知目录和敏感信息模式，不授予素材再分发许可。

<a id="english"></a>

## English

This is the **macOS 0.3.0-dev.1 source development candidate**, synchronized to the October 10 baseline. Use root `code/desktop-pet/` on Apple Silicon; Windows has its own `windows/` tree. The pinned Mac engines target `darwin-arm64`. Use Node 24.13.1, the required Xcode command-line tools and pnpm 11.10.0 for T3.

Run `npm ci`, `npm run check` and `npm run build`. On a Mac with authorized resources, run `npm run build:macos` for the web, wake and Swift targets. The resulting app is locally ad-hoc signed, not a notarized installer. Missing Live2D resources are reported as unavailable; install compatible licensed assets and rebuild. Private media, SDK files, weights and credentials are not bundled. Keep the direct attribution to PC2005-cloud's [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) and read the [third-party notices](../THIRD_PARTY_NOTICES.md).

The default video renderer reads `catalog.json` and its referenced `assets/webm/` and `assets/memes/` files under `code/desktop-pet/desktop/assets/local-model/dsh-pet/`. Supply authorized media and a matching catalog with an idle action. Video-only setup needs no Live2D SDK. Missing video resources remain unavailable; select your separately installed Live2D model in the desktop renderer selector if applicable.

Open `npm run configure-local`, keep the terminal running, and use its private local URL. The first page does not call a model. Saving a credential explicitly tests the provider's model catalog; voice creation and use follow their own cost confirmations. After resolving setup blockers, prepare the configuration, run `npm run configure-local -- --activate-existing`, then `npm start`.

Public installation state is under `.local/model-evaluation/` and `.local/data/`; restricted credentials remain outside the repository. Preserve them when upgrading. Runtime fingerprints must be registered for the matching build; old private handoff paths are not automatically migrated.

Mac does **not** include Windows' local ASR, TTS or Ollama dialogue integrations. Speech, dialogue and background providers retain their cloud configuration. Optional keyword wake detection is separate. Shared TS/JS checks on Windows do not validate Swift, macOS permissions, hardware, real service calls or native-app synchronization. See the [Mac evidence and limitations](MACOS-20261010.md) and [platform comparison](PLATFORMS.md#english).
