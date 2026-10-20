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
3. 固定 37 个 core workspace 的现有 typecheck；providers 和新增测试各自使用现有 TypeScript 编译器检查。浏览器测试单独继承同一 strict 基础配置，避免 DOM 与 Bun 的全局流类型互相污染；不放宽编译选项。desktop 不在此类型检查范围。
4. 逐文件运行 Bun 原生测试，固定文件及测试数量，拒绝缺失、新增未分类、零测试、skip、todo、失败及未知报告格式。
5. 既有 build:server；检查 Server/Web/MCP 文件非空，以及 nodes/tools/ext/providers/skills 目录非空。随后固定运行 tests/builtServer.test.ts 的 2 项检查：安全适配器自检与真实构建服务 HTTP 生命周期。检查首页/静态资源字节、插件初始化、合法及非法请求、冲突/越界拒绝、保存重开和跨进程持久化。
6. 在 Windows 用现有锁定 puppeteer-core 和预装 Chrome 执行固定 1 项真实浏览器路径：首次引导、添加工作区、创建文本节点、两次编辑、退出保存、刷新、重开并核验原文与磁盘画布。只预置关闭遥测的安全设置，不注入页面状态或用 API 替代 UI；没有浏览器下载、no-sandbox 或新增依赖。逐步截图与脱敏日志保存在专用 runner 临时目录，成功或失败均归档。此新增路径尚待实际 CI 运行，不能因代码存在宣称通过。
7. 路由变更时运行现有 routes 并要求 router.ts 无差异；检查运行后候选工作树仍干净。
8. 根据改动要求额外平台/界面/人工影响分类，未知运行时代码不自动降级。

固定测试草案：
- tests/unit/providerFixture.test.ts：8 项，单一提供方的输入输出、缺 key、HTTP/任务错误、取消和截止时间传播；全部内存 transport fixture，不使用真实凭据、不发送网络请求，不等于真实生成。
- tests/integration/pluginInitialization.test.ts：5 项，首次初始化、相同 revision、revision 升级保留用户文件、失败不推进标记、缺源。
- tests/integration/workspaceFiles.test.ts：7 项，真实临时文件保存重开、穿越/绝对路径、根目录保护、同名不覆盖、复制不覆盖、父子路径锁、目录符号链接/Windows junction 四类逃逸拒绝及目标保留。

测试进程由入口设置独立临时 TOONFLOW_DATA_DIR；不借用真实用户目录。symlink fixture 通过获准的共享文件原语创建，不绕过统一入口。

构建服务测试使用最小环境、独立 HOME/data、禁用 .env 自动读取；服务以测试专用适配器限制 Node HTTP 监听为 loopback，并拒绝常见出站接口及 fetch 重定向。它不是 OS 防火墙，也不代表原样启动、全部网络接口或浏览器验证。测试不替换应用授权/路径/持久化处理；有启动和请求期限，验证进程退出及端口释放。

## 明确尚未实现/验证

- 新增浏览器路径的实际 Windows CI 结果与逐步证据审阅，以及真实插件执行（初始化和元数据加载不等于执行）。
- Windows 安装/启动/重启，双架构 macOS 和 Android 真实路径。
- 当前 dev 精确集成候选验证和维护者对基础设施的审阅。

这些不是豁免：入口明确报未验证，阻塞自动合并。不能仅凭 20 项行为测试、HTTP 生命周期或构建存在就宣称符合全部 core 标准。需要补充覆盖的后续实现仍属于验收标准变更，走 draft 审阅；不得删除阻塞文本来制造绿灯。

## CI

唯一候选门禁名称：`core acceptance (incomplete baseline blocks)`。Node 自测只是该 job 中的一个步骤，不是可替代 core 的独立通过门禁。固定第三方 Actions 提交，最小 contents:read，不保留 checkout 凭据，不提供密钥，不发布。取消不算通过。job 级 Git 配置在 checkout 前固定 core.autocrlf=false、core.eol=lf，不改全局持久配置、不清理候选改动。Git 解析只读取 stdout，stderr 警告不伪装成路径；真实非零退出与 dirty status 仍阻塞。

CI 使用独立准备步骤 `node scripts/prepareDependencies.ts`，仅执行 `bun install --frozen-lockfile --ignore-scripts`。准备前后对全部受 Git 跟踪的 package.json 与 bun.lock 计算 SHA-256（包含嵌套锁文件），并检查它们与 HEAD 一致；任何变更、文件删除、清单增减、安装失败都会阻断；未忽略且未暂存的新清单或锁文件也会阻断。即使安装失败也检查文件不可变。没有普通安装回退，不禁用完整性校验，不运行生命周期脚本。新增 14 项隔离 Git fixture 自测覆盖这些保护；它们是基础设施测试，不是业务验收。

在依赖安装前，显式执行 `node scripts/prepareSdkTypes.ts`：下载固定 Electrobun 2.0.1 Windows x64 官方归档，校验完整大小与 SHA-256，再用系统 tar 将两个原始配置类型成员仅流式读取到内存，逐项校验长度与 hash，最后写入全新 `.hutch/devkit/api/config`。已有 `.hutch` 拒绝覆盖。不会解包其他成员，不运行归档程序，不创建替代类型，不调用 SDK prepare 或远程安装回退，不改依赖/锁文件。此准备只满足 core 配置类型需要，不代表桌面 SDK、安装或运行已验证。7 项隔离 fixture 验证完整性、路径白名单、版本及不覆盖保护。缺失类型仍明确失败/未验证；禁用安装脚本后若任何原生组件尚未准备，同样不得跳过相应检查。依赖准备成功不等于业务测试、构建或运行已通过。完整 core 尚有上述覆盖缺口，继续保持 draft。

## 本次 bootstrap 证据

首次基础设施按 code-standards 第 5 节既有行为保护例外执行，不虚构旧业务 FAIL。Node 自测证明固定清单/测试报告/未知范围/失败门禁，以及真实子 runner 能发现故意断言失败。候选 c3f1b7e 的 Windows 20 项行为测试、39 项类型检查、完整构建及产物已实跑通过，但完整门禁仍未验证。历史分步实测见 evidence/1/60675efa/ 与 evidence/1/symlinkPrimitive/。新增 Git 解析回归使用同一测试取得旧版 3 FAIL/1 PASS、新版 4 PASS；最新候选的正式 HTTP 与 CI 结果必须绑定确切提交，不沿用旧候选成功。Node 自测不能移用为产品测试结果。
