"""使用 PyPI 官方 `agent-client-protocol` (v1.0.0) Python SDK 访问 `agy acp` 的对照示例。

演示如何通过高层强类型 Pydantic 模型与 `spawn_agent_process` 完成：
1. 自动拉起 `agy acp --stdio --disable-telemetry`
2. `initialize` 协议握手与能力声明（含 `fs`、`terminal` 与 `elicitation` 表单交互能力）
3. `new_session` 创建隔离会话并切换轻量 Flash 模型
4. `prompt` 流式对话、写文件工具追踪与 `request_permission` / `create_elicitation` 服务端反向回调闭环
"""

from __future__ import annotations

import asyncio
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import acp
from acp.schema import (
    AcceptElicitationResponse,
    AgentMessageChunk,
    AgentThoughtChunk,
    AllowedOutcome,
    ClientCapabilities,
    CreateElicitationResponse,
    DeniedOutcome,
    ElicitationCapabilities,
    ElicitationFormCapabilities,
    FileSystemCapabilities,
    Implementation,
    PermissionOption,
    RequestPermissionResponse,
    TextContentBlock,
    ToolCallProgress,
    ToolCallStart,
    ToolCallUpdate,
)
from rich.console import Console
from rich.panel import Panel


@dataclass
class SdkDemoClient(acp.Client):
    """基于官方 `acp.Client` 抽象基类实现的客户端回调处理器。"""

    allow_tools: bool = True
    verbose: bool = True
    console: Console = field(default_factory=Console)
    message_chunks: list[str] = field(default_factory=list)
    thought_chunks: list[str] = field(default_factory=list)
    tool_titles: list[str] = field(default_factory=list)
    permission_events: list[str] = field(default_factory=list)
    elicitation_events: list[dict[str, Any]] = field(default_factory=list)

    def reset_turn_buffers(self) -> None:
        self.message_chunks.clear()
        self.thought_chunks.clear()
        self.tool_titles.clear()

    async def session_update(self, session_id: str, update: Any, **kwargs: Any) -> None:
        if isinstance(update, AgentMessageChunk):
            text = getattr(update.content, "text", "")
            self.message_chunks.append(text)
            if self.verbose and text:
                self.console.print(text, end="", highlight=False)
        elif isinstance(update, AgentThoughtChunk):
            text = getattr(update.content, "text", "")
            self.thought_chunks.append(text)
        elif isinstance(update, (ToolCallStart, ToolCallProgress)):
            title = getattr(update, "title", None) or getattr(update, "tool_call_id", "tool")
            status = getattr(update, "status", "")
            self.tool_titles.append(f"{title}:{status}")
            if self.verbose:
                self.console.print(f"\n[dim cyan][SDK ToolUpdate] {title} -> {status}[/dim cyan]")

    async def request_permission(
        self,
        session_id: str,
        tool_call: ToolCallUpdate,
        options: list[PermissionOption],
        **kwargs: Any,
    ) -> RequestPermissionResponse:
        target_prefix = "allow" if self.allow_tools else "reject"
        chosen = next((o for o in options if str(o.kind).startswith(target_prefix)), None)
        if chosen is None and options:
            chosen = options[0]

        title = getattr(tool_call, "title", None) or tool_call.tool_call_id
        if chosen is not None:
            self.permission_events.append(f"{title}:{chosen.kind}({chosen.option_id})")
            if self.verbose:
                self.console.print(
                    f"\n[bold magenta][SDK PermissionCallback][/bold magenta] "
                    f"tool={title!r} -> selected option={chosen.option_id!r} (kind={chosen.kind})"
                )
            return RequestPermissionResponse(outcome=AllowedOutcome(option_id=chosen.option_id))

        self.permission_events.append(f"{title}:cancelled")
        return RequestPermissionResponse(outcome=DeniedOutcome())

    async def create_elicitation(
        self,
        message: str,
        mode: Any,
        **kwargs: Any,
    ) -> CreateElicitationResponse:
        """响应服务端通过 `ask_question` 反向发起的 `elicitation/create` 结构化表单提问。"""
        req_schema = kwargs.get("requested_schema")
        props = getattr(req_schema, "properties", None) or {}
        answers: dict[str, str | int | float | bool | list[str]] = {}

        for field_name, prop in props.items():
            if field_name.endswith("_other"):
                continue
            one_of = getattr(prop, "one_of", None)
            if one_of:
                # 优先挑选最后一个选项以证明是客户端真实选择的结果
                chosen_opt = one_of[-1]
                answers[field_name] = chosen_opt.const
            else:
                answers[field_name] = "canary"

        self.elicitation_events.append({"message": message, "answers": answers})
        if self.verbose:
            self.console.print(
                f"\n[bold magenta][SDK ElicitationCallback][/bold magenta] "
                f"message={message!r} -> returning AcceptElicitationResponse({answers})"
            )
        return AcceptElicitationResponse(content=answers)


async def run_sdk_demo(*, verbose: bool = True) -> dict[str, Any]:
    """运行完整的官方 SDK 对照演示并返回关键指标字典（同时可供 pytest 断言）。"""
    console = Console()
    agy_bin = shutil.which("agy")
    if not agy_bin:
        raise FileNotFoundError("未找到 `agy` 可执行文件。")

    client = SdkDemoClient(allow_tools=True, verbose=verbose, console=console)

    with tempfile.TemporaryDirectory(prefix="acp_sdk_demo_") as tmp_dir:
        sandbox = Path(tmp_dir)
        async with acp.spawn_agent_process(
            client,
            agy_bin,
            "acp",
            "--stdio",
            "--disable-telemetry",
            transport_kwargs={"limit": 16 * 1024 * 1024},
            use_unstable_protocol=True,
        ) as (conn, _proc):
            init_res = await conn.initialize(
                protocol_version=acp.PROTOCOL_VERSION,
                client_capabilities=ClientCapabilities(
                    fs=FileSystemCapabilities(read_text_file=True, write_text_file=True),
                    terminal=True,
                    elicitation=ElicitationCapabilities(form=ElicitationFormCapabilities()),
                ),
                client_info=Implementation(name="acp-sdk-demo-client", version="0.1.0"),
            )
            agent_name = init_res.agent_info.name if init_res.agent_info else "unknown"
            agent_ver = init_res.agent_info.version if init_res.agent_info else "unknown"

            if verbose:
                console.print(
                    Panel.fit(
                        f"已通过官方 [bold]agent-client-protocol[/bold] SDK 连接至 "
                        f"[green]{agent_name} v{agent_ver}[/green]\n"
                        f"协议版本: {init_res.protocol_version} | 临时沙箱: {sandbox}",
                        title="Official Python SDK Demo",
                    )
                )

            sess = await conn.new_session(cwd=str(sandbox), mcp_servers=[])
            session_id = sess.session_id

            await conn.set_config_option(config_id="model", session_id=session_id, value="gemini-3.8-flash")
            await conn.set_config_option(config_id="thought_level", session_id=session_id, value="low")
            await conn.set_session_mode(session_id=session_id, mode_id="default")

            # Turn 1：纯文本快速对话
            if verbose:
                console.print("\n[bold yellow]>>> Turn 1: 基础问答[/bold yellow]")
            client.reset_turn_buffers()
            r1 = await conn.prompt(
                session_id=session_id,
                prompt=[TextContentBlock(text="请用一句话回答：ACP 协议的全称是什么？只输出一句话。")],
            )
            turn1_reply = "".join(client.message_chunks).strip()
            if verbose:
                console.print(f"\n[dim]stop_reason={r1.stop_reason}[/dim]")

            # Turn 2：触发写文件工具流
            target_file = sandbox / "sdk_verified.txt"
            if verbose:
                console.print("\n[bold yellow]>>> Turn 2: 沙箱文件写入与工具状态回调[/bold yellow]")
            client.reset_turn_buffers()
            r2 = await conn.prompt(
                session_id=session_id,
                prompt=[
                    TextContentBlock(
                        text=(
                            f"请在当前工作目录 `{sandbox}` 下创建文件 `{target_file.name}`，"
                            "内容精确写入 `SDK_ACP_OK`，完成后简短告知我。"
                        )
                    )
                ],
            )
            file_created = target_file.exists()
            file_content = target_file.read_text(encoding="utf-8").strip() if file_created else ""
            if verbose:
                console.print(
                    f"\n[green]文件落盘校验:[/green] exists={file_created}, content={file_content!r}, "
                    f"stop_reason={r2.stop_reason}"
                )

            # Turn 3：触发服务端 -> 客户端双向反向 RPC (`create_elicitation`)
            if verbose:
                console.print("\n[bold yellow]>>> Turn 3: 服务端反向提问回调 (elicitation/create)[/bold yellow]")
            client.reset_turn_buffers()
            r3 = await conn.prompt(
                session_id=session_id,
                prompt=[
                    TextContentBlock(
                        text=(
                            "请调用 `ask_question` 工具向我提问选择一个发布轨道（选项：stable, canary），"
                            "拿到我的选择后在回复中原样写出我选的轨道名。"
                        )
                    )
                ],
            )
            turn3_reply = "".join(client.message_chunks).strip()
            if verbose:
                console.print(f"\n[dim]stop_reason={r3.stop_reason}[/dim]")

            await conn.close_session(session_id=session_id)

            return {
                "agent_name": agent_name,
                "agent_version": agent_ver,
                "protocol_version": init_res.protocol_version,
                "session_id": session_id,
                "turn1_reply": turn1_reply,
                "turn1_stop_reason": r1.stop_reason,
                "turn2_stop_reason": r2.stop_reason,
                "turn3_reply": turn3_reply,
                "turn3_stop_reason": r3.stop_reason,
                "tool_updates": list(client.tool_titles),
                "permission_events": list(client.permission_events),
                "elicitation_events": list(client.elicitation_events),
                "file_created": file_created,
                "file_content": file_content,
            }


def main() -> None:
    asyncio.run(run_sdk_demo(verbose=True))


if __name__ == "__main__":
    main()
