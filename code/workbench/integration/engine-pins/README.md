# macOS 固定引擎与 T3 工作台

本目录面向 **macOS Apple Silicon（arm64）**，固定 Codex 0.160.0、DeepSeek Harness 0.2.0-rc.2、Node 24.13.1、npm 11.8.0，T3 上游为 `c13f7d93fff0f578886985a3f673b4b21b7f6ac8`。Intel Mac 未包含对应的引擎锁。Windows 使用独立的 `windows/` 源码和工具链。

公开的 `t3-source/` 已包含 2026-10-10 基线补丁及界面覆盖层，可以直接安装依赖和构建。它不是带原始 Git 历史的上游 checkout；不要对它运行旧的 `tools/t3-native-54/prepare.mjs`，也不要使用历史私有安装计划。新的打包入口记录本次源码、依赖和完整运行文件清单，原有 native-session-sync 校验分支继续保留。

## 从全新克隆准备工具链

需要全局 Node.js 22 或更新版本、网络，以及 Xcode Command Line Tools。若原生依赖缺少匹配的预编译文件，还需按安装错误准备 Python 3 和编译工具。下列命令在仓库根目录的终端执行；不复制其他机器的 `node_modules`、账号或运行目录。

```sh
PROJECT_ROOT="$PWD"
node --version
node code/workbench/integration/engine-pins/prepare.mjs "$PROJECT_ROOT"

ENGINE_DIRECTORY="$(node --input-type=module -e "import {engineDirectory} from './code/workbench/integration/engine-pins/runtime.mjs'; process.stdout.write(engineDirectory)")"
NODE="$PROJECT_ROOT/$ENGINE_DIRECTORY/node/bin/node"
NPM="$PROJECT_ROOT/$ENGINE_DIRECTORY/node/lib/node_modules/npm/bin/npm-cli.js"
export PATH="$(dirname "$NODE"):$PATH"
"$NODE" --version
```

逐条执行并在任何报错后停止。首次 `prepare.mjs` 下载并校验固定归档、安装锁定的 DSH 依赖和项目补丁，完整清单一致后才发布引擎目录；已有目录也必须通过校验。不要关闭这些校验来复用不同平台或版本的文件。

## 构建普通工作台

先构建供 profile、权限和启动器使用的桌宠共享模块：

```sh
(cd code/desktop-pet && "$NODE" "$NPM" ci --no-audit --no-fund && "$NODE" "$NPM" run build)
```

再使用 pnpm 11.10.0 顺序安装和构建 T3。以下子 shell 不会永久改变当前终端的 Node 内存设置；本地模型运行时不要同时构建。

```sh
(
  set -e
  export NODE_OPTIONS='--max-old-space-size=4096'
  unset VITE_AAA_NATIVE_READ
  cd t3-source
  "$NODE" "$NPM" exec --yes --package=pnpm@11.10.0 -- pnpm install --frozen-lockfile --child-concurrency=1
  "$NODE" "$NPM" exec --yes --package=pnpm@11.10.0 -- pnpm --filter t3 build:bundle
  "$NODE" "$NPM" exec --yes --package=pnpm@11.10.0 -- pnpm --filter @t3tools/web build
)
```

确认 `t3-source/apps/server/dist/bin.mjs` 和 `t3-source/apps/web/dist/index.html` 已生成后：

```sh
"$NODE" code/workbench/integration/engine-pins/package-macos-t3.mjs
"$NODE" code/desktop-pet/tools/engine-pins/install.mjs --new-isolated-home "$PROJECT_ROOT/.local/data/t3-home"
```

打包工具只复制本机已构建文件和已安装依赖，不下载、重建或启动引擎。它保留各依赖许可证，将普通网页同时安装到 server 的 `dist/client`，并生成 `macos-t3-source.json` 及 `t3-adapter-source.json.macosRuntime` 指纹。后续启动验证完整运行目录、服务端入口、来源锁和全部项目补丁。打包目标 `artifacts/runtime/engine-pin-54/t3-runtime` 必须不存在；已有安装升级需另行保留旧目录与数据，不能直接覆盖活跃运行目录。

引擎 profile 写入 `artifacts/runtime/engine-profile.json`，账户 home 位于 `.local/data/engine-home`，工作台数据位于 `.local/data/t3-home`。首次安装不复制账户、密钥、历史会话或本地 Skills；应在隔离 home 中完成自己的登录或凭据配置。旧 Mac App 的共享 owner 协议仍有独立的版本与身份校验，不因新运行包生成而放宽。

## 桌宠管理页的内嵌工作台

管理页还需要 `/native/` 网页。先完成上面的普通网页打包，再在同一份、未经修改的源码上生成独立只读挂载版本：

```sh
"$NODE" code/workbench/integration/engine-pins/package-macos-t3.mjs --prepare-native-read
"$NODE" code/workbench/integration/engine-pins/build-native-read-renderer.mjs "$PROJECT_ROOT/t3-source" "$NODE"
NATIVE_DIST="$PROJECT_ROOT/code/desktop-pet/t3-native/apps/web/dist"
if [ -e "$NATIVE_DIST" ]; then
  echo '已有内嵌网页目录，请先保留并核对已有安装；本命令只用于首次安装。' >&2
else
  mkdir -p "$(dirname "$NATIVE_DIST")"
  cp -R "$PROJECT_ROOT/t3-source/apps/web/dist" "$NATIVE_DIST"
fi
```

`--prepare-native-read` 将当前源码逐文件与刚生成的普通运行包来源清单比较，一致时才登记公开 assembly 标记；它不伪造旧 checkout 或旧运行环境。原 renderer 构建器继续检查 `/native/` 入口并写入 `aaa-native-read-build.json`。普通运行包保留原网页，不要把这个 `/native/` 构建覆盖到独立 T3 的 `apps/web/dist` 或 `apps/server/dist/client`。在首次桌宠配置/激活前完成这些步骤，使运行指纹包含安装结果；已有安装须使用对应升级和重新登记流程。

启动已配置桌宠后，从控制台进入工作台，浏览器入口按本次会话生成。直接管理独立后台可用：

```sh
"$NODE" code/desktop-pet/tools/engine-pins/background.mjs start
"$NODE" code/desktop-pet/tools/engine-pins/background.mjs status
# 确认当前 profile 的任务可以结束后：
"$NODE" code/desktop-pet/tools/engine-pins/background.mjs stop --confirm-stop-tasks
```

关闭浏览器不会停止后台。未知租约不会自动抢占，超时不会自动重发任务。`probe.mjs ENGINE_ROOT EVIDENCE_DIR` 用于无模型协议检查；带真实任务的验收需单独授权并使用隔离工作目录。

## 验证范围

本次公开源码整理在 Windows 上执行了合成文件的打包/依赖/指纹测试，并验证 Windows 主机拒绝打包 macOS 运行文件；未在此主机编译或运行 Darwin 原生模块、Swift/WKWebView，也未发送模型请求。上述安装链需在 Apple Silicon Mac 上完成实际构建与启动验收。历史 Mac 同 SID 测试不等同于当前公开构建、原生 App 双向写入或每条桌宠 UI 路径的验收。

T3 与其他组件保留各自原许可；媒体、SDK、模型权重、个人凭据与数据库不随此源码提供，见仓库的第三方声明。
