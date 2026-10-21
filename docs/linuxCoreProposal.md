# Linux core 验收路径提案

状态：仅供维护者审阅的独立草案，不修改当前标准、脚本、工作流或自动合并条件，不宣称 Windows 已通过。关联本仓 #1、#2。

## 建议决策

增加 Linux x64 的 Server/Web core 基线，保留独立 Windows 兼容性检查。不是删除 Windows 产品支持，也不是用 Linux 成功覆盖 Windows 失败。首次实现仅形成待审候选；改变正式基线及适用门禁须由维护者批准。

## 已有事实

准确候选 `5ef692eb8b5c4168640c1a8e93b18babe1144301` 在 Linux 上通过 40 项类型检查、33 项基础设施自测、20 项固定业务测试、2 项构建服务 HTTP 测试（143 个断言）。云桌面 Chrome 完成首次引导、新建工作区及文本节点、两次编辑、退出保存、刷新、重开，并核对编辑器原文及磁盘字节；保留 11 张逐步截图。此手工实测不冒充固定浏览器测试已通过。

原统一入口实际退出 2、notVerified，因为限定 Windows x64。Windows 候选运行在浏览器前置目录探针处 10 秒超时，Chrome 未启动。该探针同时等待 PowerShell 退出、stdout 和 stderr，不能据此定位为原生目录 API 故障。失败记录必须保留。

准备及构建流程结束后观察到 `packages/mcp/src/stdio.ts` 从 Git 模式 100644 变成 100755，内容未变，诊断结束时恢复了原模式。尚未定位具体触发步骤，不能直接归因于构建脚本。该本地清理不是完整验收成功；未来统一入口的 dirty 检查必须原样阻断此副作用。

## 最小实施清单（待批准，尚未实施）

1. `scripts/verificationPlan.ts`、`tests/verificationPlan.test.ts`：显式定义 Linux x64 与 Windows x64 的 core 平台分类。用同一回归测试记录旧规则拒绝 Linux、新规则接受 Linux，且未知系统/架构仍拒绝；不伪称这是业务缺陷测试。
2. `scripts/verify.ts`：只将平台选择接入经审阅的分类，仍完整执行 40 项类型检查、20 项固定业务测试、构建与全部产物检查、2 项 HTTP 检查、1 项真实 UI 路径和最终 dirty 检查。准确 SHA、固定数量、失败/跳过/取消、人工审阅及 dev 精确集成候选限制全部保留。
3. `tests/browserPath.test.ts`：复用现有锁定的 Puppeteer 与预装 Chrome，不新增依赖或浏览器下载。Linux 使用实际存在的官方预装 Chrome 路径及独立 HOME/XDG；Windows 保留原生目录保护并分阶段记录 PowerShell 启动、类型加载、目录调用、进程退出和输出结束。两平台执行完全相同的 UI 行为及磁盘断言；不使用 no-sandbox、禁用 Web 安全或注入业务状态。任何浏览器启动失败仍为失败。
4. `.github/workflows/verification.yml`：独立 `ubuntu-24.04` 与 `windows-2025` 运行；矩阵 `fail-fast: false`，平台化 artifact 名称，每个 job 绑定准确候选提交并保留失败日志。不得使用 continue-on-error、跳过测试、只取 Linux 状态或更改分支保护制造总绿灯。两个 job 都保留现有冻结依赖、无生命周期脚本、固定 SDK 类型校验及最小权限。
5. 先在隔离候选逐步记录准备前、依赖准备后、各构建步骤后 Git 状态，定位 MCP 模式变化。若需修实现，单独列出最小修复文件和同一回归测试旧 FAIL → 新 PASS 证据再提交草案。此提案不预先授权改依赖清单、锁、发布脚本或业务逻辑；禁止用 core.filemode=false、reset、chmod 清理或忽略路径使验收变绿。
6. `docs/code-standards.md`、`docs/verificationEntry.md`：仅在独立待审实现草案中准确记录新增 Linux core、Windows 适用矩阵和未覆盖平台。Windows/macOS/Android 原生变更与公共跨平台变更仍追加相应真实验证；Linux core 不证明桌面安装器或模型服务成功。

## 验收与交付

- 在同一个已提交候选上记录完整命令、退出码、环境、测试数量、产物 hash、逐步 UI 截图、磁盘持久化及清理证据；干净工作树前后都验证。
- Linux 完整真实路径不能只由手工截图或 HTTP 200 代替固定 UI 测试。Windows 若仍失败，保留红灯及具体阶段，不称全平台通过，不清除现有 needs-human。
- 正式基线启用仍需维护者审阅完整证据、影响分类与精确 dev 集成候选；基础设施和受保护标准变更不自动合并。
- 推荐下一步：批准上述第 1–4、6 项的明确文件范围，仅提交实现 draft；第 5 项先定位，不扩大修复范围。没有新增包、密钥、付费服务、发布或权限变更。

## 技术依据

GitHub 官方文档支持每个 job 选择独立托管操作系统，以及矩阵中保留失败而不取消其他组合：
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job
- https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs#handling-failures

这些能力支持并行收集真实结果，不意味着本项目的任一平台已通过。
