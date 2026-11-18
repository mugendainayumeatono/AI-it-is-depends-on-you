"""双向 JSON-RPC 2.0 over stdio 报文抓包、染色打印与 JSONL 落盘记录器。"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from rich.console import Console
from rich.markup import escape

WireMode = Literal["off", "summary", "raw"]
Direction = Literal["C->A", "A->C"]
FrameKind = Literal["REQ", "RES", "ERR", "NOTIFY", "REV-REQ", "REV-RES"]


@dataclass
class WireRecord:
    """单帧 JSON-RPC 2.0 报文抓包记录。"""

    seq: int
    timestamp: str
    elapsed_ms: float
    direction: Direction
    kind: FrameKind
    payload: dict[str, Any]


@dataclass
class WireLogger:
    """记录客户端与 agy acp 之间双向收发的全部 JSON-RPC 帧。"""

    mode: WireMode = "off"
    log_dir: Path | None = Path("logs")
    prefix: str = "acp_wire"
    console: Console = field(default_factory=lambda: Console(stderr=False))
    records: list[WireRecord] = field(default_factory=list, init=False)
    log_path: Path | None = field(default=None, init=False)
    _start_monotonic: float = field(default_factory=time.monotonic, init=False)

    def __post_init__(self) -> None:
        if self.log_dir is not None:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            self.log_path = self.log_dir / f"{self.prefix}_{ts}.jsonl"

    def record(self, direction: Direction, kind: FrameKind, payload: dict[str, Any]) -> WireRecord:
        seq = len(self.records) + 1
        now_iso = datetime.now(timezone.utc).isoformat()
        elapsed_ms = round((time.monotonic() - self._start_monotonic) * 1000, 2)
        rec = WireRecord(
            seq=seq,
            timestamp=now_iso,
            elapsed_ms=elapsed_ms,
            direction=direction,
            kind=kind,
            payload=payload,
        )
        self.records.append(rec)

        if self.log_path is not None:
            entry = {
                "seq": rec.seq,
                "timestamp": rec.timestamp,
                "elapsed_ms": rec.elapsed_ms,
                "direction": rec.direction,
                "kind": rec.kind,
                "payload": rec.payload,
            }
            with self.log_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")

        if self.mode == "raw":
            self._print_raw(rec)
        elif self.mode == "summary":
            self._print_summary(rec)

        return rec

    def _badge(self, rec: WireRecord) -> str:
        color = {
            "REQ": "cyan",
            "RES": "green",
            "ERR": "bold red",
            "NOTIFY": "yellow",
            "REV-REQ": "bold magenta",
            "REV-RES": "magenta",
        }.get(rec.kind, "white")
        return f"[{color}]#{rec.seq:03d} {rec.direction} [{rec.kind}][/{color}] [dim]+{rec.elapsed_ms:.0f}ms[/dim]"

    def _print_raw(self, rec: WireRecord) -> None:
        raw_json = json.dumps(rec.payload, ensure_ascii=False)
        self.console.print(f"{self._badge(rec)} {escape(raw_json)}")

    def _print_summary(self, rec: WireRecord) -> None:
        p = rec.payload
        if rec.kind in ("REQ", "REV-REQ"):
            method = p.get("method", "?")
            rpc_id = p.get("id")
            params = p.get("params", {})
            brief = _summarize_dict(params)
            self.console.print(f"{self._badge(rec)} id={rpc_id} [bold]{escape(str(method))}[/bold] {escape(brief)}")
        elif rec.kind == "NOTIFY":
            method = p.get("method", "?")
            params = p.get("params", {})
            if method == "session/update":
                upd = params.get("update", {})
                utype = upd.get("sessionUpdate", "unknown")
                detail = _summarize_session_update(upd)
                self.console.print(
                    f"{self._badge(rec)} [bold]session/update[/bold] ({escape(str(utype))}) {escape(detail)}"
                )
            else:
                self.console.print(
                    f"{self._badge(rec)} [bold]{escape(str(method))}[/bold] {escape(_summarize_dict(params))}"
                )
        elif rec.kind in ("RES", "REV-RES"):
            rpc_id = p.get("id")
            result = p.get("result", {})
            brief = _summarize_dict(result) if isinstance(result, dict) else str(result)[:120]
            self.console.print(f"{self._badge(rec)} id={rpc_id} {escape(brief)}")
        elif rec.kind == "ERR":
            rpc_id = p.get("id")
            err = p.get("error", {})
            self.console.print(f"{self._badge(rec)} id={rpc_id} ERROR={escape(json.dumps(err, ensure_ascii=False))}")


def _summarize_session_update(upd: dict[str, Any]) -> str:
    utype = upd.get("sessionUpdate")
    if utype in ("agent_message_chunk", "agent_thought_chunk", "user_message_chunk"):
        content = upd.get("content", {})
        text = content.get("text", "") if isinstance(content, dict) else str(content)
        snippet = text.replace("\n", "\\n")
        if len(snippet) > 80:
            snippet = snippet[:77] + "..."
        return f'text="{snippet}"'
    if utype in ("tool_call", "tool_call_update"):
        title = upd.get("title") or upd.get("kind") or ""
        status = upd.get("status", "")
        tc_id = upd.get("toolCallId", "")
        return f"id={tc_id} title={title!r} status={status}"
    return _summarize_dict({k: v for k, v in upd.items() if k != "sessionUpdate"})


def _summarize_dict(data: Any, max_len: int = 120) -> str:
    if not isinstance(data, dict):
        s = str(data)
        return s if len(s) <= max_len else s[: max_len - 3] + "..."
    parts: list[str] = []
    for k, v in data.items():
        if isinstance(v, str):
            val = v if len(v) <= 36 else f"{v[:33]}..."
            parts.append(f"{k}={val!r}")
        elif isinstance(v, list):
            parts.append(f"{k}=[{len(v)} items]")
        elif isinstance(v, dict):
            parts.append(f"{k}={{{','.join(list(v.keys())[:4])}}}")
        else:
            parts.append(f"{k}={v!r}")
    out = "{" + ", ".join(parts) + "}"
    return out if len(out) <= max_len else out[: max_len - 3] + "...}"
