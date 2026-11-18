"""连接本机真实 `agy acp` 的全功能端到端集成测试套件。"""

from __future__ import annotations

import shutil
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from acp_lab.raw_client import AgyAcpClient
from acp_lab.scenarios import (
    scenario_s1_handshake,
    scenario_s2_session_lifecycle,
    scenario_s3_dynamic_config_and_modes,
    scenario_s4_multimodal_and_context_prompts,
    scenario_s5_session_resume_and_load,
    scenario_s6_permissions_allow_and_reject,
    scenario_s7_cancel_mid_stream,
)
from acp_lab.sdk_demo import run_sdk_demo

pytestmark = pytest.mark.skipif(shutil.which("agy") is None, reason="本机未安装 agy CLI")


@pytest.fixture
async def live_client(tmp_path: Path) -> AsyncIterator[AgyAcpClient]:
    """每个测试启动一个干净的 agy acp 进程并完成基础握手。"""
    async with AgyAcpClient(wire_mode="off", wire_log_dir=tmp_path / "logs") as client:
        yield client


async def test_s1_s2_s3_control_plane_and_config(live_client: AgyAcpClient) -> None:
    r1 = await scenario_s1_handshake(live_client)
    assert r1.passed

    r2 = await scenario_s2_session_lifecycle(live_client)
    assert r2.passed

    r3 = await scenario_s3_dynamic_config_and_modes(live_client)
    assert r3.passed


async def test_s4_multimodal_and_embedded_context(live_client: AgyAcpClient) -> None:
    await live_client.initialize()
    r4 = await scenario_s4_multimodal_and_context_prompts(live_client)
    assert r4.passed


async def test_s5_cross_process_session_resume(live_client: AgyAcpClient) -> None:
    await live_client.initialize()
    r5 = await scenario_s5_session_resume_and_load(live_client)
    assert r5.passed


async def test_s6_permission_allow_and_reject(live_client: AgyAcpClient) -> None:
    await live_client.initialize()
    r6 = await scenario_s6_permissions_allow_and_reject(live_client)
    assert r6.passed


async def test_s7_mid_stream_cancellation(live_client: AgyAcpClient) -> None:
    await live_client.initialize()
    r7 = await scenario_s7_cancel_mid_stream(live_client)
    assert r7.passed


async def test_official_python_sdk_e2e() -> None:
    metrics = await run_sdk_demo(verbose=False)
    assert metrics["protocol_version"] == 1
    assert len(metrics["turn1_reply"]) > 0
    assert metrics["file_created"] is True
    assert "SDK_ACP_OK" in metrics["file_content"]
    assert len(metrics["tool_updates"]) >= 1
    assert len(metrics["elicitation_events"]) >= 1
    assert "canary" in metrics["turn3_reply"].lower()
