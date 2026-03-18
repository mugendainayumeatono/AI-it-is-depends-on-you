#pragma once

#include <vector>
#include <cstdint>

// 初始化播放系统
bool InitAudioPlayback();

// 清理播放系统
void CleanupAudioPlayback();

// 将 PCM 格式的音频数据播放到飞机的无线电总线
// 采样率固定为 44100Hz, 单声道, 16-bit
void PlayVoiceAudio(const std::vector<int16_t>& pcmData);
