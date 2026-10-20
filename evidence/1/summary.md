# 基础设施草案证据

任务：本仓 #1。基线：90604f062f15ecda5edbecce87a4fd525a2524ee。环境：Linux x64，Node v24.19.0。未安装 Bun、项目依赖或 SDK。

- PASS：`node --test tests/verificationPlan.test.ts`，6 个基础设施测试，0 fail/skip/todo；完整输出 bootstrapPass.log。
- 预期 FAIL：独立 Node test 子进程中的 `assert.equal(1, 2)` 产生 ERR_ASSERTION，退出码 1；输出 bootstrapFail.log（仅去除行尾空白，断言与退出结果未改）。它证明 runner 能发现故意失败，不是旧产品 bug 的复现。
- 未验证：17 项 Bun 产品行为测试、它们的 TypeScript 编译、37 workspace 类型检查、provider 类型检查、build:server、产物、服务/浏览器/平台路径。
- 未验证：GitHub CI、当前 dev 集成候选、完整 core 基线。

按 code-standards 第 5 节首次基础设施例外，不制造旧业务 FAIL。遵循 LESSONS：构建不是运行验证；可合并不是充分验证。没有删除测试、跳过测试或降低现有验收标准。本 PR 只提出部分可执行基础设施，尚不能启用自动合并。未使用真实密钥、调用付费服务、修改依赖/锁文件、发布或部署。

候选准确 SHA、最终复跑命令和状态写在 PR 中，避免文件内容自引用提交 SHA。公开文件仅包含本仓证据，不复制聊天或外部关联。
