"""Antigravity ACP 全功能实验套件（覆盖 S1 ~ S7 七大核心与扩展场景）。"""

from __future__ import annotations

import argparse
import asyncio
import json
import secrets
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from acp_lab.raw_client import AgyAcpClient, make_solid_png_base64
from acp_lab.wire_logger import WireMode


@dataclass
class ScenarioResult:
    """单个 ACP 实验场景的执行结果与指标摘要。"""

    code: str
    title: str
    passed: bool
    duration_sec: float
    frames_count: int
    summary: str
    details: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


def detect_host_tool_permission() -> str:
    """只读检测本机 `~/.gemini/antigravity-cli/settings.json` 中的全局 `toolPermission` 策略。"""
    settings_path = Path.home() / ".gemini" / "antigravity-cli" / "settings.json"
    try:
        if settings_path.exists():
            data = json.loads(settings_path.read_text(encoding="utf-8"))
            return str(data.get("toolPermission", "request-review"))
    except Exception:
        pass
    return "request-review"


async def scenario_s1_handshake(client: AgyAcpClient) -> ScenarioResult:
    """S1: `initialize` 握手、协议版本协商、能力矩阵与鉴权方式探测。"""
    t0 = time.monotonic()
    f0 = len(client.wire.records)
    init_res = await client.initialize()

    proto_ver = init_res.get("protocolVersion")
    agent_info = init_res.get("agentInfo", {})
    caps = init_res.get("agentCapabilities", {})
    sess_caps = caps.get("sessionCapabilities") or caps.get("session_capabilities") or {}
    prompt_caps = caps.get("promptCapabilities") or {}
    auth_methods = init_res.get("authMethods", [])

    assert proto_ver == 1, f"期望 protocolVersion=1，实际返回 {proto_ver}"
    assert agent_info.get("name"), f"agentInfo.name 为空: {agent_info}"
    for expected_cap in ("list", "load", "resume", "close", "additionalDirectories"):
        assert expected_cap in sess_caps, f"缺少会话能力 `{expected_cap}`: {sess_caps}"
    assert prompt_caps.get("image") is True, f"期望支持 image prompt: {prompt_caps}"
    assert prompt_caps.get("embeddedContext") is True, f"期望支持 embeddedContext: {prompt_caps}"

    return ScenarioResult(
        code="S1",
        title="握手与能力矩阵探测 (initialize)",
        passed=True,
        duration_sec=round(time.monotonic() - t0, 2),
        frames_count=len(client.wire.records) - f0,
        summary=(
            f"Agent={agent_info.get('name')} v{agent_info.get('version')}, "
            f"protocol=v{proto_ver}, authMethods={len(auth_methods)}, "
            f"sessionCaps={list(sess_caps.keys())}"
        ),
        details=init_res,
    )


async def scenario_s2_session_lifecycle(client: AgyAcpClient) -> ScenarioResult:
    """S2: 会话创建（含 `additionalDirectories`）、`session/list` 列举与 `session/close` 销毁。"""
    t0 = time.monotonic()
    f0 = len(client.wire.records)

    with (
        tempfile.TemporaryDirectory(prefix="acp_s2_main_") as main_dir,
        tempfile.TemporaryDirectory(prefix="acp_s2_extra_") as extra_dir,
    ):
        new_res = await client.session_new(
            main_dir,
            additional_directories=[extra_dir],
        )
        sid = new_res.get("sessionId", "")
        assert sid, f"session/new 未返回 sessionId: {new_res}"

        models_info = new_res.get("models", {})
        modes_info = new_res.get("modes", {})
        config_opts = new_res.get("configOptions", [])
        assert len(models_info.get("availableModels", [])) > 0, "availableModels 为空"
        assert len(modes_info.get("availableModes", [])) >= 3, "availableModes 数量异常"
        assert len(config_opts) >= 2, "configOptions 数量异常"

        list_res = await client.session_list()
        assert isinstance(list_res.get("sessions"), list), f"session/list 返回格式异常: {list_res}"

        close_res = await client.session_close(sid)
        assert isinstance(close_res, dict), f"session/close 返回异常: {close_res}"

    return ScenarioResult(
        code="S2",
        title="会话生命周期与多工作区目录 (new / list / close)",
        passed=True,
        duration_sec=round(time.monotonic() - t0, 2),
        frames_count=len(client.wire.records) - f0,
        summary=(
            f"sessionId={sid[:8]}..., models={len(models_info.get('availableModels', []))}, "
            f"modes={[m['id'] for m in modes_info.get('availableModes', [])]}, "
            f"listedSessions={len(list_res.get('sessions', []))}"
        ),
        details={"sessionId": sid, "configOptionIds": [c.get("id") for c in config_opts]},
    )


async def scenario_s3_dynamic_config_and_modes(client: AgyAcpClient) -> ScenarioResult:
    """S3: 动态配置项、模式切换与模型切换 (`set_config_option` / `set_mode` / `set_model`)。"""
    t0 = time.monotonic()
    f0 = len(client.wire.records)

    with tempfile.TemporaryDirectory(prefix="acp_s3_") as tmp_dir:
        s_info = await client.session_new(tmp_dir)
        sid = s_info["sessionId"]
        try:
            fast_cfg = await client.prefer_fast_model(s_info)

            # 测试 session/set_mode 在 plan -> accept-edits -> default 之间切换
            await client.session_set_mode(sid, "plan")
            await client.session_set_mode(sid, "accept-edits")
            await client.session_set_mode(sid, "default")

            # 测试 session/set_model 直接指定具体 modelId
            avail_ids = [m["modelId"] for m in s_info.get("models", {}).get("availableModels", [])]
            flash_model_id = next((m for m in avail_ids if "flash" in m and "low" in m), avail_ids[0])
            await client.session_set_model(sid, flash_model_id)
        finally:
            await client.session_close(sid)

    return ScenarioResult(
        code="S3",
        title="动态模式/模型/思考等级配置 (set_mode / set_model / set_config_option)",
        passed=True,
        duration_sec=round(time.monotonic() - t0, 2),
        frames_count=len(client.wire.records) - f0,
        summary=f"fastConfig={fast_cfg}, modes=plan->accept-edits->default, modelId={flash_model_id}",
        details={"fast_cfg": fast_cfg, "flash_model_id": flash_model_id},
    )


async def scenario_s4_multimodal_and_context_prompts(client: AgyAcpClient) -> ScenarioResult:
    """S4: 多类型 Prompt（纯文本、内嵌资源 `embeddedContext`、PNG 图像 `image`）与流式分块聚合。"""
    t0 = time.monotonic()
    f0 = len(client.wire.records)

    with tempfile.TemporaryDirectory(prefix="acp_s4_") as tmp_dir:
        s_info = await client.session_new(tmp_dir)
        sid = s_info["sessionId"]
        try:
            await client.prefer_fast_model(s_info)

            # 4a. 纯文本流式问答
            turn_text = await client.session_prompt(
                sid,
                "请直接计算 19 乘以 23 等于多少，回复里必须包含阿拉伯数字结果，不要多余寒暄。",
            )
            assert "437" in turn_text.assistant_text, f"纯文本计算结果未包含 437: {turn_text.assistant_text!r}"
            assert turn_text.stop_reason == "end_turn", f"异常 stopReason: {turn_text.stop_reason}"

            # 4b. 内嵌资源上下文 (embeddedContext / resource ContentBlock)
            # 使用虚拟协议 URI (embedded://) 并明确无需查盘，使模型直接消费内嵌上下文块
            codename = f"ORION-{secrets.randbelow(9000) + 1000}"
            turn_ctx = await client.session_prompt(
                sid,
                [
                    {
                        "type": "resource",
                        "resource": {
                            "uri": "embedded://context/spec_snippet.txt",
                            "mimeType": "text/plain",
                            "text": f"INTERNAL_SPEC_VERSION=2.1\nSECRET_CODENAME={codename}\n",
                        },
                    },
                    {
                        "type": "text",
                        "text": "请不要调用任何搜索或读文件工具，直接从本消息内嵌资源文本中提取 SECRET_CODENAME 的值并原样输出。",
                    },
                ],
            )
            assert codename in turn_ctx.assistant_text, (
                f"内嵌资源代号 `{codename}` 未被正确识别: {turn_ctx.assistant_text!r}"
            )

            # 4c. 纯标准库构造 32x32 纯红 PNG 图片进行多模态视觉测试
            red_png_b64 = make_solid_png_base64(32, 32, (255, 0, 0))
            turn_img = await client.session_prompt(
                sid,
                [
                    {
                        "type": "image",
                        "mimeType": "image/png",
                        "data": red_png_b64,
                    },
                    {
                        "type": "text",
                        "text": "这张纯色图片是什么颜色？请同时包含中文和英文颜色词（如：红色 red）。",
                    },
                ],
            )
            lower_img_reply = turn_img.assistant_text.lower()
            assert ("红" in lower_img_reply) or ("red" in lower_img_reply), (
                f"多模态图片颜色识别不符合预期: {turn_img.assistant_text!r}"
            )
        finally:
            await client.session_close(sid)

    return ScenarioResult(
        code="S4",
        title="多类型 Prompt 与流式更新 (text / embeddedContext / image)",
        passed=True,
        duration_sec=round(time.monotonic() - t0, 2),
        frames_count=len(client.wire.records) - f0,
        summary=(
            f"math='437' OK ({len(turn_text.updates)} updates), "
            f"embeddedContext={codename!r} OK, "
            f"imageColor={turn_img.assistant_text.strip()[:30]!r} OK"
        ),
        details={
            "math_reply": turn_text.assistant_text.strip(),
            "context_reply": turn_ctx.assistant_text.strip(),
            "image_reply": turn_img.assistant_text.strip(),
        },
    )


async def scenario_s5_session_resume_and_load(client: AgyAcpClient) -> ScenarioResult:
    """S5: 跨进程会话持久化恢复与历史上下文记忆 (`session/list` + `session/resume` / `session/load`)。"""
    t0 = time.monotonic()
    f0 = len(client.wire.records)
    passcode = f"ACP-MEM-{secrets.randbelow(9000) + 1000}"

    with tempfile.TemporaryDirectory(prefix="acp_s5_") as tmp_dir:
        # 阶段 1：在主客户端创建会话并写入专属实验口令
        s_info = await client.session_new(tmp_dir)
        sid = s_info["sessionId"]
        await client.prefer_fast_model(s_info)
        await client.session_prompt(
            sid,
            f"请牢牢记住这个测试口令：{passcode}。现在只需要回复“已记住”。",
        )

        # 阶段 2：拉起一个全新的独立 agy acp 进程，通过 session/resume 恢复同一会话验证持久化记忆
        async with AgyAcpClient(
            command=client.command,
            wire_mode=client.wire.mode,
            wire_log_dir=client.wire.log_dir,
            wire_prefix="acp_wire_s5_resumed",
        ) as client2:
            await client2.initialize()
            list_res = await client2.session_list()
            session_ids = [
                s.get("sessionId") or s.get("id", "")
                for s in list_res.get("sessions", [])
                if isinstance(s, dict)
            ]
            in_list = sid in session_ids

            resume_res = await client2.session_resume(sid, tmp_dir)
            await client2.prefer_fast_model({"sessionId": sid, **resume_res})

            turn_recall = await client2.session_prompt(
                sid,
                "我上一轮让你记住的测试口令是什么？请准确输出该口令字符串。",
            )
            assert passcode in turn_recall.assistant_text, (
                f"跨进程 session/resume 后未能回忆口令 `{passcode}`，实际回复: {turn_recall.assistant_text!r}"
            )
            extra_frames = len(client2.wire.records)
            await client2.session_close(sid)

    return ScenarioResult(
        code="S5",
        title="跨进程会话恢复与上下文记忆 (session/resume & list)",
        passed=True,
        duration_sec=round(time.monotonic() - t0, 2),
        frames_count=(len(client.wire.records) - f0) + extra_frames,
        summary=(
            f"passcode={passcode!r} 跨进程恢复回忆成功! "
            f"inSessionList={in_list}, reply={turn_recall.assistant_text.strip()[:40]!r}"
        ),
        details={"sessionId": sid, "in_session_list": in_list, "recall": turn_recall.assistant_text.strip()},
    )


def _pick_elicitation_answer(params: dict[str, Any], target_keyword: str) -> dict[str, Any]:
    """从 `elicitation/create` 的 `requestedSchema` 中查找包含指定关键词的选项并返回标准 accept 结构。"""
    schema = params.get("requestedSchema", {})
    props = schema.get("properties", {})
    answers: dict[str, Any] = {}
    for field_name, prop in props.items():
        if field_name.endswith("_other"):
            continue
        one_of = prop.get("oneOf", [])
        if one_of:
            matched = next(
                (item["const"] for item in one_of if target_keyword.lower() in str(item.get("title", "")).lower()),
                one_of[-1]["const"],
            )
            answers[field_name] = matched
        elif "enum" in prop and prop["enum"]:
            matched = next(
                (v for v in prop["enum"] if target_keyword.lower() in str(v).lower()),
                prop["enum"][-1],
            )
            answers[field_name] = matched
        else:
            answers[field_name] = target_keyword
    return {"action": "accept", "content": answers}


async def scenario_s6_permissions_and_reverse_rpc(client: AgyAcpClient) -> ScenarioResult:
    """S6: 工具调用追踪、权限策略自适应验证与双向反向 RPC (`elicitation/create` Accept vs Decline)。"""
    t0 = time.monotonic()
    f0 = len(client.wire.records)
    prev_policy = client.permission_policy
    prev_elic = client.elicitation_callback
    host_perm = detect_host_tool_permission()

    with tempfile.TemporaryDirectory(prefix="acp_s6_sandbox_") as tmp_dir:
        sandbox = Path(tmp_dir)
        s_info = await client.session_new(sandbox)
        sid = s_info["sessionId"]
        try:
            await client.prefer_fast_model(s_info)
            await client.session_set_mode(sid, "default")

            # 6a. 工具调用流与权限策略校验
            client.permission_policy = "allow_once"
            allowed_file = sandbox / "allowed_by_client.txt"
            turn_allow = await client.session_prompt(
                sid,
                (
                    f"请使用文件写入工具在当前工作目录 `{sandbox}` 下创建文件 `{allowed_file.name}`，"
                    "内容精确写入 `PERM_ALLOW_OK`。完成后一句话告诉我。"
                ),
            )
            assert allowed_file.exists(), f"目标文件未生成！回复: {turn_allow.assistant_text!r}"
            assert "PERM_ALLOW_OK" in allowed_file.read_text(encoding="utf-8"), "写入内容不匹配"
            assert len(turn_allow.tool_events) >= 1, "未捕获到 tool_call / tool_call_update 流式事件"

            reject_verified = "skipped(host=always-proceed)"
            if host_perm != "always-proceed":
                assert len(turn_allow.permission_requests) >= 1, "期望触发 session/request_permission"
                client.permission_policy = "reject_once"
                rejected_file = sandbox / "rejected_by_client.txt"
                turn_reject = await client.session_prompt(
                    sid,
                    (
                        f"请尝试创建 `{rejected_file.name}` 写入 `NO`。若权限被拒请停止尝试并告知权限被拒。"
                    ),
                )
                assert len(turn_reject.permission_requests) >= 1, "拒绝场景未触发 request_permission"
                assert not rejected_file.exists(), "返回 reject_once 后文件仍被创建！"
                reject_verified = f"blocked({len(turn_reject.permission_requests)} reqs)"

            # 6b. 100% 触发的服务端 -> 客户端双向反向 RPC (`elicitation/create` Accept & Decline)
            elic_before = len(client.elicitation_history)

            async def _accept_staging(params: dict[str, Any]) -> dict[str, Any]:
                return _pick_elicitation_answer(params, "staging")

            client.elicitation_callback = _accept_staging
            turn_elic_ok = await client.session_prompt(
                sid,
                (
                    "请立即调用 `ask_question` 工具向我发起单选题（问题：目标发布环境？"
                    "选项：dev, staging），收到我的选择后在回复中原样写出我选的环境名。"
                ),
            )
            assert len(client.elicitation_history) > elic_before, "未收到服务端反向请求 elicitation/create"
            assert "staging" in turn_elic_ok.assistant_text.lower(), (
                f"反向 RPC 返回 staging 后 Agent 回复未包含 staging: {turn_elic_ok.assistant_text!r}"
            )

            elic_mid = len(client.elicitation_history)

            async def _decline_question(_params: dict[str, Any]) -> dict[str, Any]:
                return {"action": "decline"}

            client.elicitation_callback = _decline_question
            await client.session_prompt(
                sid,
                (
                    "请再次调用 `ask_question` 工具询问（问题：是否开启调试日志？选项：开启, 关闭）。"
                    "如果用户取消或拒绝回答，请直接回复“已取消提问”即可，不要重复追问。"
                ),
            )
            assert len(client.elicitation_history) > elic_mid, "Decline 场景未捕获到 elicitation/create"
            total_elic = len(client.elicitation_history) - elic_before
        finally:
            client.permission_policy = prev_policy
            client.elicitation_callback = prev_elic
            await client.session_close(sid)

    return ScenarioResult(
        code="S6",
        title="工具追踪、权限策略与双向反向 RPC (tool_call / permission / elicitation)",
        passed=True,
        duration_sec=round(time.monotonic() - t0, 2),
        frames_count=len(client.wire.records) - f0,
        summary=(
            f"toolWrite='PERM_ALLOW_OK' OK (events={len(turn_allow.tool_events)}, "
            f"hostToolPerm={host_perm!r}, rejectTest={reject_verified}); "
            f"reverseRPC elicitation/create (accept='staging' + decline)={total_elic} calls OK"
        ),
        details={
            "host_tool_permission": host_perm,
            "tool_events_count": len(turn_allow.tool_events),
            "elicitation_calls": total_elic,
        },
    )


# 保持向后兼容别名供外部测试直接引用
scenario_s6_permissions_allow_and_reject = scenario_s6_permissions_and_reverse_rpc


async def scenario_s7_cancel_mid_stream(client: AgyAcpClient) -> ScenarioResult:
    """S7: 长文本流式输出期间发送 `session/cancel` 中断轮次，并验证会话后续仍健康可用。"""
    t0 = time.monotonic()
    f0 = len(client.wire.records)

    with tempfile.TemporaryDirectory(prefix="acp_s7_") as tmp_dir:
        s_info = await client.session_new(tmp_dir)
        sid = s_info["sessionId"]
        try:
            await client.prefer_fast_model(s_info)

            cancel_sent = False

            async def _cancel_on_stream(params: dict[str, Any]) -> None:
                nonlocal cancel_sent
                if cancel_sent:
                    return
                upd = params.get("update", {})
                if upd.get("sessionUpdate") in ("agent_message_chunk", "agent_thought_chunk"):
                    cancel_sent = True
                    await client.session_cancel(sid)

            turn_cancelled = await client.session_prompt(
                sid,
                (
                    "请从 1 数到 300，每一行严格按格式输出：`Item <序号>: Agent Client Protocol "
                    "Long Streaming Cancellation Verification Line`，绝不要省略中间任何一行。"
                ),
                on_update=_cancel_on_stream,
            )
            assert cancel_sent, "流式过程中未能触发 session/cancel"

            # 验证取消后该会话并未损坏，依然可以继续正常对话
            turn_followup = await client.session_prompt(
                sid,
                "上一轮已被我主动取消。现在请只回复单词 HEALTHY 表示会话正常。",
            )
            assert "healthy" in turn_followup.assistant_text.lower(), (
                f"取消后会话恢复对话异常: {turn_followup.assistant_text!r}"
            )
        finally:
            await client.session_close(sid)

    return ScenarioResult(
        code="S7",
        title="流中异步取消与会话健康恢复 (session/cancel)",
        passed=True,
        duration_sec=round(time.monotonic() - t0, 2),
        frames_count=len(client.wire.records) - f0,
        summary=(
            f"cancelSent={cancel_sent}, stopReason={turn_cancelled.stop_reason!r}, "
            f"partialLen={len(turn_cancelled.assistant_text)} chars, followup='HEALTHY' OK"
        ),
        details={
            "cancelled_stop_reason": turn_cancelled.stop_reason,
            "partial_chars": len(turn_cancelled.assistant_text),
            "followup_reply": turn_followup.assistant_text.strip(),
        },
    )


ALL_SCENARIOS = [
    ("S1", scenario_s1_handshake),
    ("S2", scenario_s2_session_lifecycle),
    ("S3", scenario_s3_dynamic_config_and_modes),
    ("S4", scenario_s4_multimodal_and_context_prompts),
    ("S5", scenario_s5_session_resume_and_load),
    ("S6", scenario_s6_permissions_and_reverse_rpc),
    ("S7", scenario_s7_cancel_mid_stream),
]


async def run_suite(
    *,
    only: set[str] | None = None,
    wire_mode: WireMode = "off",
    console: Console | None = None,
) -> tuple[list[ScenarioResult], Path | None]:
    """按序运行选定的 ACP 实验场景并打印汇总表格。"""
    con = console or Console()
    results: list[ScenarioResult] = []

    selected = [(code, fn) for code, fn in ALL_SCENARIOS if not only or code in only]
    con.print(
        Panel.fit(
            f"准备自动拉起 [bold cyan]agy acp --stdio --disable-telemetry[/bold cyan]\n"
            f"待执行实验场景: [bold]{', '.join(c for c, _ in selected)}[/bold] | 报文回显模式: [yellow]{wire_mode}[/yellow]",
            title="Antigravity ACP 实验测试套件",
        )
    )

    async with AgyAcpClient(wire_mode=wire_mode) as client:
        if selected and selected[0][0] != "S1":
            await client.initialize()

        for code, fn in selected:
            con.print(f"\n[bold blue]▶ 正在运行 {code}:[/bold blue] {fn.__doc__ or code}")
            t0 = time.monotonic()
            f0 = len(client.wire.records)
            try:
                res = await fn(client)
                results.append(res)
                con.print(f"  [bold green]✔ PASS[/bold green] ({res.duration_sec:.2f}s) — {res.summary}")
            except Exception as exc:
                err_res = ScenarioResult(
                    code=code,
                    title=code,
                    passed=False,
                    duration_sec=round(time.monotonic() - t0, 2),
                    frames_count=len(client.wire.records) - f0,
                    summary=f"FAILED: {exc}",
                    error=repr(exc),
                )
                results.append(err_res)
                con.print(f"  [bold red]✘ FAIL[/bold red] ({err_res.duration_sec:.2f}s) — {exc}")

        wire_log_path = client.wire.log_path

    _render_summary_table(con, results, wire_log_path)
    return results, wire_log_path


def _render_summary_table(
    console: Console,
    results: list[ScenarioResult],
    wire_log_path: Path | None,
) -> None:
    table = Table(title="\nACP 全功能实验报告汇总", show_lines=True)
    table.add_column("编号", style="cyan", justify="center", no_wrap=True)
    table.add_column("实验场景", style="bold")
    table.add_column("状态", justify="center", no_wrap=True)
    table.add_column("耗时(s)", justify="right", no_wrap=True)
    table.add_column("帧数", justify="right", no_wrap=True)
    table.add_column("实验验证摘要")

    for r in results:
        status_str = "[bold green]PASS[/bold green]" if r.passed else "[bold red]FAIL[/bold red]"
        table.add_row(r.code, r.title, status_str, f"{r.duration_sec:.2f}", str(r.frames_count), r.summary)

    console.print(table)
    passed_cnt = sum(1 for r in results if r.passed)
    console.print(
        f"[bold]总计:[/bold] {passed_cnt}/{len(results)} 场景通过 | "
        f"[bold]JSON-RPC 原始抓包日志:[/bold] {wire_log_path}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="运行 Antigravity ACP 全功能自动化实验套件")
    parser.add_argument(
        "--only",
        type=str,
        default="",
        help="仅运行逗号分隔的指定场景编号，例如: S1,S4,S6",
    )
    parser.add_argument(
        "--wire",
        choices=["off", "summary", "raw"],
        default="off",
        help="终端实时回显 JSON-RPC 2.0 报文的详细程度 (默认: off，始终写入 logs/*.jsonl)",
    )
    args = parser.parse_args()
    only_set = {s.strip().upper() for s in args.only.split(",") if s.strip()} or None

    results, _ = asyncio.run(run_suite(only=only_set, wire_mode=args.wire))
    if any(not r.passed for r in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
