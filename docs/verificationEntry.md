# 验收入口草案

状态：基础设施提案，尚未完成首个 core 基线，不能启用业务自动合并。现有 `docs/code-standards.md` 未修改。任务见本仓 #1。

## 统一入口是什么

同一条命令负责固定清单、准确候选提交、类型检查、测试、构建和结果归档，避免每次临时挑几条命令然后误报通过。它不会安装依赖、下载 SDK、发布、使用密钥或调用付费服务。

```text
bun scripts/verify.ts --profile core --base <完整旧SHA> --head <完整候选SHA>
```

入口要求候选已提交且工作树干净；记录基线、HEAD、tree、锁文件与规则 hash、环境、实际执行命令、完整子命令输出、退出码及阻塞。输出为 JSON，保存到仓库外的任务证据目录，审查脱敏后再发布。检查过程中生成的文件不能混入候选。远端暂停标签仍由维护会话独立检查。

退出码：0 只表示本入口自动检查完成；1 表示参数/命令/断言失败；2 表示未验证或覆盖不全。`autoMergeEligible` 始终为 false，因为工具不能替代维护者审批、CI 和当前 dev 集成候选核验。现阶段 core 尚有未实现覆盖，因此即使已执行项通过仍返回 2；不是可直接启用的正式全绿基线。

## 已接线的固定检查

1. 完整 SHA、祖先关系、干净工作树、diff 空白/冲突检查；固定 42 个 workspace 与 glob 清单，变更即阻塞。
2. Bun 1.3.14、Windows x64 首次 core 主机、既有依赖及共享 SDK 配置类型前置检查。准备步骤必须单独审阅，本入口不自动执行。
3. 固定 37 个 core workspace 的现有 typecheck；providers 和新增测试各自使用现有 TypeScript 编译器检查。desktop 不在此类型检查范围。
4. 逐文件运行 Bun 原生测试，固定文件及测试数量，拒绝缺失、新增未分类、零测试、skip、todo、失败及未知报告格式。
5. 既有 build:server；检查 Server/Web/MCP 文件非空，以及 nodes/tools/ext/providers/skills 目录非空。这只是产物存在性检查，不证明宿主可加载或业务正常。
6. 路由变更时运行现有 routes 并要求 router.ts 无差异；检查运行后候选工作树仍干净。
7. 根据改动要求额外平台/界面/人工影响分类，未知运行时代码不自动降级。

固定测试草案：
- tests/unit/providerFixture.test.ts：6 项，单一提供方的输入输出、缺 key、HTTP/任务错误、取消；全部内存 transport fixture，不使用真实凭据、不发送网络请求，不等于真实生成。
- tests/integration/pluginInitialization.test.ts：5 项，首次初始化、相同 revision、revision 升级保留用户文件、失败不推进标记、缺源。
- tests/integration/workspaceFiles.test.ts：6 项，真实临时文件保存重开、穿越/绝对路径、根目录保护、同名不覆盖、复制不覆盖、父子路径锁。

测试进程由入口设置独立临时 TOONFLOW_DATA_DIR；不借用真实用户目录。遵守统一文件入口，未通过原生 fs 绕过规则建立 symlink fixture。

## 明确尚未实现/验证

- 符号链接逃逸、真实 HTTP 路由的授权与非法参数、provider 超时保护。
- 构建后服务的隔离启动与宿主加载；浏览器首次入口、工作区、创建/编辑节点、保存重开完整路径。
- Windows 安装/启动/重启，双架构 macOS 和 Android 真实路径。
- 完整固定测试/类型检查/build 的首次实测，当前 dev 集成候选验证。

这些不是豁免：入口明确报未验证，阻塞自动合并。不能仅凭 17 项测试或构建存在就宣称符合全部 core 标准。需要补充覆盖的后续实现仍属于验收标准变更，走 draft 审阅；不得删除阻塞文本来制造绿灯。

## CI

唯一候选门禁名称：`core acceptance (incomplete baseline blocks)`。Node 自测只是该 job 中的一个步骤，不是可替代 core 的独立通过门禁。固定第三方 Actions 提交，最小 contents:read，不保留 checkout 凭据，不提供密钥，不发布。取消不算通过。

当前 CI 不安装项目依赖、不下载 SDK，所以新 runner 在前置检查处应失败/未验证；这有意展示尚未建立的基线，不能称 CI 已可用。Node/Bun 工具版本准备不等于项目准备。后续审阅需要确定锁定依赖/SDK 的安全准备方式，再补齐所列缺口；本 PR 不改依赖、锁文件或既有工作流。

## 本次 bootstrap 证据

首次基础设施按 code-standards 第 5 节既有行为保护例外执行，不虚构旧业务 FAIL。Node 自测证明固定清单/测试报告/未知范围/失败门禁，以及真实子 runner 能发现故意断言失败。Bun 业务测试当前未执行；不能把 Node 自测结果移用为产品测试结果。详见 evidence/1/summary.md。
