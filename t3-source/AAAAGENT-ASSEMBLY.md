# AAAAGENT T3 源码快照

上游 `c13f7d93fff0f578886985a3f673b4b21b7f6ac8`；项目源码 `3798c0e6da49fc03dec6a0b05bb4beb46d99edfe`。

本目录已应用 AAAAGENT 补丁、界面覆盖层及独立协作接口，是 Mac 构建使用的固定源码快照。Windows 的平台改动在独立的 `../windows/t3-source/` 中维护。
原始补丁与覆盖层同时保留在 `../code/`。来源说明见 [Mac 更新与验证](../docs/MACOS-20261010.md)，构建时由运行包工具生成逐文件校验记录。
本目录保留 Web／Server／Desktop 构建源码及包管理锁；移动端只保留构建许可依赖，未打包移动端 SDK 或二进制。
具体步骤见 [Mac 安装与配置](../docs/SETUP.md)及[固定引擎构建](../code/workbench/integration/engine-pins/README.md)。

保留上游 [MIT 许可](LICENSE)及[第三方声明](../THIRD_PARTY_NOTICES.md)。公开源码不附带许可未确认的 Apple 设备 GLB 和合并符号字体；它们通过可选资源加载处理，缺失时使用已有回退。
