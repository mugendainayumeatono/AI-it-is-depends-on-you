"""原生 Asyncio JSON-RPC 2.0 over stdio 双向 ACP 客户端。

核心设计要点：
1. 自动以子进程方式拉起 `agy acp --stdio --disable-telemetry`（或自定义 Mock Agent 命令），
   设置 16 MiB 单行 StreamReader 上限，支持多模态图片 Base64 与长元数据帧。
2. 独立后台读取协程 `_read_stdout_loop` 对每一帧 JSON-RPC 消息三分流：
   - 客户端发起的 RPC 响应（含 id，无 method） -> 唤醒挂起的 Future；
   - 服务端单向通知（含 method，无 id，如 `session/update`） -> 分发给观察者；
   - 服务端反向 RPC 请求（同时含 id 与 method，如 `session/request_permission`、`elicitation/create`）
     -> 使用 `asyncio.create_task` 异步执行客户端处理器并回写响应，杜绝读写死锁。
"""

from __future__ import annotations

import asyncio
import base64
import json
import shutil
import struct
import zlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from acp_lab.wire_logger import WireLogger, WireMode

STREAM_LIMIT_BYTES = 16 * 1024 * 1024  # 16 MiB，防止大 JSON-RPC 帧触发 LimitOverrunError

PermissionCallback = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]
ElicitationCallback = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]
UpdateCallback = Callable[[dict[str, Any]], Awaitable[None] | None]


class JsonRpcError(RuntimeError):
    """JSON-RPC 2.0 标准错误异常封装。"""

    def __init__(self, code: int, message: str, data: Any = None, method: str = "") -> None:
        self.code = code
        self.rpc_message = message
        self.data = data
        self.method = method
        suffix = f" (data={data})" if data is not None else ""
        prefix = f"[{method}] " if method else ""
        super().__init__(f"{prefix}JSON-RPC Error {code}: {message}{suffix}")


@dataclass
class PromptTurnResult:
    """单次 `session/prompt` 轮次聚合结果（含回复全文、思维链、工具事件与更新列表）。"""

    response: dict[str, Any]
    stop_reason: str
    assistant_text: str
    thought_text: str
    updates: list[dict[str, Any]] = field(default_factory=list)
    tool_events: list[dict[str, Any]] = field(default_factory=list)
    permission_requests: list[dict[str, Any]] = field(default_factory=list)


def make_solid_png_base64(width: int = 32, height: int = 32, rgb: tuple[int, int, int] = (255, 0, 0)) -> str:
    """使用纯 Python 标准库动态编码指定纯色 PNG 并返回 Base64 字符串（零第三方图像库依赖）。"""

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)

    r, g, b = rgb
    raw_rows = b"".join(b"\x00" + bytes([r, g, b]) * width for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw_rows, level=9))
        + _chunk(b"IEND", b"")
    )
    return base64.b64encode(png_bytes).decode("ascii")


class AgyAcpClient:
    """面向 Antigravity `agy acp`（及通用 ACP 兼容 Agent）的原生异步客户端。"""

    def __init__(
        self,
        command: list[str] | None = None,
        *,
        cwd: str | Path | None = None,
        env: dict[str, str] | None = None,
        wire_mode: WireMode = "off",
        wire_log_dir: Path | None = Path("logs"),
        wire_prefix: str = "acp_wire",
        permission_policy: str | PermissionCallback = "allow_once",
        elicitation_callback: ElicitationCallback | None = None,
        default_timeout: float = 120.0,
    ) -> None:
        if command is None:
            agy_bin = shutil.which("agy")
            if not agy_bin:
                raise FileNotFoundError("未在 PATH 中找到 `agy` 可执行文件，请确认 Antigravity CLI 已安装。")
            command = [agy_bin, "acp", "--stdio", "--disable-telemetry"]

        self.command = list(command)
        self.cwd = str(cwd) if cwd is not None else None
        self.env = env
        self.default_timeout = default_timeout
        self.wire = WireLogger(mode=wire_mode, log_dir=wire_log_dir, prefix=wire_prefix)

        self.permission_policy: str | PermissionCallback = permission_policy
        self.elicitation_callback = elicitation_callback

        self._proc: asyncio.subprocess.Process | None = None
        self._next_id: int = 0
        self._write_lock = asyncio.Lock()
        self._pending: dict[int | str, tuple[str, asyncio.Future[Any]]] = {}
        self._stdout_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._bg_tasks: set[asyncio.Task[Any]] = set()

        self.stderr_lines: list[str] = []
        self.notifications: list[dict[str, Any]] = []
        self.permission_history: list[dict[str, Any]] = []
        self.elicitation_history: list[dict[str, Any]] = []
        self._update_listeners: list[UpdateCallback] = []

    async def __aenter__(self) -> AgyAcpClient:
        await self.start()
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.close()

    async def start(self) -> None:
        """启动 ACP Agent 子进程并挂载异步 stdout/stderr 消息读取协程。"""
        if self._proc is not None:
            return
        self._proc = await asyncio.create_subprocess_exec(
            *self.command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self.cwd,
            env=self.env,
            limit=STREAM_LIMIT_BYTES,
        )
        self._stdout_task = asyncio.create_task(self._read_stdout_loop(), name="acp-stdout-reader")
        self._stderr_task = asyncio.create_task(self._read_stderr_loop(), name="acp-stderr-reader")

    async def close(self) -> None:
        """优雅关闭子进程、等待后台协程退出并取消残余挂起请求。"""
        proc = self._proc
        if proc is None:
            return
        self._proc = None

        if proc.stdin and not proc.stdin.is_closing():
            try:
                proc.stdin.close()
                await proc.stdin.wait_closed()
            except Exception:
                pass

        try:
            await asyncio.wait_for(proc.wait(), timeout=3.0)
        except asyncio.TimeoutError:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()

        for task in (self._stdout_task, self._stderr_task, *list(self._bg_tasks)):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

        for _, (_, fut) in list(self._pending.items()):
            if not fut.done():
                fut.set_exception(ConnectionError("ACP 子进程连接已关闭"))
        self._pending.clear()

    def add_update_listener(self, callback: UpdateCallback) -> Callable[[], None]:
        """注册 `session/update` 实时监听函数，返回取消注册闭包。"""
        self._update_listeners.append(callback)

        def _remove() -> None:
            if callback in self._update_listeners:
                self._update_listeners.remove(callback)

        return _remove

    async def _write_message(self, kind: Any, payload: dict[str, Any]) -> None:
        if self._proc is None or self._proc.stdin is None:
            raise ConnectionError("ACP 子进程尚未启动或已关闭")
        raw = json.dumps(payload, ensure_ascii=False) + "\n"
        async with self._write_lock:
            self.wire.record("C->A", kind, payload)
            self._proc.stdin.write(raw.encode("utf-8"))
            await self._proc.stdin.drain()

    async def send_request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """向 ACP Agent 发送 JSON-RPC 2.0 Request 并等待匹配 ID 的结果。"""
        self._next_id += 1
        req_id = self._next_id
        payload: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
            "params": params if params is not None else {},
        }
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[Any] = loop.create_future()
        self._pending[req_id] = (method, fut)

        try:
            await self._write_message("REQ", payload)
            wait_sec = self.default_timeout if timeout is None else timeout
            result = await asyncio.wait_for(fut, timeout=wait_sec)
            return result if isinstance(result, dict) else {"value": result}
        finally:
            self._pending.pop(req_id, None)

    async def send_notification(self, method: str, params: dict[str, Any] | None = None) -> None:
        """向 ACP Agent 发送无需响应的 JSON-RPC 2.0 Notification（例如 `session/cancel`）。"""
        payload: dict[str, Any] = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params if params is not None else {},
        }
        await self._write_message("NOTIFY", payload)

    async def _read_stderr_loop(self) -> None:
        assert self._proc is not None and self._proc.stderr is not None
        while True:
            line = await self._proc.stderr.readline()
            if not line:
                break
            self.stderr_lines.append(line.decode("utf-8", errors="replace").rstrip("\n"))

    async def _read_stdout_loop(self) -> None:
        assert self._proc is not None and self._proc.stdout is not None
        try:
            while True:
                raw_line = await self._proc.stdout.readline()
                if not raw_line:
                    break
                text = raw_line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue
                try:
                    msg = json.loads(text)
                except json.JSONDecodeError:
                    self.stderr_lines.append(f"[non-json-stdout] {text}")
                    continue

                has_id = "id" in msg and msg["id"] is not None
                has_method = "method" in msg

                if has_id and has_method:
                    # 服务端反向调用客户端（如 session/request_permission / elicitation/create / fs/*）
                    self.wire.record("A->C", "REV-REQ", msg)
                    task = asyncio.create_task(self._handle_reverse_request(msg))
                    self._bg_tasks.add(task)
                    task.add_done_callback(self._bg_tasks.discard)
                elif has_id and not has_method:
                    # 客户端发出请求的响应
                    req_id = msg["id"]
                    pending_entry = self._pending.get(req_id)
                    req_method = pending_entry[0] if pending_entry else ""
                    if "error" in msg and msg["error"] is not None:
                        self.wire.record("A->C", "ERR", msg)
                        if pending_entry and not pending_entry[1].done():
                            err = msg["error"]
                            pending_entry[1].set_exception(
                                JsonRpcError(
                                    code=err.get("code", -32000),
                                    message=err.get("message", "Unknown error"),
                                    data=err.get("data"),
                                    method=req_method,
                                )
                            )
                    else:
                        self.wire.record("A->C", "RES", msg)
                        if pending_entry and not pending_entry[1].done():
                            pending_entry[1].set_result(msg.get("result", {}))
                elif has_method and not has_id:
                    # 服务端发来的异步单向通知（如 session/update）
                    self.wire.record("A->C", "NOTIFY", msg)
                    self.notifications.append(msg)
                    if msg.get("method") == "session/update":
                        params = msg.get("params", {})
                        for listener in list(self._update_listeners):
                            maybe_coro = listener(params)
                            if asyncio.iscoroutine(maybe_coro):
                                t = asyncio.create_task(maybe_coro)
                                self._bg_tasks.add(t)
                                t.add_done_callback(self._bg_tasks.discard)
        finally:
            # 若服务端意外退出，唤醒所有未决 Future 抛出 EOF 异常而不是死等超时
            for _, (m_name, fut) in list(self._pending.items()):
                if not fut.done():
                    stderr_tail = "\n".join(self.stderr_lines[-10:])
                    fut.set_exception(
                        ConnectionError(f"ACP 服务端在处理 `{m_name}` 期间关闭了连接。stderr:\n{stderr_tail}")
                    )

    async def _handle_reverse_request(self, msg: dict[str, Any]) -> None:
        """在独立协程中响应服务端发来的反向 RPC 调用，避免阻塞 stdout 读取循环。"""
        req_id = msg["id"]
        method = msg.get("method", "")
        params = msg.get("params", {})

        try:
            if method == "session/request_permission":
                result = await self._on_request_permission(params)
            elif method == "elicitation/create":
                result = await self._on_elicitation_create(params)
            elif method == "fs/read_text_file":
                result = await self._on_fs_read_text_file(params)
            elif method == "fs/write_text_file":
                result = await self._on_fs_write_text_file(params)
            else:
                raise JsonRpcError(-32601, f"Client 未实现反向方法: {method}", method=method)

            resp = {"jsonrpc": "2.0", "id": req_id, "result": result}
            await self._write_message("REV-RES", resp)
        except JsonRpcError as exc:
            err_resp = {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": exc.code, "message": exc.rpc_message, "data": exc.data},
            }
            await self._write_message("ERR", err_resp)
        except Exception as exc:
            err_resp = {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32603, "message": f"客户端回调异常: {exc}"},
            }
            await self._write_message("ERR", err_resp)

    async def _on_request_permission(self, params: dict[str, Any]) -> dict[str, Any]:
        policy = self.permission_policy
        if callable(policy):
            decision = await policy(params)
        else:
            decision = select_permission_outcome(params.get("options", []), preferred_kind=policy)

        record = {"params": params, "decision": decision}
        self.permission_history.append(record)
        return decision

    async def _on_elicitation_create(self, params: dict[str, Any]) -> dict[str, Any]:
        if self.elicitation_callback is not None:
            decision = await self.elicitation_callback(params)
        else:
            decision = {"action": "decline"}
        self.elicitation_history.append({"params": params, "decision": decision})
        return decision

    async def _on_fs_read_text_file(self, params: dict[str, Any]) -> dict[str, Any]:
        target = Path(params["path"])
        text = target.read_text(encoding="utf-8")
        line = params.get("line")
        limit = params.get("limit")
        if line is not None or limit is not None:
            lines = text.splitlines(keepends=True)
            start = max(0, (int(line) - 1) if line else 0)
            end = (start + int(limit)) if limit else len(lines)
            text = "".join(lines[start:end])
        return {"content": text}

    async def _on_fs_write_text_file(self, params: dict[str, Any]) -> dict[str, Any]:
        target = Path(params["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(params.get("content", ""), encoding="utf-8")
        return {}

    # -------------------------------------------------------------------------
    # ACP 标准与扩展高层方法封装
    # -------------------------------------------------------------------------

    async def initialize(
        self,
        *,
        protocol_version: int = 1,
        read_text_file: bool = True,
        write_text_file: bool = True,
        terminal: bool = True,
        client_name: str = "acp-simpale-lab",
        client_version: str = "0.1.0",
    ) -> dict[str, Any]:
        return await self.send_request(
            "initialize",
            {
                "protocolVersion": protocol_version,
                "clientCapabilities": {
                    "fs": {"readTextFile": read_text_file, "writeTextFile": write_text_file},
                    "terminal": terminal,
                    "elicitation": {"form": {}, "url": {}},
                },
                "clientInfo": {"name": client_name, "version": client_version},
            },
        )

    async def authenticate(self, method_id: str) -> dict[str, Any]:
        return await self.send_request("authenticate", {"methodId": method_id})

    async def session_new(
        self,
        cwd: str | Path,
        *,
        mcp_servers: list[dict[str, Any]] | None = None,
        additional_directories: list[str | Path] | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "cwd": str(Path(cwd).resolve()),
            "mcpServers": mcp_servers if mcp_servers is not None else [],
        }
        if additional_directories:
            params["additionalDirectories"] = [str(Path(p).resolve()) for p in additional_directories]
        return await self.send_request("session/new", params)

    async def session_list(self, cwd: str | Path | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if cwd is not None:
            params["cwd"] = str(Path(cwd).resolve())
        return await self.send_request("session/list", params)

    async def session_load(
        self,
        session_id: str,
        cwd: str | Path,
        *,
        mcp_servers: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return await self.send_request(
            "session/load",
            {
                "sessionId": session_id,
                "cwd": str(Path(cwd).resolve()),
                "mcpServers": mcp_servers if mcp_servers is not None else [],
            },
        )

    async def session_resume(
        self,
        session_id: str,
        cwd: str | Path,
        *,
        mcp_servers: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return await self.send_request(
            "session/resume",
            {
                "sessionId": session_id,
                "cwd": str(Path(cwd).resolve()),
                "mcpServers": mcp_servers if mcp_servers is not None else [],
            },
        )

    async def session_close(self, session_id: str) -> dict[str, Any]:
        return await self.send_request("session/close", {"sessionId": session_id})

    async def session_set_mode(self, session_id: str, mode_id: str) -> dict[str, Any]:
        return await self.send_request("session/set_mode", {"sessionId": session_id, "modeId": mode_id})

    async def session_set_model(self, session_id: str, model_id: str) -> dict[str, Any]:
        return await self.send_request("session/set_model", {"sessionId": session_id, "modelId": model_id})

    async def session_set_config_option(
        self, session_id: str, config_id: str, value: str | bool
    ) -> dict[str, Any]:
        return await self.send_request(
            "session/set_config_option",
            {"sessionId": session_id, "configId": config_id, "value": value},
        )

    async def prefer_fast_model(self, session_info: dict[str, Any]) -> dict[str, str]:
        """自动从会话支持的模型与配置项中切换到轻量 Flash 模型 + low 思考等级，节省实验耗时与配额。"""
        session_id = session_info["sessionId"]
        chosen: dict[str, str] = {}

        # 1. 优先尝试通过统一 configOptions 设置 flash 模型与 low 思考深度
        config_options = session_info.get("configOptions", [])
        by_id = {opt.get("id"): opt for opt in config_options if isinstance(opt, dict)}

        if "model" in by_id:
            values = [o.get("value", "") for o in by_id["model"].get("options", [])]
            preferred_families = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]
            target_family = next((m for m in preferred_families if m in values), None)
            if target_family is None:
                target_family = next((v for v in values if "flash" in v.lower()), None)
            if target_family:
                await self.session_set_config_option(session_id, "model", target_family)
                chosen["config.model"] = target_family

        if "thought_level" in by_id:
            t_values = [o.get("value", "") for o in by_id["thought_level"].get("options", [])]
            if "low" in t_values:
                await self.session_set_config_option(session_id, "thought_level", "low")
                chosen["config.thought_level"] = "low"

        # 2. 若未命中 configOptions，则回退尝试 session/set_model
        if not chosen:
            avail = [
                m.get("modelId", "")
                for m in session_info.get("models", {}).get("availableModels", [])
                if isinstance(m, dict)
            ]
            fast_id = next((m for m in avail if "flash" in m.lower() and "low" in m.lower()), None)
            if fast_id is None:
                fast_id = next((m for m in avail if "flash" in m.lower()), None)
            if fast_id:
                await self.session_set_model(session_id, fast_id)
                chosen["modelId"] = fast_id

        return chosen

    async def session_cancel(self, session_id: str) -> None:
        """发送 `session/cancel` 通知以中断指定会话正在生成的轮次。"""
        await self.send_notification("session/cancel", {"sessionId": session_id})

    async def session_prompt(
        self,
        session_id: str,
        prompt: str | list[dict[str, Any]],
        *,
        on_update: UpdateCallback | None = None,
        timeout: float | None = None,
    ) -> PromptTurnResult:
        """发送 `session/prompt` 并聚合该轮次内的所有流式 `session/update` 与权限回调记录。"""
        blocks: list[dict[str, Any]]
        if isinstance(prompt, str):
            blocks = [{"type": "text", "text": prompt}]
        else:
            blocks = prompt

        updates: list[dict[str, Any]] = []
        text_chunks: list[str] = []
        thought_chunks: list[str] = []
        tool_events: list[dict[str, Any]] = []
        perm_start_idx = len(self.permission_history)

        async def _collector(params: dict[str, Any]) -> None:
            if params.get("sessionId") != session_id:
                return
            upd = params.get("update", {})
            updates.append(upd)
            utype = upd.get("sessionUpdate")
            if utype == "agent_message_chunk":
                content = upd.get("content", {})
                if isinstance(content, dict) and content.get("type") == "text":
                    text_chunks.append(content.get("text", ""))
            elif utype == "agent_thought_chunk":
                content = upd.get("content", {})
                if isinstance(content, dict) and content.get("type") == "text":
                    thought_chunks.append(content.get("text", ""))
            elif utype in ("tool_call", "tool_call_update"):
                tool_events.append(upd)

            if on_update is not None:
                res = on_update(params)
                if asyncio.iscoroutine(res):
                    await res

        unsubscribe = self.add_update_listener(_collector)
        try:
            resp = await self.send_request(
                "session/prompt",
                {"sessionId": session_id, "prompt": blocks},
                timeout=timeout,
            )
        finally:
            # 给队列尾部的通知一个事件循环 tick 确保收集完整
            await asyncio.sleep(0.02)
            unsubscribe()

        return PromptTurnResult(
            response=resp,
            stop_reason=str(resp.get("stopReason", "")),
            assistant_text="".join(text_chunks),
            thought_text="".join(thought_chunks),
            updates=updates,
            tool_events=tool_events,
            permission_requests=self.permission_history[perm_start_idx:],
        )


def select_permission_outcome(
    options: list[dict[str, Any]],
    preferred_kind: str = "allow_once",
) -> dict[str, Any]:
    """根据策略名（`allow_once` / `allow_always` / `reject_once` / `cancelled`）匹配标准 ACP 权限回包。"""
    if preferred_kind == "cancelled" or not options:
        return {"outcome": {"outcome": "cancelled"}}

    # 1. 精确匹配 kind（如 allow_once / reject_once）
    for opt in options:
        if opt.get("kind") == preferred_kind:
            return {"outcome": {"outcome": "selected", "optionId": opt["optionId"]}}

    # 2. 前缀容错匹配（例如请求 allow 时匹配任意 allow_*，请求 reject 时匹配任意 reject_*）
    prefix = "allow" if preferred_kind.startswith("allow") else "reject"
    for opt in options:
        kind = str(opt.get("kind", "")).lower()
        opt_id = str(opt.get("optionId", "")).lower()
        if kind.startswith(prefix) or prefix in opt_id:
            return {"outcome": {"outcome": "selected", "optionId": opt["optionId"]}}

    # 3. 兜底选择第一项
    return {"outcome": {"outcome": "selected", "optionId": options[0]["optionId"]}}
