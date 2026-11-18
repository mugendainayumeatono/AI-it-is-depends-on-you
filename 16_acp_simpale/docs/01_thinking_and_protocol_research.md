# ACP 实验工程：调研脉络、协议逆向探测与架构思考过程

> 本文档完整记录了在构建 `16_acp_simpale`（Antigravity ACP 实验与测试工程）前期的**技术调研路径、真实报文探测结果、核心工程难点推演以及架构决策过程**，可作为深入理解 ACP（Agent Client Protocol）与 `agy acp` 内部机制的一手参考资料。

---

## 1. 需求拆解与核心目标定位

原始需求拆解为四个关键约束与目标：
1. **协议对象**：聚焦 **ACP (Agent Client Protocol)** 协议实验；
2. **语言与工具链**：使用 **Python** 开发，包管理与虚拟环境统一使用 **`uv`**；
3. **服务端拉起方式**：客户端需**自动以子进程模式拉起本机 `agy` 的 ACP 模式**；
4. **实验深度**：编写客户端访问 ACP 并**全面测试 ACP 的各项功能**。

在进入编码前，必须先回答三个基础问题：
- 本机 `agy` CLI 如何启动 ACP 服务？采用什么传输层协议？支持哪些启动参数？
- 本机安装的 `agy acp` 实际实现了 ACP 规范中的哪些标准方法、哪些客户端回调以及哪些 Antigravity 扩展能力？
- 作为一个“协议实验工程”，客户端应该用官方 SDK 还是手写底层协议栈，才能既看清底层报文细节、又掌握工业界标准接入方式？

---

## 2. 环境摸底与 `agy acp` 真实能力探测过程

### 2.1 工具链与 Python 环境探查

通过终端探测本机环境：
- **`agy` 路径与子命令**：`/usr/local/bin/agy` 提供原生 `agy acp` 子命令（`Start the Agent Client Protocol (ACP) stdio server`）。
- **`agy acp --help` 关键参数分析**：
  - `--stdio`：默认使用基于标准输入输出（`stdin`/`stdout`）的 JSON-RPC 2.0 换行分隔流（NDJSON）传输；
  - `--disable-telemetry`：实验环境下可关闭遥测干扰；
  - `--dangerously-skip-permissions`：自动跳过所有工具权限审批——**思考点**：如果加上该参数，服务端在写文件或执行命令时将直接静默放行，导致我们无法测试 ACP 极具特色的双向权限回调 `session/request_permission`！因此实验客户端默认**不能**开启该开关，而应由客户端主动拦截并测试审批逻辑；
  - `--add-dir` / `--sandbox` / `--log-file`：支持附加工作区目录、终端沙箱限制与独立服务端日志输出。
- **Python 与 `uv` 版本**：
  - 系统默认 `/usr/bin/python3` 为 `Python 3.9.25`；
  - PyPI 上的官方 ACP SDK 包 `agent-client-protocol` 最新版为 `1.0.0`，要求 `Python >=3.10, <3.16`；
  - 通过 `uv python list --only-installed` 发现本机已安装 `cpython-3.12.13-linux-x86_64-gnu`。因此在项目根目录放置 `.python-version`（锁定 `3.12`）并在 `pyproject.toml` 声明 `requires-python = ">=3.12"`，即可让 `uv` 零下载直接复用本机 Python 3.12。

### 2.2 最小化无副作用探针：实测 `initialize` 握手

为了避免猜测协议字段，直接通过管道向 `agy acp --disable-telemetry` 发送一帧标准 JSON-RPC 2.0 `initialize` 请求：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": {"readTextFile": true, "writeTextFile": true},
      "terminal": true
    },
    "clientInfo": {"name": "probe", "version": "0.1.0"}
  }
}
```

实测拿到 `Antigravity ACP Server v1.5.10` 的真实返回报文，揭示了极其关键的能力矩阵：
1. **协议版本**：`protocolVersion: 1`；
2. **会话能力 (`agentCapabilities.sessionCapabilities`)**：完整支持 `list`（列举会话）、`load`（加载历史会话）、`resume`（恢复会话）、`close`（关闭释放会话）以及扩展字段 `additionalDirectories`（多目录工作区）；
3. **多模态与上下文能力 (`promptCapabilities`)**：
   - `image: true`（支持图片 Base64 内容块输入）；
   - `audio: false`（暂不支持音频块）；
   - `embeddedContext: true`（支持内嵌资源 `resource` 上下文块输入）；
4. **鉴权能力 (`authMethods`)**：支持 `oauth-personal`、`oauth-business`、`gemini-api-key`、`agent-platform`，且继续探测只读方法 `session/list` 直接返回 `{"sessions": [...]}` 无报错，证实本机 `~/.gemini/antigravity-cli` 已处于有效登录态，实验代码无需重复走浏览器 OAuth 流程即可直接驱动完整对话。

### 2.3 路由表与结构化 JSON 标签静态核验

由于不同 Agent 对 ACP 规范的落地程度不同（例如有些 Agent 把文件读写和终端命令委托给客户端 `fs/*`、`terminal/*`，有些则在 Agent 进程内本地执行），我们进一步对 `/usr/local/bin/agy` 二进制中的协议常量与 Go JSON 结构体标签进行了只读检索，并配合一次 `session/new` -> `session/close` 元数据探针，摸清了全部真实细节：

1. **客户端 -> 服务端支持的核心 RPC 方法**：
   - 生命周期与鉴权：`initialize`、`authenticate`、`logout`
   - 会话管理：`session/new`、`session/list`、`session/load`、`session/resume`、`session/close`
   - 配置与模式控制：`session/set_mode`、`session/set_model`、`session/set_config_option`
   - 对话与流控：`session/prompt`、`session/cancel`（Notification）
2. **服务端 -> 客户端反向发起的通知与请求**：
   - 流式通知 `session/update`（承载思维链 `agent_thought_chunk`、回复文本流 `agent_message_chunk`、执行计划 `plan`、工具调用 `tool_call` / `tool_call_update`、命令与模式变更通知等）；
   - 双向权限审批请求 `session/request_permission`（服务端带 JSON-RPC `id` 请求客户端授权）；
   - 双向交互提问请求 `elicitation/create`（当 Agent 需要向用户发起结构化追问时触发）。
3. **关键发现：`agy` 的工具执行模型**：
   - 二进制中不包含 `fs/read_text_file` 或 `terminal/create` 路由调用，说明 `agy acp` 采用**服务端本地工具执行 + 客户端远程权限拦截 (`session/request_permission`)** 的架构：即在执行敏感文件修改或终端命令前，先暂停并向 ACP 客户端发送 `session/request_permission`，拿到客户端返回的 `allow_once` / `allow_always` 后由 `agy` 自身完成落盘或命令执行。
   - 尽管 `agy` 不主动回调 `fs/*` 与 `terminal/*`，我们在客户端中依然按标准规范预留这两类处理器接口，使客户端同时具备通用 ACP 兼容性。
4. **`session/new` 真实返回的会话配置模型**：
   - `models`：包含 `currentModelId`（默认 `gemini-4-carbon-medium`）及 29 个 `availableModels`；
   - `modes`：包含 `default`（默认，修改与执行命令前询问权限）、`accept-edits`（自动批准工作区文件编辑）、`auto`（自动批准编辑与安全命令）、`plan`（先规划再执行）四种模式；
   - `configOptions`：遵循 ACP 统一配置项规范，提供 `model`、`thought_level`（`low` / `medium` / `high`）、`mode` 三个下拉配置项。

---

## 3. 核心工程挑战与关键架构设计决策

在明确了协议面貌后，我们在客户端架构上做出了五项关键设计决策：

### 决策一：为什么采用“原生异步 JSON-RPC 引擎 + 官方 SDK 对照”双层架构？

- 如果**只使用官方 `agent-client-protocol` SDK**：传输层与 Pydantic 反序列化被高度封装，实验者很难直观看到 stdio 管道上流动的原始 JSON-RPC 2.0 报文，而且 SDK 对部分 Agent 专有扩展（如 `session/resume`、`additionalDirectories`、`elicitation/create`）的暴露不如原生调用直接。
- 如果**只手写原生 JSON-RPC 客户端**：又缺少对官方生态标准接入范式（`spawn_agent_process`、`acp.Client` 回调重载）的参照。
- **最终方案**：以零黑盒的原生 `asyncio` JSON-RPC 2.0 客户端（配合实时双向抓包器 `WireLogger`，同时输出彩色终端摘要与 `.jsonl` 原始报文日志）作为实验主力，并单独提供一份精炼的 `sdk_demo.py` 使用官方 `agent-client-protocol>=1.0.0` 完成对照验证。

### 决策二：如何避免双向 JSON-RPC over Stdio 的经典死锁？

这是实现 ACP 客户端最容易踩坑的地方：
```text
客户端调用 await session_prompt() ──等待 id=5 的 Response──┐
                                                          │
agy acp 在处理 id=5 期间反向发送 id=101 session/request_permission ──► 客户端 stdout 读取协程
```
- **错误写法**：如果客户端的 `_read_stdout_loop` 读取协程在收到服务端发来的反向请求（同时含有 `method` 和 `id`）时，直接在循环内 `await handler()`（甚至在交互式 REPL 中等待用户输入），而该 handler 内部有任何依赖后续消息泵的逻辑，或者阻塞了后续通知帧读取，就会造成管道积压甚至死锁；更严重的是，如果在同步阻塞模式下一边写一边读单个请求响应而忽略中间插入的反向请求，`session/prompt` 将永远等不到结束响应！
- **正确解法**：
  1. 单独启动后台协程 `_read_stdout_loop` 持续非阻塞消费 `proc.stdout` 的每一行 JSON；
  2. 根据消息特征精确三分流：
     - 仅有 `id`（含 `result` 或 `error`） -> 客户端发出的 RPC 响应，唤醒 `_pending_futures[id]`；
     - 仅有 `method`（无 `id`） -> 服务端单向通知（如 `session/update`），推入事件回调与录制流；
     - **同时有 `method` 与 `id`** -> 服务端反向 RPC 请求（如 `session/request_permission`、`elicitation/create`），立即通过 `asyncio.create_task` 派生独立协程执行回调策略，并通过带 `asyncio.Lock` 保护的 `_write_json` 将反向响应写回 `proc.stdin`。

### 决策三：大帧缓冲与多模态无外部依赖测试

- `asyncio.create_subprocess_exec` 默认的 `StreamReader` 单行上限仅为 **64 KiB**（`65536` 字节）！一旦 `session/new` 返回庞大的模型元数据、或者工具输出长文本 diff、图片 Base64 数据块，默认缓冲区会直接抛出 `asyncio.LimitOverrunError: Separator is not found, and chunk exceed the limit`。
- **解法**：创建子进程时显式传入 `limit=16 * 1024 * 1024`（16 MiB），彻底消除大 JSON 帧截断隐患。
- **多模态图片测试零依赖构造**：为了测试 `promptCapabilities.image == true` 而不引入庞大的 `Pillow` 图像处理库，直接利用 Python 标准库 `zlib` + `struct` 按 PNG 二进制规范（签名 + `IHDR` + `IDAT` + `IEND` CRC32）在内存中实时编码一张 `32x32` 纯红色 PNG 图片转为 Base64 发送给 `agy acp`，让模型回答图片颜色，既轻量又极具可重复性。

### 决策四：真实端到端测试的速度、配额与沙箱安全

- **自动降档为轻量快速模型**：默认 `gemini-4-carbon-medium` 推理较深，跑完 7 个真实端到端场景耗时较长且消耗高阶模型配额。客户端提供 `prefer_fast_model()` 辅助方法，在新建会话后自动从会话支持的模型与 `configOptions` 中挑选 `gemini-3.8-flash-low`（或 `gemini-3.8-flash` + `thought_level=low`），使全套端到端测试在几十秒内轻快完成。
- **隔离沙箱工作区**：凡涉及写文件或拒绝写文件的权限测试（场景 S6），统一在 `tempfile.TemporaryDirectory()` 创建临时沙箱目录作为会话 `cwd`，并在 `finally` 块中调用 `session/close` 与优雅终止子进程，确保项目仓库干净无残留。

### 决策五：自动化测试套件 + 交互式 REPL 双形态互补

- **自动化实验套件 (`acp-suite` & `pytest`)**：把 ACP 的全部关键能力固化为 **S1 ~ S7 七大可重复验证场景**（握手能力发现、会话生命周期与附加目录、模式/模型/思考深度切换、多类型 Prompt 与流式消息、会话持久化恢复记忆、工具权限允许与拒绝对比、流式生成中途 `session/cancel` 取消），每次运行都能生成清晰的通过率报告与完整抓包文件。
- **交互式调试终端 (`acp-repl`)**：支持开发者在命令行里通过 `/mode`、`/model`、`/perm ask`、`/wire raw`、`Ctrl+C`（映射为 `session/cancel` 而非粗暴杀死进程）亲手把玩每一条 ACP 指令，直观感受编辑器/IDE（如 Zed、VS Code 插件）是如何在底层驱动 AI Agent 的。

---

## 4. 真机联调过程中的三大实测新发现与自适应演进

在首轮驱动真实 `Antigravity ACP Server v1.5.10` 执行 S1~S7 抓包联调时，我们观察到了三个仅靠阅读静态文档极难察觉的真实行为，并据此完善了实验代码：

### 发现一：宿主机全局 `settings.json` 中 `"toolPermission": "always-proceed"` 的最高优先级

- **现象**：首轮运行 S6 时，即便未传 `--dangerously-skip-permissions` 且显式调用 `session/set_mode(modeId="default")`（乃至切换到 `accept-edits`、`auto` 模式执行 `rm`），`agy acp` 依然直接下发 `tool_call(in_progress)` -> `tool_call_update(completed)` 完成落盘，没有发起 `session/request_permission`。
- **根因定位**：检查宿主机 `~/.gemini/antigravity-cli/settings.json` 发现配置了 `"toolPermission": "always-proceed"`。在 `agy` 内部，`always-proceed` 等价于全局级别的“Agent never asks review”，优先级高于单会话 `modeId`。
- **工程对策**：
  1. 绝不擅自篡改用户宿主机的全局 `~/.gemini/antigravity-cli/settings.json`；
  2. 在 `scenarios.py` 中增加只读检测函数 `detect_host_tool_permission()`：当宿主机处于默认 `request-review` 时，完整断言 `session/request_permission` 的 `allow_once` 放行与 `reject_once` 阻断；当宿主机配置为 `always-proceed` 时，验证工具状态通知流与沙箱落盘，同时结合离线 Mock 子进程单测（`tests/test_unit_protocol.py`）覆盖 `session/request_permission` 的报文级双向闭环。

### 发现二：`clientCapabilities.elicitation` 能力协商与优雅降级机制

- **实验对照**：
  1. 当客户端在 `initialize` 握手中声明 `"elicitation": {"form": {}, "url": {}}` 时，一旦 Agent 调用交互式提问工具（如 `ask_question`），`agy acp` 会将工具状态置为 `status="pending"`，并立即通过 stdio 向客户端发送服务端反向 JSON-RPC 请求 **`elicitation/create`**（携带标准 JSON Schema `oneOf` 选项表）；客户端返回 `{"action": "accept", "content": {"q1": "2"}}` 或 `{"action": "decline"}` 后，Agent 在同一轮次内无缝继续推理！
  2. 对照实验中，若客户端在 `initialize` 时**省略** `elicitation` 能力声明，`agy acp` 检测到客户端不支持表单交互，会自动**优雅降级**为通过 `agent_message_chunk` 直接输出 Markdown 文本选项列表并结束当前轮次（`stopReason: "end_turn"`），不会抛出未实现方法错误。
- **工程价值**：这为我们提供了一个**不受宿主机 `toolPermission: always-proceed` 影响、100% 稳定触发服务端 -> 客户端反向 JSON-RPC 调用**的绝佳实验载体。因此我们将 `elicitation/create` 的 `accept`（指定非默认选项）与 `decline`（拒绝回答）双向闭环同时纳入了 S6、`sdk_demo.py` 与交互式 `acp-repl` 中。

### 发现三：`embeddedContext` 内嵌资源的 URI 命名对 Agent 行为的影响

- **现象**：在 S4b 测试内嵌上下文块（`{"type": "resource", "resource": {"uri": "file:///workspace/virtual_spec.txt", "text": "..."}}`）时，抓包日志显示模型看到 `file:///workspace/...` 路径后，先尝试调用文件读取和 `find`/`grep` 工具去宿主机磁盘寻找该虚构路径，失败后才回退读取消息内嵌文本，导致单轮耗时达 ~30 秒。
- **优化**：将纯内存内嵌上下文块的 URI 改为语义明确的虚拟协议头 `embedded://context/spec_snippet.txt` 并在 Prompt 中指明直接读取内嵌资源，S4 全场景总耗时从 **39.05 秒骤降至约 7 秒**，抓包序列也更加干净纯粹。

### 发现四：官方 Python SDK (`agent-client-protocol 1.0.0`) 的 `use_unstable_protocol` 门控开关

- **现象**：在 `sdk_demo.py` 中即使客户端在 `ClientCapabilities` 中声明了 `ElicitationCapabilities` 并重写了 `Client.create_elicitation`，`acp.connection` 默认仍会拦截 `elicitation/create` 并打印警告：
  `UserWarning: The method elicitation/create is part of the unstable protocol, please enable use_unstable_protocol flag to use it.`（有趣的是，`agy acp` 收到 SDK 返回的方法未启用错误后，再次展现了极强的容错性——自动降级把选项打印成了普通 Markdown 回复）。
- **解法**：在调用 `acp.spawn_agent_process(..., use_unstable_protocol=True)` 时显式传入 `use_unstable_protocol=True`，即可彻底打通官方 SDK 的双向 `create_elicitation` 回调链路。
