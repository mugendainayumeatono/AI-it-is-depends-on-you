"""交互式 ACP 协议调试终端 (`acp-repl`)。

自动拉起 `agy acp` 并提供斜杠命令，供开发者手动测试会话管理、模式/模型切换、
终端实时权限弹窗审批、富内容 Prompt 以及按 Ctrl+C 发送 `session/cancel`。
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import mimetypes
import signal
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.panel import Panel

from acp_lab.raw_client import AgyAcpClient, select_permission_outcome
from acp_lab.wire_logger import WireMode

HELP_TEXT = """[bold cyan]可用调试命令:[/bold cyan]
  [green]/help[/green]                        显示本帮助说明
  [green]/info[/green]                        查看服务端能力与当前会话状态
  [green]/sessions[/green]                    调用 session/list 查看最近会话列表
  [green]/new [cwd][/green]                   创建新会话（可选指定工作目录）
  [green]/resume <session_id>[/green]         调用 session/resume 恢复历史会话
  [green]/load <session_id>[/green]           调用 session/load 加载历史会话
  [green]/close[/green]                       调用 session/close 关闭当前会话
  [green]/mode <id>[/green]                   调用 session/set_mode (default | accept-edits | auto | plan)
  [green]/model <model_id>[/green]            调用 session/set_model 切换具体模型 ID
  [green]/thought <low|medium|high>[/green]   调用 session/set_config_option 切换思考等级
  [green]/perm <ask|allow|reject>[/green]     切换收到 session/request_permission 时的处理方式
  [green]/embed <file> <prompt>[/green]       附带文件内容作为 embeddedContext 资源块发送
  [green]/image <img_file> <prompt>[/green]   附带本地图片 Base64 作为 image 内容块发送
  [green]/wire <off|summary|raw>[/green]      动态切换底层 JSON-RPC 2.0 报文实时打印级别
  [green]/quit[/green] 或 [green]/exit[/green]               关闭会话并退出 REPL
  [dim]提示: 在模型流式输出期间按 Ctrl+C 会发送 `session/cancel` 中断当前轮次而不会退出程序。[/dim]"""


class InteractiveRepl:
    """面向开发者的交互式 ACP 客户端终端。"""

    def __init__(self, *, workspace: Path, wire_mode: WireMode = "summary") -> None:
        self.console = Console()
        self.workspace = workspace.resolve()
        self.perm_mode: str = "ask"  # ask | allow | reject
        self.client = AgyAcpClient(
            wire_mode=wire_mode,
            permission_policy=self._interactive_permission_handler,
            elicitation_callback=self._interactive_elicitation_handler,
        )
        self.init_info: dict[str, Any] = {}
        self.session_info: dict[str, Any] = {}
        self.session_id: str = ""

    async def _ainput(self, prompt_str: str) -> str:
        return await asyncio.to_thread(input, prompt_str)

    async def _interactive_permission_handler(self, params: dict[str, Any]) -> dict[str, Any]:
        tool_call = params.get("toolCall", {})
        options = params.get("options", [])
        title = tool_call.get("title") or tool_call.get("kind") or tool_call.get("toolCallId", "unknown")

        if self.perm_mode == "allow":
            decision = select_permission_outcome(options, "allow_once")
            self.console.print(f"\n[magenta][Auto-Allow Permission] {title} -> {decision}[/magenta]")
            return decision
        if self.perm_mode == "reject":
            decision = select_permission_outcome(options, "reject_once")
            self.console.print(f"\n[magenta][Auto-Reject Permission] {title} -> {decision}[/magenta]")
            return decision

        self.console.print(
            Panel.fit(
                f"[bold yellow]Agent 请求执行敏感操作:[/bold yellow] {title}\n"
                + "\n".join(
                    f"  [{idx}] {opt.get('name')} (optionId={opt.get('optionId')}, kind={opt.get('kind')})"
                    for idx, opt in enumerate(options, start=1)
                ),
                title="session/request_permission",
            )
        )
        ans = (await self._ainput(f"请选择序号 [1-{len(options)}，回车默认 1，c 取消]: ")).strip().lower()
        if ans == "c" or not options:
            return {"outcome": {"outcome": "cancelled"}}
        try:
            idx = max(1, min(len(options), int(ans))) - 1 if ans else 0
        except ValueError:
            idx = 0
        return {"outcome": {"outcome": "selected", "optionId": options[idx]["optionId"]}}

    async def _interactive_elicitation_handler(self, params: dict[str, Any]) -> dict[str, Any]:
        schema = params.get("requestedSchema", {})
        props = schema.get("properties", {})
        answers: dict[str, Any] = {}
        self.console.print(Panel.fit(str(params.get("message", "Agent 提问")), title="elicitation/create"))
        for field_name, prop in props.items():
            if field_name.endswith("_other"):
                continue
            title = prop.get("title", field_name)
            one_of = prop.get("oneOf", [])
            if one_of:
                for opt in one_of:
                    self.console.print(f"  [{opt.get('const')}] {opt.get('title')}")
                ans = (await self._ainput(f"{title} (输入编号，c 取消): ")).strip()
                if ans.lower() == "c":
                    return {"action": "decline"}
                answers[field_name] = ans or one_of[0]["const"]
            else:
                ans = (await self._ainput(f"{title} (输入文本，c 取消): ")).strip()
                if ans.lower() == "c":
                    return {"action": "decline"}
                answers[field_name] = ans
        return {"action": "accept", "content": answers}

    async def run(self) -> None:
        async with self.client:
            self.init_info = await self.client.initialize()
            self.session_info = await self.client.session_new(self.workspace)
            self.session_id = self.session_info["sessionId"]
            fast_cfg = await self.client.prefer_fast_model(self.session_info)

            agent_info = self.init_info.get("agentInfo", {})
            self.console.print(
                Panel.fit(
                    f"已连接: [bold green]{agent_info.get('name')} v{agent_info.get('version')}[/bold green]\n"
                    f"当前会话: [cyan]{self.session_id}[/cyan]\n"
                    f"工作目录: {self.workspace}\n"
                    f"默认模型配置: {fast_cfg} | 权限模式: [yellow]{self.perm_mode}[/yellow] | "
                    f"抓包日志: {self.client.wire.log_path}\n"
                    f"输入 [bold]/help[/bold] 查看全部 ACP 调试指令。",
                    title="Antigravity ACP Interactive Debugger",
                )
            )

            while True:
                try:
                    raw = (await self._ainput(f"\n[acp:{self.session_id[:8] or 'none'}]> ")).strip()
                except (EOFError, KeyboardInterrupt):
                    self.console.print("\n正在退出 REPL...")
                    break

                if not raw:
                    continue
                if raw in ("/quit", "/exit"):
                    break
                if raw.startswith("/"):
                    await self._handle_slash_command(raw)
                else:
                    await self._run_prompt_with_ctrl_c([{"type": "text", "text": raw}])

            if self.session_id:
                try:
                    await self.client.session_close(self.session_id)
                except Exception:
                    pass

    async def _handle_slash_command(self, raw: str) -> None:
        parts = raw.split(maxsplit=2)
        cmd = parts[0].lower()

        try:
            if cmd == "/help":
                self.console.print(HELP_TEXT)
            elif cmd == "/info":
                self.console.print(
                    {
                        "agentInfo": self.init_info.get("agentInfo"),
                        "sessionId": self.session_id,
                        "workspace": str(self.workspace),
                        "perm_mode": self.perm_mode,
                        "wire_mode": self.client.wire.mode,
                        "wire_log": str(self.client.wire.log_path),
                        "modes": self.session_info.get("modes"),
                        "configOptions": self.session_info.get("configOptions"),
                    }
                )
            elif cmd == "/sessions":
                res = await self.client.session_list()
                sessions = res.get("sessions", [])
                self.console.print(f"共查询到 {len(sessions)} 个会话:")
                for s in sessions[:15]:
                    self.console.print(" ", s)
            elif cmd == "/new":
                target_cwd = Path(parts[1]).resolve() if len(parts) >= 2 else self.workspace
                if self.session_id:
                    await self.client.session_close(self.session_id)
                self.workspace = target_cwd
                self.session_info = await self.client.session_new(self.workspace)
                self.session_id = self.session_info["sessionId"]
                await self.client.prefer_fast_model(self.session_info)
                self.console.print(f"[green]已新建会话:[/green] {self.session_id} (cwd={self.workspace})")
            elif cmd in ("/resume", "/load") and len(parts) >= 2:
                target_id = parts[1].strip()
                if cmd == "/resume":
                    self.session_info = await self.client.session_resume(target_id, self.workspace)
                else:
                    self.session_info = await self.client.session_load(target_id, self.workspace)
                self.session_id = target_id
                self.console.print(f"[green]{cmd} 成功:[/green] sessionId={self.session_id}")
            elif cmd == "/close":
                if self.session_id:
                    await self.client.session_close(self.session_id)
                    self.console.print(f"[yellow]已关闭会话:[/yellow] {self.session_id}")
                    self.session_id = ""
            elif cmd == "/mode" and len(parts) >= 2:
                res = await self.client.session_set_mode(self.session_id, parts[1].strip())
                self.console.print(f"[green]已切换模式:[/green] {parts[1].strip()} -> {res}")
            elif cmd == "/model" and len(parts) >= 2:
                res = await self.client.session_set_model(self.session_id, parts[1].strip())
                self.console.print(f"[green]已切换模型:[/green] {parts[1].strip()} -> {res}")
            elif cmd == "/thought" and len(parts) >= 2:
                res = await self.client.session_set_config_option(
                    self.session_id, "thought_level", parts[1].strip()
                )
                self.console.print(f"[green]已切换思考深度:[/green] {parts[1].strip()} -> {res}")
            elif cmd == "/perm" and len(parts) >= 2 and parts[1] in ("ask", "allow", "reject"):
                self.perm_mode = parts[1]
                self.console.print(f"[green]权限回调策略已设为:[/green] {self.perm_mode}")
            elif cmd == "/wire" and len(parts) >= 2 and parts[1] in ("off", "summary", "raw"):
                self.client.wire.mode = parts[1]  # type: ignore[assignment]
                self.console.print(f"[green]JSON-RPC 抓包回显已设为:[/green] {parts[1]}")
            elif cmd == "/embed" and len(parts) >= 3:
                fpath = Path(parts[1]).expanduser().resolve()
                text = fpath.read_text(encoding="utf-8")
                blocks = [
                    {
                        "type": "resource",
                        "resource": {
                            "uri": fpath.as_uri(),
                            "mimeType": "text/plain",
                            "text": text,
                        },
                    },
                    {"type": "text", "text": parts[2]},
                ]
                await self._run_prompt_with_ctrl_c(blocks)
            elif cmd == "/image" and len(parts) >= 3:
                ipath = Path(parts[1]).expanduser().resolve()
                mime = mimetypes.guess_type(ipath.name)[0] or "image/png"
                b64 = base64.b64encode(ipath.read_bytes()).decode("ascii")
                blocks = [
                    {"type": "image", "mimeType": mime, "data": b64},
                    {"type": "text", "text": parts[2]},
                ]
                await self._run_prompt_with_ctrl_c(blocks)
            else:
                self.console.print("[red]未知命令或参数不足，输入 /help 查看用法。[/red]")
        except Exception as exc:
            self.console.print(f"[bold red]命令执行失败:[/bold red] {exc}")

    async def _run_prompt_with_ctrl_c(self, blocks: list[dict[str, Any]]) -> None:
        if not self.session_id:
            self.console.print("[red]当前没有活动会话，请先使用 /new 创建会话。[/red]")
            return

        loop = asyncio.get_running_loop()

        def _sigint_handler() -> None:
            self.console.print("\n[bold yellow][Ctrl+C] 正在发送 session/cancel 通知...[/bold yellow]")
            asyncio.create_task(self.client.session_cancel(self.session_id))

        try:
            loop.add_signal_handler(signal.SIGINT, _sigint_handler)
            sig_installed = True
        except NotImplementedError:
            sig_installed = False

        def _stream_printer(params: dict[str, Any]) -> None:
            if self.client.wire.mode != "off":
                return  # 若已开启报文回显则避免与流式文本混印
            upd = params.get("update", {})
            if upd.get("sessionUpdate") == "agent_message_chunk":
                txt = upd.get("content", {}).get("text", "")
                if txt:
                    self.console.print(txt, end="", highlight=False)

        try:
            turn = await self.client.session_prompt(self.session_id, blocks, on_update=_stream_printer)
            if self.client.wire.mode != "off" and turn.assistant_text:
                self.console.print(Panel(turn.assistant_text, title=f"Assistant ({turn.stop_reason})"))
            else:
                self.console.print(f"\n[dim][stopReason={turn.stop_reason}][/dim]")
        except Exception as exc:
            self.console.print(f"\n[bold red]Prompt 失败:[/bold red] {exc}")
        finally:
            if sig_installed:
                loop.remove_signal_handler(signal.SIGINT)


def main() -> None:
    parser = argparse.ArgumentParser(description="启动交互式 Antigravity ACP 调试终端")
    parser.add_argument("--cwd", type=Path, default=Path.cwd(), help="会话初始工作目录")
    parser.add_argument(
        "--wire",
        choices=["off", "summary", "raw"],
        default="summary",
        help="初始底层报文打印模式 (默认: summary)",
    )
    args = parser.parse_args()
    repl = InteractiveRepl(workspace=args.cwd, wire_mode=args.wire)
    asyncio.run(repl.run())


if __name__ == "__main__":
    main()
