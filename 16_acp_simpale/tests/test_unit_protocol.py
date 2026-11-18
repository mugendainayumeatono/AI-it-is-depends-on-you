"""离线协议引擎单元测试（使用内置 Mock ACP 子进程验证双向消息泵、反向 RPC 防死锁、大帧传输与抓包落盘）。"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from typing import Any

import pytest

from acp_lab.raw_client import (
    AgyAcpClient,
    JsonRpcError,
    make_solid_png_base64,
    select_permission_outcome,
)

MOCK_AGENT_SCRIPT = r"""
import json, sys

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def recv():
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    return json.loads(line)

while True:
    msg = recv()
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params", {})

    if method == "initialize":
        send({
            "jsonrpc": "2.0",
            "id": mid,
            "result": {
                "protocolVersion": 1,
                "agentInfo": {"name": "MockAcpAgent", "version": "0.0.1"},
                "agentCapabilities": {"loadSession": True},
            },
        })
    elif method == "session/new":
        send({
            "jsonrpc": "2.0",
            "id": mid,
            "result": {
                "sessionId": "mock-sess-1",
                "bigPayload": "X" * 120000,  # >64KiB，测试 16MiB StreamReader 缓冲区
            },
        })
    elif method == "trigger/error":
        send({
            "jsonrpc": "2.0",
            "id": mid,
            "error": {"code": -32602, "message": "Invalid test parameter", "data": {"hint": "bad"}},
        })
    elif method == "session/prompt":
        sid = params["sessionId"]
        # 1. 发送思维链通知
        send({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": sid,
                "update": {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "thinking..."}},
            },
        })
        # 2. 在处理 prompt 期间反向调用客户端 session/request_permission (测试双向非阻塞)
        send({
            "jsonrpc": "2.0",
            "id": "srv-perm-1",
            "method": "session/request_permission",
            "params": {
                "sessionId": sid,
                "toolCall": {"toolCallId": "tc-1", "title": "Write test.txt"},
                "options": [
                    {"optionId": "opt-allow", "name": "Allow once", "kind": "allow_once"},
                    {"optionId": "opt-reject", "name": "Reject once", "kind": "reject_once"},
                ],
            },
        })
        perm_resp = recv()
        selected_opt = perm_resp.get("result", {}).get("outcome", {}).get("optionId", "none")

        # 3. 反向调用客户端 elicitation/create 与 fs/write_text_file + fs/read_text_file
        send({
            "jsonrpc": "2.0",
            "id": "srv-elic-1",
            "method": "elicitation/create",
            "params": {"message": "Confirm environment?"},
        })
        elic_resp = recv()

        target_file = params["prompt"][0].get("targetFile")
        fs_echo = ""
        if target_file:
            send({
                "jsonrpc": "2.0",
                "id": "srv-fs-w",
                "method": "fs/write_text_file",
                "params": {"sessionId": sid, "path": target_file, "content": "line1\nline2\nline3\n"},
            })
            recv()
            send({
                "jsonrpc": "2.0",
                "id": "srv-fs-r",
                "method": "fs/read_text_file",
                "params": {"sessionId": sid, "path": target_file, "line": 2, "limit": 1},
            })
            fs_echo = recv().get("result", {}).get("content", "").strip()

        # 4. 流式输出回复分块并结束轮次
        reply_text = f"perm={selected_opt};elic={elic_resp['result']['action']};fs={fs_echo}"
        send({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": sid,
                "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": reply_text}},
            },
        })
        send({"jsonrpc": "2.0", "id": mid, "result": {"stopReason": "end_turn"}})
"""


def test_solid_png_generator_header() -> None:
    b64 = make_solid_png_base64(16, 16, (0, 255, 0))
    raw = base64.b64decode(b64)
    assert raw.startswith(b"\x89PNG\r\n\x1a\n")
    assert b"IHDR" in raw and b"IDAT" in raw and b"IEND" in raw


def test_permission_selector_variants() -> None:
    opts = [
        {"optionId": "a1", "kind": "allow_once"},
        {"optionId": "r1", "kind": "reject_once"},
    ]
    assert select_permission_outcome(opts, "allow_once") == {
        "outcome": {"outcome": "selected", "optionId": "a1"}
    }
    assert select_permission_outcome(opts, "reject_once") == {
        "outcome": {"outcome": "selected", "optionId": "r1"}
    }
    assert select_permission_outcome(opts, "cancelled") == {"outcome": {"outcome": "cancelled"}}


async def test_bidirectional_jsonrpc_no_deadlock_and_wire_log(tmp_path: Path) -> None:
    async def _custom_elicitation(_params: dict[str, Any]) -> dict[str, Any]:
        return {"action": "accept", "content": {"ok": True}}

    fs_target = tmp_path / "client_fs_test.txt"
    wire_dir = tmp_path / "wire_logs"

    async with AgyAcpClient(
        command=[sys.executable, "-u", "-c", MOCK_AGENT_SCRIPT],
        wire_mode="off",
        wire_log_dir=wire_dir,
        permission_policy="allow_once",
        elicitation_callback=_custom_elicitation,
    ) as client:
        init_res = await client.initialize()
        assert init_res["agentInfo"]["name"] == "MockAcpAgent"

        # 验证超过 64KiB 的大 JSON 帧不会触发 LimitOverrunError
        sess_res = await client.session_new(tmp_path)
        assert len(sess_res["bigPayload"]) == 120000

        # 验证 JSON-RPC 错误码准确映射为 JsonRpcError
        with pytest.raises(JsonRpcError) as exc_info:
            await client.send_request("trigger/error")
        assert exc_info.value.code == -32602

        # 验证在 session/prompt 阻塞等待期间，连续处理服务端发来的权限、提问、文件读写反向请求不死锁
        turn = await client.session_prompt(
            "mock-sess-1",
            [{"type": "text", "text": "go", "targetFile": str(fs_target)}],
        )
        assert turn.stop_reason == "end_turn"
        assert turn.thought_text == "thinking..."
        assert turn.assistant_text == "perm=opt-allow;elic=accept;fs=line2"
        assert len(turn.permission_requests) == 1
        assert len(client.elicitation_history) == 1

        # 验证 WireLogger JSONL 抓包文件完整落盘
        assert client.wire.log_path is not None and client.wire.log_path.exists()
        lines = client.wire.log_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == len(client.wire.records)
        kinds = {json.loads(line)["kind"] for line in lines}
        assert {"REQ", "RES", "ERR", "NOTIFY", "REV-REQ", "REV-RES"}.issubset(kinds)
