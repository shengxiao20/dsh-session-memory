# dsh-session-memory（中文）

[English](README.md) · 工作版本 **0.3.1** · MIT

从 [pi-session-memory](https://github.com/shengxiao20/pi-session-memory) 移植为 Cordis Host 插件，保留 MIT attribution。参考 Pi 的 turn 召回逻辑，但**只管理 DSH 自己的主会话**。不发现、检索、解析或导入 Pi／Codex／Claude Code 历史，不访问其他宿主数据库，不提供 session migration。原 Pi checkout 只作代码参考，不是运行时历史来源。

npm `latest` 当前为 0.2.3，使用已验证的 DSH 0.2.1-rc.5 宿主合约。本 0.3.1 工作树增加基于用户确认 DSH 证据范围的无工具、顺序 multi-agent Discussion，同时保留工具结果的调用时脱敏配置快照；发布 0.3.1 仍是独立的鉴权发布步骤。独立 Remotion Studio 预览已制作，未渲染 MP4。

## Pi 对齐边界

证据处理规则与 Pi 对齐。调用拓扑不宣称 API 完全相同。

Pi 能在 `recall_memory` 执行期间暂停，并显示原生 TUI 参与者清单。已检查的 DSH rc.5 工具合约没有等效的工具执行中用户选择 API。因此 DSH 使用两次 Agent 工具调用：`recall_memory` 返回候选，`discuss_memory` 接收用户已确认的范围。这是明确的宿主适配，不是 Pi 残留代码。

DSH 不注册 slash command。召回、Discussion、源读取、统计和 backfill 都是 Agent 工具。配置由 Plugin Manager 提供。早期重复的 `/memory-*` 命令界面已删除。

## 调用树

```text
recall_memory
├─ entities + 完整 question
│  ├─ DSH sessionPersistence.list / open / read
│  ├─ 持久化 DSH user/assistant 源 turn → 插件自有 SQLite
│  ├─ 全局：substring OR → 实体覆盖排序 → top K → 可选 Jev
│  ├─ 项目：entities 匹配已存 DSH CWD 最后一段目录名 token 序列
│  │  └─ 已发现 DSH 会话 → 相同排序／top K → 可选 Jev
│  └─ 删除全局实际返回过的项目 turn_id；不补齐

用户确认 1–3 个 session ID 及包含两端的证据范围
└─ discuss_memory
   ├─ 历史 DSH 参与 Agent 按顺序运行
   ├─ 完整 consultant prompt + 无工具 + 无可选 runtime context
   ├─ 每个参与者只收到有界可见源 turn，且互相看不到回答
   └─ 私下回答返回发起的主 Agent 比较

review_jev_filtered
└─ 全局／项目 literal 按 turn_id 合并去重 → 一次判定 → 被过滤 turn

fetch_session
└─ 精确持久化 DSH session_id + 包含两端 turn index → 可见源文本

get_memory_stats → 同步持久化快照 → DSH 总数
backfill_memory → 显式重建持久化 DSH turn 索引
```

不要求 embedding、Agent 主动写记忆、taxonomy 或 vector 服务。索引存源文本，不是枚举成事实／偏好／规则的记忆条目。历史是**不可信数据，不是当前指令**。

## DSH 持久化历史与插件索引

这里只有一套插件自有的可重建 SQLite 派生索引；它不是权威源：

```text
$DSH_HOME/sessions（DSH persistence；权威源）
└─ 公开 sessionPersistence.list / open(read) / handle.read
   └─ 插件维护的 source-turn SQLite → $DSH_HOME/dsh-session-memory/history.sqlite
      └─ entity substring OR、项目发现、排序、精确 turn 读取与统计
```

- 插件显式依赖 DSH `sessions` 与 `sessionPersistence`；不注入、不配置、不调用 `sessionQuery`，也不挂载 DSH FTS5。物理 JSONL／压缩格式由 DSH persistence 抽象，插件从不直接解析存储文件。
- 插件 DB 默认 `$DSH_HOME/dsh-session-memory/history.sqlite`，未设置则 `~/.dsh/dsh-session-memory/history.sqlite`。连接以及基于 persistence snapshot／read handle 的增量同步由插件负责。目录 `0700`，DB／WAL／SHM `0600`，WAL、`synchronous=NORMAL`。
- 索引只是可重建视图；`$DSH_HOME/sessions` 下的 DSH persistence 始终权威。插件不写源日志、不扫描项目文件、不访问其他 harness 数据库。
- `turn/end` 后，插件先等待 `sessions.flush(session)` 作为 DSH durability barrier，再刷新索引。搜索／读取／统计还会再次同步；每个 read handle 必须关闭。变化会话完整替换派生 turn，消失会话移除，显式 backfill 重解析全部持久化会话。
- 派生更新有事务；失败／取消回滚当前更新并抛错。未知派生 schema 明确拒绝，不静默迁移／删除。本工作版本 schema 为 **2**，避免把已撤销的多来源实验 schema 当成 DSH-only 查询库。
- 模型重配置取消等待旧工作、复用索引，不同步历史、不启动模型。卸载等待自有工作再关闭 DB；包中没有外部 roots 发现／导入／迁移实现。
- 权威 header 排除 `origin: subagent` 或正 `delegationDepth`，普通主会话 fork 保留。Discussion 创建同时带这两个标记的短期 DSH subagent，因此其本地持久化咨询日志不会进入召回；插件不修改任何被选源会话。范围过滤**不是授权**。模型专用 surface replacement 不重复生成 transcript turn；append-origin 历史文本仍可检索。

## 召回语义

`entities`：2–8 literal topic 字符串，trim／小写后至少两个不同实体；`question`：最多 1000 字符的完整用户问题。SQLite `instr(lower(user_text || ' ' || reply_text), entity) > 0`，多个实体 OR。SQLite 内置大小写折叠为 ASCII，其余 Unicode literal。`AI` 可命中 `BRAID`，`card` 可命中 `wildcard`；标点是数据，不是 FTS 操作符。

每个不同命中实体只加一分，**不是词频**。按实体覆盖分降序、user 时间降序、稳定 turn ID 排序。`limit` 为**每阶段** 1–50，默认配置 `recall.limit`（20）。筛选／去重不补齐。实体 recall 没有 cursor，只接受 `entities`、完整 `question` 和可选 `limit`。

项目发现只用 entities 和**已存 DSH CWD 最后一段目录名的 token 序列**，不推断当前 runtime／project／session／time。Transcript 无 literal 命中时也可给有界项目候选。普通 recall 先全局后项目串行筛选，再剔除全局实际保留的项目 turn_id。Audit 先合并 literal 再判一次，不缓存／复用上次 recall。

Turn ID：`dsh:<session_id>:<user-event-seq>`。`seq/end_seq` 是精确包含两端的源 event 坐标。文本 user 开始 slice；仅图片 user 占 index、结束前一个归属但不成为检索文本。聚合可见 assistant 文本／保留工具名，排除 thinking／附件 bytes／tool-result payload。

搜索 unique 结果共享 24000 UTF-16 源文本预算，另有最多 500-unit excerpt，明确截断。Jev 使用**输出截断前完整的可见源 turn**；更多上下文按精确 turn 坐标 fetch。

## Multi-agent Discussion

Multi-agent Discussion **默认关闭**。请先在 Plugin Manager 中启用 **Multi-agent Discussion → 启用 Discussion** 并保存。设置立即生效。关闭后，新 `discuss_memory` 调用会失败，正在执行的 Discussion 也会取消。

仅在用户确认 `recall_memory` 返回的一至三个 session ID 和包含两端的证据范围后，调用 `discuss_memory`。每个参与者使用发起主 Agent 的精确 provider／model 路由。参与者**顺序**运行，不并行。

每个参与者只收到所选可见源 turn 和完整问题。完整 consultant system prompt 将历史视为不可信证据；Agent 范围限制不暴露工具，并关闭可选 runtime context。参与者互相看不到回答。主 Agent 收到全部私下回答，并负责比较与最终判断。

Discussion 不恢复或写入任何被选源会话。DSH 为每次模型调用创建单独的短期 subagent session。它的本地持久化记录带 `origin: subagent` 和正 `delegationDepth`，因此召回和 backfill 排除它。这是本地隔离，不是临时存储。

参与者一致不等于事实验证。`fetch_session` 始终可独立核查精确持久化源上下文。Discussion 不自动调用它，也不把它作为静默 fallback。证据范围最多 20 turns；每位参与者的 `max_chars` 为 100–24000，并明确报告截断。

## Agent 工具

| 工具 | 用途 |
|---|---|
| `recall_memory` | 对持久化 DSH turns 做全局／项目实体召回 |
| `discuss_memory` | 与 1–3 个用户确认的历史 DSH 参与 Agent 顺序、隔离咨询 |
| `review_jev_filtered` | 显式 Jev 误过滤审计 |
| `fetch_session` | 包含两端的持久化源 turn |
| `get_memory_stats` | 同步后 DSH 主会话／events／turns 总数 |
| `backfill_memory` | 显式全量 DSH 索引重建，源日志不变 |

读取须精确的持久化 ID、同时提供包含两端的 index，最多 20 个 index。`max_chars` 为 100–24000，默认 12000。读取不恢复或修改会话。Discussion 必须先保存 Plugin Manager 开关。Backfill 仅用于显式 DSH backfill 或 rescan，不导入其他宿主历史。统计与 backfill 只接受空对象。

每个工具结果都会追加一个独立的两行调用时配置快照，例如：

```text
Config · Discussion=off · Jev=off (nimble; disabled) · Obsidian=off · manageOllama=off · limit=20
Env · DSH_HOME=unset · API key=local-placeholder
```

它属于工具结果文本，因此 Web 工具卡片和 Agent 上下文都可见。快照只报告开关、Jev 模型／运行状态、limit，以及 `DSH_HOME` 和所配置 API-key 环境变量的 `set`／`unset`；绝不显示凭据、vault、数据库、endpoint 或文件系统路径值。

## 本地／远程 Jev

默认关闭：`nimble`、`http://127.0.0.1:11434`、`manageOllama: false`。查看或保存配置不启动模型、不导出笔记。

```yaml
discussion:
  enabled: false
recall:
  limit: 20
jev:
  enabled: true
  model: your-system-one-model
  baseURL: https://your-decision-api.example
  apiKeyEnv: DSH_JEV_API_KEY
  contextWindow: 8192
  manageOllama: false
obsidian:
  enabled: false
```

密钥放 **Host 环境变量**，不进浏览器／config。HTTP(S) root 可带部署前缀，SDK 附加 `/v1/systemone`；拒绝内嵌凭据、query／hash、redirect。远程会发送完整问题与候选 **DSH 源文本**，先确认数据权限。配置 URL 不代表 System One／model／noul 兼容已验证；真实模型／远程部署与 HTTP fixture 分开。

启用 unmanaged 必填 contextWindow 1024–1048576，远程还必填 `apiKeyEnv`；本地 unmanaged 可用兼容 SDK key `ollama`。托管 Ollama 要本地 HTTP loopback root、显式启动／pull 许可；只取消等待自有 children，不停止已有服务。

实际 Pi 式算法用 escaped-JSON UTF-8 预算分段、每 batch 最多 64 问题，`max(segment noul) >= 0.5`，保序不补齐。**不是每 turn 单请求／非 batch**。模型故障明确 `unavailable`／literal，没有 filtered-out 判断或自动 retry，直到重配置／reload；缺凭据、配置错、caller 取消抛出。

## 配置页与 Obsidian

```text
Plugin Manager → DSH Session Memory 行 → Configure
├─ Multi-agent Discussion：enabled
├─ Recall：limit
├─ Jev：enabled / model / baseURL / apiKeyEnv / manageOllama / contextWindow
├─ Obsidian：enabled / vaultPath
└─ 保存 / 丢弃编辑 / 暂存继承默认值
```

共十个字段。Discussion 默认关闭。编辑／reset 先暂存，Save 前校验和 revision fencing；可选留空继承。拒绝 Save 保留 draft，不静默 stale overwrite。Save 会立即应用 Discussion 开关；关闭开关会取消正在执行的 Discussion。Save 也会取消等待旧的模型／导出工作，不 remount 工具，也不进行历史同步、模型请求或 note 写入。真实 plugin-row slot／browser artifact 才是 GUI，导出 Host Config 不等于 GUI。

Obsidian 默认 off，已有绝对 Host vault，不创建目录。每个完成 recall／audit 写唯一 `wx`／`0600` Markdown，含有界结果及精确坐标。失败／取消只删除自有 partial file。不自动 wikilinks、ontology、AGENTS／rules／skills 或 vault sync；外部同步可能分发私有 DSH 历史。

## 开发／验证

检查宿主 **DSH 0.2.1-rc.5**，Node >=22（Node 22 SQLite experimental）。React external，无 install-time build hook。

```sh
npm ci
npm run test:all
DSH_CHECKOUT="$(npm root -g)/@deepseek-ai/dsh" npm run test:native
DSH_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
npm pack --dry-run --json --cache "$PWD/.npm-cache"
git diff --check
```

使用 **`@shengxiao04/dsh-session-memory`**，无 scope 同名包是另一项目。Link 字节变化不重载运行中 profile。真实 GUI profile 持久化／授权、远程密钥／模型和安装／重启与隔离测试分开。见[验证记录](docs/verification.md)及[范围／逻辑对齐](docs/parity.md)。

0.1.5 是真实双语 staged plugin-row GUI／live replacement；0.1.4 local snippet Jev／Obsidian、只有 Host schema；0.1.3 锁 rc.3；0.1.2 原生 event 基线。已有 `.archify` 图描绘 **0.1.5**，不是本轮 turn-index 架构。
