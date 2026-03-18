#pragma once

// 初始化音频采集系统
bool InitAudioCapture();

// 停止并清理音频采集系统
void CleanupAudioCapture();

// 开始录音 (玩家按下 PTT)
void StartRecording();

// 停止录音 (玩家释放 PTT)
void StopRecording();

// 检查是否正在录音
bool IsRecording();
