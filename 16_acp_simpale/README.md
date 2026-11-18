# 16_acp_simpale — Antigravity ACP (Agent Client Protocol) 实验与全功能测试套件

本项目使用 **Python 3.12** 与 **`uv`** 构建，自动拉起本机 `agy acp`（`Antigravity ACP Server`，基于 JSON-RPC 2.0 over stdio），同时从**原生双向报文抓包层**与**官方 `agent-client-protocol` (v1.0.0) Python SDK 层**全面实验与验证 ACP 协议的各项能力。

---

## 设计与思考过程文档

项目目录下的 `docs/` 保存了完整的设计与调研思考文档：
- **[docs/01_thinking_and_protocol_research.md](./docs/01_thinking_and_protocol_research.md)**：前期技术调研脉络、`agy` 二进制路由静态核验、最小握手探针、双向 JSON-RPC over stdio 防死锁推演，以及真机联调中发现的四大实测规律（全局 `toolPermission` 优先级、`elicitation` 能力协商优雅降级、内嵌资源虚拟 URI 加速、官方 SDK `use_unstable_protocol` 开关）。
- **[docs/02_implementation_plan.md](./docs/02_implementation_plan.md)**：架构分层图、双向交互时序图、目录职责与 S1~S7 七大实验场景设计规范。

---

## 工程目录结构

```text
16_acp_simpale/
├── .python-version                  # 锁定 Python 3.12
├── pyproject.toml                   # uv 项目配置与 CLI 脚本入口 (acp-suite / acp-repl / acp-sdk-demo)
├── docs/
│   ├── 01_thinking_and_protocol_research.md
│   └── 02_implementation_plan.md
├── src/acp_lab/
│   ├── wire_logger.py               # 双向 JSON-RPC 2.0 报文分级染色打印与 JSONL 抓包器
│   ├── raw_client.py                # 原生 asyncio JSON-RPC 2.0 客户端与非阻塞反向回调引擎
│   ├── scenarios.py                 # S1 ~ S7 七大 ACP 功能自动化实验编排与汇总报表
│   ├── sdk_demo.py                  # 官方 agent-client-protocol (v1.0.0) Python SDK 对照实现
│   └── repl.py                      # 交互式 ACP 命令行调试终端
└── tests/
    ├── test_unit_protocol.py        # 基于内置 Mock ACP 子进程的离线协议引擎单元测试
    └── test_e2e_agy_acp.py          # 连接真实 agy acp 的全功能端到端 pytest 测试套件
```

---

## 快速上手

### 1. 安装依赖

确保本机已安装 `agy`（且已完成登录）和 `uv`，在项目根目录执行：

```bash
uv sync
```

### 2. 一键运行 7 大 ACP 自动化实验场景 (`acp-suite`)

```bash
# 运行 S1 ~ S7 全量场景并输出实验报告表
uv run acp-suite

# 运行指定场景并实时打印底层 JSON-RPC 报文摘要
uv run acp-suite --only S1,S4,S6 --wire summary

# 打印完整原始 JSON-RPC 2.0 报文帧
uv run acp-suite --only S1 --wire raw
```

每次运行收发的所有原始 JSON-RPC 帧会自动落盘至 `logs/acp_wire_*.jsonl`，每行格式如下：

```json
{"seq": 1, "direction": "C->A", "kind": "REQ", "payload": {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {...}}}
{"seq": 20, "direction": "A->C", "kind": "REV-REQ", "payload": {"jsonrpc": "2.0", "id": 1, "method": "elicitation/create", "params": {...}}}
{"seq": 21, "direction": "C->A", "kind": "REV-RES", "payload": {"jsonrpc": "2.0", "id": 1, "result": {"action": "accept", "content": {"q1": "2"}}}}
```

### 3. 运行官方 Python SDK 对照示例 (`acp-sdk-demo`)

```bash
uv run acp-sdk-demo
```

演示使用 `acp.spawn_agent_process(..., use_unstable_protocol=True)` 与 `acp.Client` 子类完成握手、轻量模型切换、流式对话、沙箱文件写入以及服务端 `elicitation/create` 反向回调。

### 4. 启动交互式 ACP 调试终端 (`acp-repl`)

```bash
uv run acp-repl
```

常用调试斜杠命令：
- `/info`：查看服务端能力与当前会话模型/模式配置
- `/sessions`：调用 `session/list` 查看历史会话列表
- `/new [cwd]` / `/resume <session_id>` / `/load <session_id>` / `/close`：会话全生命周期操作
- `/mode <default|accept-edits|auto|plan>`：动态切换会话运行模式
- `/model <model_id>` / `/thought <low|medium|high>`：动态切换模型与思考深度
- `/perm <ask|allow|reject>`：调整收到 `session/request_permission` 时的审批策略
- `/embed <filepath> <prompt>`：附带本地文件作为 `embeddedContext` 资源块发送
- `/image <png_path> <prompt>`：附带本地图片作为多模态 `image` 块发送
- `/wire <off|summary|raw>`：动态切换底层 JSON-RPC 2.0 报文实时打印级别
- 流式输出期间按 `Ctrl+C`：自动发送 `session/cancel` 中断当前生成轮次而不退出程序

### 5. 运行自动化测试套件 (`pytest`)

```bash
# 运行全部 9 项离线单测 + 真机端到端测试
uv run pytest -v

# 仅运行毫秒级离线协议层单测（无需网络与模型配额）
uv run pytest tests/test_unit_protocol.py -v
```
