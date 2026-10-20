# 验收标准

## 1. 状态与所有权

主分支为 `master`；采用第 3 档，只允许满足批准门禁的业务 PR 自动合入 `dev`。`master`、tag、发布仍由维护者处理。牛马 是维护者化名；Bae / Bae880808 是 Agent 身份，Agent 自己发出的 GitHub 评论、review 或 merge 不是维护者批准。

本文件的验收原则与门禁已采用；验收脚本、固定测试清单及其 CI 入口归维护者把关。以下具体入口与实施细节仍须核实并取得必要范围批准，不代表脚本已存在、测试已实现或已经运行。规则恢复只包含 AGENTS.md、docs/code-standards.md、LESSONS.md，不恢复验收工具、测试、依赖或工作流。改变标准必须独立 draft PR，不能混入业务修复、删测试、放宽断言或靠 skip 消除红灯。标准在首次有效基线之后继续约束每个业务任务，不因完成初始化而失效。

## 2. 新基线需要复核的源码与环境条件

以下是随规则保留的源码检查要点，不是新仓库的已验证现状。启用验收前，必须在新 fork 的实际基线逐项重新读取源码与配置，记录变化；不得用旧实验结果替代新基线运行。规则恢复未安装依赖、执行项目或运行验收，没有可宣称的新仓库测试 PASS/FAIL。以下命令、版本、工作区与平台条件仅在重新核实后适用。

- 检查根目录 Bun 版本（保留的参考值为 `1.3.14`）、`typecheck` 的工作区调用范围，以及 `test`、`lint`、`verify` scripts 和 `.test.*` / `.spec.*` 套件是否存在；不得预设已有完整测试。
- `bun run build` 构建 tools、ext、Web、Server 等，但没有构建 nodes；不能单独代表完整独立部署构建。现有 `bun run build:server` 会逐目录构建 nodes、tools、ext，再构建 Web、Server；源码明确说明它绕开 Bun 1.3.14 在 Linux 的部分 `--filter` 目录问题。
- 构建不等于类型检查。Web 用 `vue-tsc`，其他工作区多用 `tsc`；共享 tsconfig 设置 `noEmit: true`、`strict: true`。根 `typecheck` 只调用存在该 script 的工作区；`packages/providers` 虽有 tsconfig，却没有独立 typecheck script，不能因此声称整个提供方目录被直接完整检查。它可能被其他工程导入检查，覆盖必须列明。
- 桌面 typecheck 依赖已准备的 SDK，Intel Mac 使用另一份 tsconfig；根命令不覆盖所有平台实现。还有一处间接前置条件：`electrobun.config.ts` 直接引用 `.hutch/devkit/api/config/ElectrobunConfig`，Web Vite config、Server/mobile 构建脚本也会导入它；不能承诺“排除 desktop 就不需要 SDK”。C#、Java、Gradle、原生启动库以及安装器的正确性不由 TypeScript 检查证明。`compat/*` 不在根 workspaces 列表。
- 检查 Debug build、Release 及任何 PR workflows 的实际存在与覆盖范围。平台构建及部分产物检查不能代替单元/集成测试或应用完整运行验收；会发布的 Release 不可作为日常验收替代命令。

## 3. 建议采用的验收入口

建议新增一个跨平台 Bun 入口，而不是把 Windows 用户强制绑到 Bash：

```text
bun scripts/verify.ts --profile core --base <旧基线SHA> --head <待验收SHA>
bun scripts/verify.ts --profile windows --base <旧基线SHA> --head <待验收SHA>
bun scripts/verify.ts --profile macArm64 --base <旧基线SHA> --head <待验收SHA>
bun scripts/verify.ts --profile macX64 --base <旧基线SHA> --head <待验收SHA>
bun scripts/verify.ts --profile android --base <旧基线SHA> --head <待验收SHA>
```

本次规则恢复没有带入 `scripts/verify.ts`；其在新基线是否存在、内容是否符合标准须另行核实。以上命令是拟定接口，不代表已实现或通过。平台 profile 必须包含 core，不是用平台打包代替 core。UI/外部服务的人工或浏览器证据由最终门禁逐项核对；脚本不能只检查“有截图文件”就声称用户流程正确。

建议入口按参数数组调用子进程，避免依赖某一 shell 的环境变量语法；每个子命令记录退出码，非零立即失败。禁止隐式安装依赖、下载 SDK、发布、使用真实凭据或付费调用；准备环境是独立的显式步骤。标准应列出固定期望工作区及测试集合：命令不存在、目录不存在、零测试、少跑工作区、发现新增未分类运行时代码，都不得报绿。

### core 的最小组成

建议首次 core 基线使用 Windows x64，与既有桌面准备链路一致；Linux 独立服务构建另行验证。跨平台入口不等于任意系统都无需 SDK 即可运行。后续增加 Linux/macOS core runner，须实测前置条件与覆盖，不靠跳过类型错误实现。

1. 记录 Git SHA、基线、系统/架构、Bun 版本、依赖锁与验收版本；检查 diff 范围、冲突标记及意外生成文件。依赖在隔离环境用现有 `bun install --frozen-lockfile` 显式准备，不能改锁文件求通过。Windows x64 的 SDK 准备使用现有 `bun apps/desktop/node_modules/electrobun/bin/electrobun.cjs prepare`；检查所需类型文件存在，不能将 SDK 缺失归为业务测试 FAIL。
2. 逐个运行根 workspaces 中具有 typecheck script 的工作区，调用形式为现有 `bun run --cwd <工作区> typecheck`。core 明确排除需要桌面 SDK 的 `apps/desktop`，由平台门禁补齐；排除不是“全仓类型检查通过”。同时显式运行 `bun node_modules/typescript/bin/tsc -p packages/providers/tsconfig.json --noEmit`。后者是利用现有编译器与配置的新增验收调用，不是已有 package script。需在 bootstrap 实测完整调用清单，不能假定批量 filter 已覆盖全部。
3. 新建 Bun 原生测试套件，建议入口为 `bun test ./tests/unit ./tests/integration`；这两个目录与正式测试清单须在新基线核实并按授权建立，不能因文档列出而假定存在。每次运行固定 core 全套及本 issue 回归测试，不以“只跑改动文件测试”冒充全套。
4. 执行现有 `bun run build:server`，检查预期 nodes、tools、ext、Web、Server、MCP、providers、skills 产物存在且能被运行时读取。构建成功不是安装包验证。
5. 启动构建后的服务，在专用临时 `TOONFLOW_DATA_DIR` 与获准测试工作区完成 Web/Server 冒烟。启动进程应由测试入口明确设置环境与回收，仅操作本次目录，不借用用户真实 data。检查首页、静态资源、关键 API、初始化插件及工作区保存后重开；不能只测 HTTP 200。
6. 改动新增、移动或删除路由时，在隔离 worktree 执行现有 `bun run --cwd apps/server routes`，确认 `apps/server/src/router.ts` 与生成结果一致；生成步骤改变源码时必须提交并重跑相应验证，不能把工作区未提交状态当作已验收的提交。

现有 `bun run typecheck` 可作为诊断或完整主机检查，但报告必须写出真正运行的工作区、SDK 和平台；不得用根命令名字推定覆盖。暂不提议 ESLint、全仓格式化或额外测试依赖，避免未核实工具与不必要的大改。

## 4. 固定清单与按风险加跑

每个业务 PR 必跑 core；以下检查是增加，不是任选其一。清单在开工时按“改动 + 调用方 + 用户路径”选择，PR 说明每项选择依据。未能分类、涉及公共初始化/文件层/平台能力而影响范围不清楚，停止自动合并并请维护者判断，不自行判定为低风险。

### core 固定行为保护

- 工作区：合法读写、保存后重开；路径穿越、绝对路径、符号链接逃逸、根目录修改必须拒绝；同名目标不覆盖；并发冲突和中途失败保留可恢复数据。用临时文件并校验实际内容，不只断言返回码。
- 插件初始化：首次安装、同版本重启、revision 改变；内置插件按规则更新，第三方插件和用户素材保留；失败不得错误推进 initialized 标记。相关入口为 `apps/server/src/utils/plugins/initialize.ts`。
- 接口边界：合法请求、缺失/非法字段、未经许可的工作区请求及失败响应；新增路由验证可达，不能只验证 handler。
- 提供方：批准的 fixture 覆盖模型能力/输入输出匹配、revision 变化、错误与超时；只对实际支持的能力断言。模拟结果标记为 fixture，不能称真实生成成功。
- 基础 UI：首次启动入口 → 首页 → 打开测试工作区 → 创建/编辑节点 → 保存 → 重新打开；验证值与文件持久化。画布、媒体或设置变更追加对应完整路径与失败恢复。

以上是建议建立的首批保护面，不表示这些测试已存在，也不承诺覆盖所有风险。

### 独立模块追加

- `apps/updateServer` 不由根 `build:server` 构建；修改它须追加现有 `bun run --cwd apps/updateServer build` 及临时目录下的更新文件服务/错误路径测试，不执行 `publish:update` 或真实发布。
- MCP、tools、nodes、ext、FFmpeg 的改动需验证实际构建产物在宿主可加载、调用、保存结果与失败恢复，不能只测源码导出的纯函数。文档/图片/音视频处理使用获准小型 fixture，校验实际文件格式、内容或元数据。
- teams 在现有构建源码中明确暂停打包。`build:server` 成功不能证明团队运行可用；涉及恢复团队打包的任务须先批准 scope 和真实入口，不通过偷偷取消注释恢复。

### UI、媒体与外部服务追加

- UI 改动必须从真实入口走到最终持久化结果，记录中间步骤和关键截图/录屏，检查浏览器控制台与服务日志；改到焦点、快捷键、触控或布局时补对应交互，不只拍最终一屏。
- 模型/媒体链路：设置提供方与模型 → 选择实际支持的能力 → 输入 → 发起请求 → 处理中/错误处理 → 展示结果 → 保存并重开。另测取消、超时、失败后的恢复或重复操作，按实际支持范围断言。
- HTTP fixture/本地替身只能证明协议处理，不能替代被改动外部服务的真实用户路径。需要真实服务但无获准账户、数据、网络或调用权限时标记“未验证”，阻塞该业务 PR 的自动合并。
- 当前 subscription 测试阶段不设 Agent 日金额门槛，不等于批准 Toonflow 的 TF-Router、ApiMart、Compshare、Metaso 等 API 支出、签名服务或新订阅。新增付费调用与数据传输仍按明确授权执行，不把未知费用写成 0。默认 core 不调用外部生成 API。

### 平台追加

- Windows：改动 `apps/desktop`、Windows 原生入口/安装器、WebView2、桌面文件对话框、协议或更新路径时，在 Windows x64 执行现有 `bun run build:desktop`，涉及包装再跑 `bun run package:desktop`；补安装 → 启动 → 目标功能 → 退出/重启。涉及 WebView2 探测应覆盖已安装、缺失、无效或残留注册信息等已确认场景。安装成功不能替代启动成功。
- macOS：触及共用桌面逻辑时评估 ARM64 与 x64 两条实现，不能用 ARM 构建替代 Intel。现有准备命令是 `bun packages/startup/scripts/buildMac.ts`；Intel 另需在 `compat/macIntel` 安装锁定依赖并生成适配文件。随后执行桌面 build/package 和实际安装、启动、相关原生功能。签名/公证结果与 GUI 验证分别记录；不为验收绕过系统安全警告或使用未获准凭据。
- Android：当前 `apps/mobile/scripts/build.ts` 明确只支持 Windows 构建，要求 SDK/JDK；使用现有 `bun run --cwd apps/mobile setup` 与 `bun run --cwd apps/mobile build`，不在 Linux 假装验证通过。涉及 mobile/native、浏览器桥接、移动互联或权限时，补 Android ARM64 实机/受支持模拟器安装、冷启动、目标路径、前后台恢复和数据保留；APK 编译/签名校验不等于这些行为通过。
- 共用文件、启动、插件同步、平台能力或序列化改动，按实际消费者追加受影响平台，不仅看文件所在目录。未受影响平台可依据已批准风险矩阵不纳入本 PR，但报告只能声明“本次选定范围通过”，不能写“全平台已验证”。未知影响范围不得自降门槛。
- `compat/ohos` 存在独立配置但不在上述正式平台集合中；若任务涉及它，先请维护者确认验收环境和范围，不能让根 typecheck 代为背书。

## 5. 先 FAIL 后修复

对每个行为修复或新增行为，新增回归测试必须在未应用修复的旧实现上产生预期的行为断言失败，再在候选实现通过。先记录可复现的输入、预期、测试名、旧 SHA、测试文件 hash、命令、退出码、完整输出及失败原因。两次使用同一测试；若调整测试，重新取得有效旧代码 FAIL。

依赖缺失、编译错误、新接口不存在导致无法加载、网络故障、超时配置不当、零测试、skip 或 runner 崩溃均不是所需 FAIL。修复完成后还须跑固定套件，不能只让新增测试变绿。实际错误未在旧实现复现，写“未复现”，不伪造反事实。

以下两个已采用的例外只适用于明确符合条件的范围，不能由 Agent 扩大解释；基础设施与受保护标准改动仍须 draft 审阅：

1. 首次建立验收基础设施的既有行为保护测试，允许旧实现 PASS；测试 runner 本身需证明能发现故意的断言失败/缺失测试等门禁错误。这不能伪装成某个业务 bug 的旧代码 FAIL，基础设施 PR 永远 draft 交维护者。
2. 真正纯文档、无运行时/规则/脚本/数据影响的 PR，可以采用链接、内容、diff 的专用验收，不制造业务失败测试。修改验收标准、AGENTS、LESSONS 或用户操作命令不自动属于普通 docs-only 例外，仍需相应审批与核验。

## 6. 首次启用、基线与红灯

已采用的规则不能代替基础设施实施授权；维护者仍须单独批准基础设施 draft PR 的具体范围。新增 `.github`、package scripts、依赖或发布/构建脚本必须满足禁区授权；批准本文不自动等于批准未知实现或更改分支保护。

基础设施必须在固定基线上实际运行，记录所有结果。测试不存在或 CI 缺席是“未验证”，不是绿灯，也不应虚构为已复现产品 bug。首次基线确有产品/类型失败，建立明确故障与证据，优先修复；不能删测试、压低断言、增加永久 skip 或接受“历史问题所以绿”。环境/SDK缺失单独标记环境阻塞。

在正式验收入口、固定测试清单、期望 checks 与首个有效基线尚未完成之前，第 3 档业务自动合并保持关闭。基线建立后，每个任务仍须执行本文件全部适用的验收、证据与合并门禁，不得只检查基线曾经通过。现有 Debug build 绿灯不能解除这一阻塞。修复 `master` 红灯仍需维护者合入 `master`；只修到 `dev` 不能宣称 `master` 已恢复。

## 7. 证据及合并判定

证据放在 `evidence/<issue号>/<候选短SHA>/`，PR 仅链接本 fork 准确候选下的文件或本 fork 持久 CI 记录，至少包含：

- `summary.md`：issue、范围、验收版本、所选 profile/测试清单及理由、逐项 PASS/FAIL/未验证/不适用、剩余风险；不适用须给出批准矩阵依据。
- `manifest.json`：旧代码 SHA、feature head SHA、目标 `dev` SHA、集成候选 SHA/树 hash、环境/工具版本、时间、命令、退出码、测试数量、fixture/真实服务标记及 CI run/job 链接。
- `regression-before.log`、`verification-after.log`：完整失败与成功输出；用户路径记录及按步骤编号的关键截图/录屏。没有旧 FAIL 的批准例外须显式标明依据。

所有公开证据与提交消息都遵守 AGENTS.md 的静默边界：不附外部 issue/PR 引用、上游用户提及或上游提交引用；外部来源以独立来源键表示，完整映射留在受控私有记录。本 fork 的实际验收 SHA 可按上述要求记录。证据不得包含密钥、token、真实凭据、不必要个人数据或未经许可公开的业务素材。脱敏不能删除影响验收结论的错误信息。只在报告写“通过”、没有对应输出或步骤，视为证据缺失。

任务 worktree 仍按 AGENTS 从 `origin/master` 创建。自动合入 `dev` 前，必须将当前 `dev` 与 feature head 的准确集成候选纳入上述全部适用验收，而不是只验证从 `master` 分出的 head。若该候选缺少已批准的验收基础设施，停止并由维护者解决集成顺序，不能自行豁免。

自动合并只在适用且已批准的全部检查成功、UI/外部流程证据完整、没有禁区/待批准标准变更、没有未解决阻塞时允许。缺失、pending、cancelled、skipped、零测试、旧提交成功均不算通过。未经批准不得用“本地部分通过”替代正式 CI。

合并前重新核对 feature head 与 `dev` 均未变化，并使用 expected head SHA / `--match-head-commit` 等保护。该保护只校验 head，不能声称它原子锁定了 base；`dev` 变化就重建候选并重验。若当前工具/仓库设置不能可靠确认候选与最终合并结果，保持 draft 交维护者。合并后核对实际提交/树与已验收候选对应，发现不一致立即报告，不宣称已验证。

## 8. 实施前需要确认的事项

1. 将“core 固定全套 + 按影响追加平台/真实路径”的矩阵落实为固定清单与已批准风险分类；不要求每个普通 Web 修复都运行全部安装器，但禁止把局部验证称全平台通过。
2. 核实 Bun 原生测试与跨平台 `scripts/verify.ts` 的实施状态；具体实现、CI 和任何依赖变更另开 draft 审批，不因规则恢复自动获准。
3. 按本文件限定范围使用首次基础设施或真正纯文档例外，记录适用依据；不得扩展豁免范围。
4. 确认能提供的 Windows、两种 Mac、Android 验收环境及真实外部服务测试权限；未具备的必要环境如实阻塞，不默认降级。

## 待复核的本地源码路径

以下均为仓库根目录相对路径，仅列出检查入口，不表示已经复核新基线，也不引入任何外部讨论或历史提交关联。

- 根配置：`package.json`
- 独立 Server 构建：`apps/server/scripts/buildStandalone.ts`
- 桌面构建与 typecheck 分流：`apps/desktop/scripts/build.ts`
- 共享配置对 SDK 类型的引用：`electrobun.config.ts`
- Android 构建前置条件：`apps/mobile/scripts/build.ts`
- Debug build workflow（只读核查）：`.github/workflows/debug.yml`
- 工作区文件安全逻辑：`apps/server/src/utils/workspace/files.ts`
- 插件初始化：`apps/server/src/utils/plugins/initialize.ts`
