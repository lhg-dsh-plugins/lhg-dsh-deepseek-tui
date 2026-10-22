# BUGFIX：终端观察者抛错会挂死前台提问（`NativeInteractions.questions()` 的 emit 无异常防护）

- 基线：上游 v1.3.0，commit `42a2a7fa2a01b5a10a2e2ce368c151c8e0fdafc5`
- 本版：1.3.1
- 选型说明：上游 open issue 中 #196（欢迎页刷新清历史）已由上游 PR #198 在本基线修复，#197 为性能架构规划、#215 为 Windows 安装问题（离线不可复现）、#190/#161/#157 为功能请求；本 bug 为静态审查实锤缺陷 + 最小复现脚本证实（修复前失败、修复后通过），非 issue 编号对应项。

## 证据链

1. **代码现场（基线未修）**：`src/host/native-interactions.ts` 中，同类的 `approval()` 路径在两处帧投递（`emit`）外都包了 try/catch，并有注释明言「A broken terminal observer must not…」（坏掉的终端观察者不得拖垮主流程）；而 `questions()` 路径完全没有防护：
   - `finish()` 内 `this.emit({…'question/resolved'…})` 裸调用，且位于 `resolve/reject` **之前**；
   - 提问开始时 `this.emit(envelope)`（`question/requested` 帧）裸调用，位于 pending 条目登记**之后**。
2. **最小复现（修复前 FAIL）**：构造 `NativeInteractions`，订阅一个在 `question/resolved` 帧抛错的 sink，正常应答该问题：
   - `respond()` 直接把观察者的异常抛给调用方（`respondThrew=true`）；
   - 问题 Promise 永不 settle（`settled=false`）——`finish()` 在 emit 抛错后没能执行到 resolve/reject；
   - 且 pending 条目已被 `finish()` 开头的 `delete` 移除，无法重试——前台提问被一个坏观察者**永久挂死**。
   - 另一路：sink 在 `question/requested` 帧抛错时，异常冒泡且 pending 条目残留（`replay()` 仍能看到该帧），状态不一致。
3. **修复后**：同一复现两路均正常（见下「复验结果」），并固化为回归测试 `tests/native-interactions-observer-fault.test.ts`。

## 根因

`questions()` 的帧投递把「通知观察者」与「结算 Promise」串行耦合在同一调用栈里，emit 抛错即中断结算；与 `approval()` 已确立的防护口径不对称，属遗漏而非设计。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/host/native-interactions.ts` | 仅此一处逻辑修复：`finish()` 的 resolved 帧 emit 包 try/catch（附注释说明与 approval 路径对齐，抛错也必须继续结算）；初始 requested 帧 emit 改为 `try { this.emit(envelope) } catch { finish() }`，抛错时以 `ASK_ABORTED` 干净拒绝并清除 pending。 |
| `tests/native-interactions-observer-fault.test.ts` | 新增回归测试 2 条（resolved 帧抛错不挂死且答案正常 resolve；requested 帧抛错以 `ASK_ABORTED` 拒绝且无残留 pending）。上游既有测试文件一字未改。 |
| `src/dsh-compat.ts` | 版本常量 `PACKAGE_VERSION` 1.3.0 → 1.3.1（与 manifest 一致性是本仓契约）。 |
| `package.json` | `version` 1.3.0 → 1.3.1；`repository.url` 改为本修复版仓库。homepage/bugs 等其余字段未动。 |
| `lib/index.js`、`lib/bin.js`、`lib/dsh-compat-*.js` | 上游构建（tsdown）重新生成的产物：`lib/index.js` 含上述修复的编译结果；dsh-compat chunk 因版本常量变化由 `dsh-compat-pV-GGS5V.js` 改名为 `dsh-compat-DVSMuTDo.js`，两个入口的 import 路径同步更新。 |
| `README.md` | 仅顶部追加中文 lhg fork 头，上游原文一字未删（README.zh.md 未动）。 |
| `UPSTREAM.md` / `BUGFIX.md` | 新增，出处与本文件。 |

## 复验结果

- **回归测试**：新增 2 条修复后 2/2 通过；相关测试文件（foreground-question-native、native-interactions、continued-question-*）共 105 条全通过；`typecheck`（`tsc --noEmit`）通过。
- **全量测试（修复后，环境完备时）**：2375 条，2321 通过、51 跳过、**仅 3 条失败**，且 3 条全部是下节声明的版本针断言。对照基线全量：2373 条，2322 通过、51 跳过、0 失败。差值可完全勾稽：+2 条新回归测试通过，−3 条版本针转红，其余零位移。
- **基线 flake 如实记录**：`foreground-question-native.test.ts` 的 ASK_TIMED_OUT 用例在一次基线全量跑中失败过 1 次（其断言依赖 60ms 实时定时器），单跑 3/3 通过、其余全量跑（含修复后）均通过，判定为并行负载下的时序 flake，与本次改动无关。

## 边界（预计红：3 处版本针断言）

上游 `tests/package-contract.test.ts` 把「发版身份」写死：要求 README 双语徽章/安装 spec/release 文档与版本号逐字一致且 `docs/release-v<版本>.md` 存在。本 fork 补丁按修复版契约**不执行上游发版仪式**（README 正文原文保留、不伪造上游 release 文档），故以下 3 条断言仅因版本字符串变红，已逐项核实与代码逻辑无关：

1. `package-contract`「pins the native Remote adapter…」期望字面 `1.3.0`，实际 `1.3.1`；
2. `package-contract`「keeps both READMEs on the release version…」期望 README/发版文档同步为新版；
3. `intake-public-wiring.test.js` 登录用例期望 client version `1.3.0`。

如需全绿，按上游发版惯例同步 README 版本引用并补 `docs/release-v1.3.1.md` 即可，与本修复无关。

## 环境说明（验证过程的伪影，均已排除）

- 沙箱内 node-pty 原生编译失败，依赖以 `pnpm install --frozen-lockfile --ignore-scripts` 安装；`pnpm run build` 的 deps 状态检查在沙箱触发 EPERM，`lib/` 改由 `npx tsdown` 直跑构建，产物正常。
- 一次全量跑曾多出 4 条失败（`profile-create-usable` ×3、`clarify-doctor` ×1），根因为沙箱镜像层的 `/usr/bin/pnpm` 二进制缺失导致子进程安装退出码 127；恢复 pnpm 11.7.0 后两文件单独复跑全通过，全量复跑即回到上述「仅 3 条版本针」结果。
