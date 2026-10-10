# V2.0 开发进展

2026 年 10 月 11 日

新版 T3 Code 工作台、本地模型和新的桌宠已经接入。Windows **0.3.0-dev.1** 开发候选源码已发布，安装入口见 [Windows 说明](../windows/README-WINDOWS.md)。Mac 与 Windows 分开维护，本次 Windows 更新没有覆盖 Mac 根目录源码。

## 新工作台与工作流程

工作台基于 [T3 Code](https://github.com/pingdotgg/t3code) 整合，把项目、任务会话、结果查看和继续执行放在一起，减少来回切换。Flow 用对话节点组织项目，点击节点即可展开会话。

Windows 的 Codex 和 DeepSeek Harness 已通过 T3 完成两轮同会话文件任务，Codex 另验证了官方 app-server 的同会话恢复。完整原生 Codex 桌面 App 的双向同步仍需单独验证。

![Flow 工作台开发预览](../assets/previews/v2-flow-workbench-original.jpg)

上图为 Flow 工作台开发预览。

## 本地模型与音色训练

语音识别已接入 SenseVoice、Paraformer、Whisper；语音合成已接入 GPT-SoVITS、Kokoro、Qwen3-TTS。文字对话可通过 Ollama 接入 Qwen3.5 4B，后台记忆等服务仍可使用云端。

**本地语音合成优先推荐 [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)**。想训练自己的音色，可以参考[官方中文安装与微调指南](https://github.com/RVC-Boss/GPT-SoVITS/blob/main/docs/cn/README.md#微调)，按音频切割、可选降噪、转写、校对标注和训练的流程准备。入门可以先看官方 README 推荐的[花儿不哭 B 站介绍视频](https://www.bilibili.com/video/BV12g4y1m7Uw)。B 站也有不少[训练教程与经验分享](https://search.bilibili.com/all?keyword=GPT-SoVITS%20%E8%AE%AD%E7%BB%83%E6%95%99%E7%A8%8B)，选择与所用版本对应的教程，并使用有权用于训练的录音。

本次按模型分别测试，避免 ASR、TTS 和本地对话同时占用内存、显存。GPT-SoVITS 与 Qwen3-TTS 的验证使用官方权重和合成参考音频；自己的训练音色仍需单独试听。设置与实测见 [本地语音](../windows/local-models/README.md)和[本地对话](../windows/docs/LOCAL-LLM.md)。

## 新的桌宠

新的桌宠使用 **[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)** 的视频动作与多套表情素材，感谢原作者分享。AAAAGENT 增加了播放、状态切换和 Windows Electron 适配，同时保留 Live2D 接入方式。

这只桌宠的原始素材来自第三方，不能归为 AAAAGENT 原创。上游代码采用 MIT；动画、提示词与源视频禁止商用，介绍、展示和分发衍生作品时须保留原项目链接。素材包不随本次源码提供，完整说明见 [第三方来源与许可](../windows/THIRD_PARTY_NOTICES.md)。我们自己的 DeepSeek 大鲸鱼 Live2D 仍在制作中。

## 当前状态

这是开发候选。4B 对话存在已记录的算术和上下文召回错误，后台记忆处理也有独立的已知失败；实体设备、个人微调音色和长期负载仍需验证。[查看测试结果与已知问题](../windows/docs/WINDOWS-20261010.md)。

## English

### V2.0 development progress — October 11, 2026

The update integrates a newer [T3 Code](https://github.com/pingdotgg/t3code) workbench, local models and a new desktop pet. Windows **0.3.0-dev.1** development source is available with a [setup guide](../windows/README-WINDOWS.md). Mac and Windows remain separate; this Windows update did not replace the root Mac source.

The workbench brings project organization, task conversations, results and continuation together for a smoother workflow. Flow organizes projects as conversation nodes. Codex and DeepSeek Harness each completed two real file-task turns in the same session through T3; Codex also passed an official app-server session-resume check. Full bidirectional synchronization with the native Codex desktop app remains unverified.

Local ASR supports SenseVoice, Paraformer and Whisper. Local TTS supports GPT-SoVITS, Kokoro and Qwen3-TTS. Qwen3.5 4B dialogue connects through Ollama; background memory may still use cloud services.

**[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) is our first recommendation for local speech synthesis.** Start with the [official Chinese installation and fine-tuning guide](https://github.com/RVC-Boss/GPT-SoVITS/blob/main/docs/cn/README.md#微调) and the README's recommended [Bilibili introduction by 花儿不哭](https://www.bilibili.com/video/BV12g4y1m7Uw). Bilibili also has [training guides and community walkthroughs](https://search.bilibili.com/all?keyword=GPT-SoVITS%20%E8%AE%AD%E7%BB%83%E6%95%99%E7%A8%8B); choose one matching your version and use recordings you are entitled to train on. Models were tested in separate stages to limit RAM and VRAM pressure. The GPT-SoVITS and Qwen3-TTS checks used official weights and synthetic reference audio; personal fine-tuned voices need separate listening tests.

The new pet's animations and expressions come from **[PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)**. AAAAGENT adds playback, state switching and Windows Electron integration. The upstream code is MIT; animations, prompts and source videos prohibit commercial use and require the original project link in derivative introductions, displays and distributions. Media is not included in this source release. See [third-party notices](../windows/THIRD_PARTY_NOTICES.md). Our own DeepSeek whale Live2D is still in production.

This remains a development candidate. The 4B tests exposed arithmetic and recall errors, and a separate background-memory issue remains unresolved. Physical devices, personal voices and long-running workloads need further validation. See [measurements and known issues](../windows/docs/WINDOWS-20261010.md).
