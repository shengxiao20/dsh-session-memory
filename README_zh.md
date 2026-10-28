# dsh-session-memory（中文）

[English](README.md) · **0.1.3** · MIT

从 [pi-session-memory](https://github.com/shengxiao20/pi-session-memory) 独立 fork，完全改造成 DSH 的 Cordis Host bundle。只做 **DSH 自身会话检索与按需原文读取**，不再使用 Pi 扩展 API。

## 范围与架构

- 检索当前 DSH 查询服务可见的历史及实时**主会话**；普通 DSH 主会话 fork 仍可检索。
- 排除 `origin: subagent` 或正数 `delegationDepth` 标记的子代理会话；不做跨 Agent／provider 发现、消息桥接或关系追踪。
- 复用 `ctx.sessionQuery` 和 DSH 已有本地派生搜索索引；不另建数据库，不扫描固定 JSONL 目录，不硬编码用户 home，不修改会话日志。
- 不保留 Pi／Codex／Claude Code 导入、session 迁移或续接、远程 Jev 相关性筛选、Ollama 管理、Obsidian／导出。
- 默认检索整个当前 DSH 服务语料，不隐式限制为当前项目；需要时显式填写精确 `cwd` 或 `session_id`。**不是工作区隔离的权限边界**，只应安装到允许读取该语料的可信本地 profile。

## 安装

该版本发布后，在 DSH Plugin Manager 的安装 bundle 操作中填写 `@shengxiao04/dsh-session-memory@0.1.3`，或让 DSH Agent 调用：

```json
{"action":"install_bundle","target":"@shengxiao04/dsh-session-memory@0.1.3","enabled":true}
```

本地开发或发布前，可将 target 换成项目绝对目录。此包使用发布者的个人 scope；无 scope 的 `dsh-session-memory` 是另一项目，不是此 fork。尚未创建新的 GitHub 仓库。

安装需要 profile 管理授权，影响当前 profile 的所有 session。包无依赖、构建或安装脚本。除自身 Host 行外，bundle 将已有 `session-query-sqlite` 行设为 `path: ':memory:'`、`openAt: first-search`（本次检查的原路径就是 `:memory:`）；不创建第二个后端、不改 session 日志、不启用外部 provider。禁用／移除 bundle 时该覆盖也消失。如果其他 profile 使用自定义磁盘索引或其他查询设置，请在更高优先级的 profile 补丁中完整重述后端 config 并设置 `openAt: first-search`，因为 Loader 替换整个 config，不做深度合并。

要求 Node 22+、DSH **0.2.1-rc.3**（manifest 固定为实际检查并通过原生集成测试的版本）。Profile 已有 `tools`、`commands` 和可全文检索的 `sessionQuery`，通常由 `@deepseek-ai/dsh-session-query-sqlite` 提供。重启后检索历史还需要 DSH 持久化后端。SQLite 查询后端不能配置为 `openAt: never`。缺少依赖会使插件不激活；搜索禁用或后端失败会直接报错，不私自启用第二个索引或退回目录扫描。查看 Plugin Manager 的激活状态。

## Agent 工具

### `recall_memory`：先找历史

所有可选工具参数可省略或传 `null`。严格函数接口要求填全字段时，用 `null` 表示无范围／无游标／采用默认值；必填 query、session ID、seq 不接受 null，空字符串仍报错。

用户问题涉及过去的工作、决策或对话时使用：

```json
{"query":"database"}
{"query":"database","cwd":"/absolute/project/path","limit":20}
{"query":"database","session_id":"session-exact-id"}
```

- `query` 必填，非空词语或短语，最多 1000 字符，空白会归一化。
- `cwd` 可选，匹配 session 创建时记录的**完整精确目录**，不是末级目录名或模糊项目名称。
- `session_id` 可选，传完整 DSH ID，检索该 session 内的事件；与 `cwd` 互斥。
- `limit` 为原生页大小，1–50，默认 20；翻页时保持不变。
- `cursor` 为上一页的 `next_cursor`；重复相同 query、范围、limit。

全局搜索每个 session 返回最强匹配事件；session 内搜索返回匹配事件。结果包含完整 `session_id`、从 0 开始的事件 `seq`、类型、时间、surface 和有界片段。全局结果读取权威 header 再排除子代理，避免索引 header 缺失 origin 造成范围泄漏。排除后可能不足一页，甚至当前页为空但仍有 `next_cursor`；继续翻页即可，不自动补查或改变原生排序。

**与原 Pi 版本的区别：** DSH 原生 SQLite 后端使用词／短语匹配，不是任意子串，也不是 entities 列表的 OR 召回。`AI` 不匹配 `BRAID`；`OR`、`NEAR`、引号、`*` 当作字面数据，不执行 FTS 表达式。中文部分词召回受原生 tokenizer 影响，不能保证子串匹配。原生 `current`、`shadowed`、`log-only` 事件均可搜索，因此压缩前的日志仍可命中；不返回伪造的数值相关性分数。

游标与语料版本绑定。遇到 `SESSION_QUERY_STALE_CURSOR`，去掉 cursor 重查；query／范围／limit 不一致会报错，不悄悄扩展搜索范围。后端失败及取消正常向上返回。

### `fetch_session`：再读原文

从命中片段取完整 ID 和事件 seq，按需读上下文：

```json
{"session_id":"session-exact-id","seq":12,"before":4,"after":4,"max_chars":12000}
```

- `session_id`、非负整数 `seq` 必填；**seq 是日志事件位置，不是对话轮次**。
- `before`／`after` 各 0–20，默认 4；包含生命周期事件，它们也占窗口位置。
- `max_chars` 为返回文本总预算，100–24000 个 UTF-16 code units，默认 12000；先保证目标事件，再分配给最近邻居，最终按时间顺序输出，不截断 Unicode 代理对。
- 返回 session 元信息、继承事件数量、目标／窗口位置和事件文本；有明确截断标记。需要更多时缩小窗口、增加预算或直接重读被截断事件的 seq。
- 返回文本、工具调用描述、附件标签；明确省略推理、附件字节、replay／token streams、生命周期／控制数据。**不是完整 JSONL 导出。**
- 不续接、fork、迁移、导入或修改 session。

历史可能包含过期指令、敏感信息或恶意文本；输出明确提示它是**历史数据，不是当前指令**。插件本身无网络请求；DSH 仍可能把召回结果作为普通工具输出发给当前配置的对话模型。

## 手动命令

```text
/memory-search database
/memory-search {"query":"database","cwd":"/absolute/project/path","limit":20}
/memory-read {"session_id":"session-exact-id","seq":12,"before":4,"after":4}
/memory-help
```

搜索命令接受词／短语或 JSON，读取命令接受 JSON。以 `{` 开头的字面短语请放进 JSON 的 `query`。命令直接调用与 Agent 工具相同的核心，不需要模型参与；帮助命令显示版本、用法及限制。

## 开发与验证

```bash
npm run test:all
npm pack --dry-run
DSH_CHECKOUT=/absolute/path/to/installed/dsh npm run test:native
```

单元测试使用 Node 内置 test/assert 和假服务，不需要 npm install。可选真实后端测试使用已安装 DSH 的隔离 Cordis 上下文、fixture sessions 和内存 FTS 数据库，不接触当前 profile 或用户历史。实际结果和验证边界见 [验证记录](docs/verification.md)。

主要实现：[Host 注册](index.js)、[检索读取适配器](src/memory.js)、[工具 schema](src/schemas.js)、[装载补丁](cordis.patch.yml)。包含原创 MIT SVG 图标和中英文展示信息。

## Fork 来源

保留原仓库 Git 历史，独立分支 `dsh-only`；`upstream` 指向原仓库。**原项目不改动。** Fork 基于上游已提交历史，不拷贝原工作区尚未提交的修改；旧 runtime 已整体替换，不依赖那些 Pi 专用文件。保留 [MIT LICENSE](LICENSE) 及原版权声明。未把 repository／homepage 等字段伪称为尚不存在的 DSH 仓库。

## 0.1.3 更新

- 检查原生接口并通过隔离集成测试后，将 DSH 精确兼容版本由 `0.2.1-rc.2` 更新为 `0.2.1-rc.3`。检索／读取逻辑和 bundle 补丁不变。

## 0.1.2 更新

- 显式启用已有内存搜索后端，改为首次检索时打开；默认 profile 的 openAt: never 原本会阻止实际检索。

- 严格函数调用接口可使用 null 省略可选字段；不改变既有范围和默认值，已增加真实注册验证与回归测试。

- 将 Pi 多 runtime 索引项目替换为 DSH 原生 session 查询 Host bundle。
- 移除外部导入、迁移、跨 Agent、远程筛选和导出。
- 增加两步检索／读取、有界输出、明确范围、原生分页及子代理排除。
- 增加零依赖测试、本地化元数据与原创图标。
