# Linux core 实施回归

基于本仓候选 5ef692eb8b5c4168640c1a8e93b18babe1144301。
平台回归先把原 inline Windows x64 判断等价提取为 supportsCorePlatform，保持旧行为，再用同一测试取得 Linux false !== true 的真实断言失败。加入 Linux x64 后同一测试通过；Windows x64 保留，未知平台和其他架构拒绝。不是缺失导出或编译失败，也不伪称业务 bug。

34项基础设施自测通过，没有跳过。模式回归是无网络、无生命周期脚本的合成 workspace：跟踪644时冻结安装后dirty，跟踪755时保持干净，内容不变。实际项目仅提交MCP入口执行位，不在验收后清理模式求绿。实际候选的完整构建、HTTP/UI与dirty结果将在准确提交后记录，不预先宣称通过。

原有 Windows 失败保留。新增 Linux 路径不代表桌面安装器或真实模型调用成功。最终人工/集成门禁未删除。
