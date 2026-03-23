#include "AudioPlayback.h"
#include "XPLMSound.h"
#include "XPLMUtilities.h"

// FMOD Channel handle (X-Plane API returns it as an opaque pointer)
static void* g_playback_channel = nullptr;

// We need to keep the PCM data alive while playing
static std::vector<int16_t>* g_current_pcm_data = nullptr;

// Callback signature for XPLMPlayPCMOnBus completion
// XPLMPCMComplete_f takes (void* inRefcon, int status)
static void MySoundCompleteCallback(void* inRefcon, FMOD_RESULT status) {
    g_playback_channel = nullptr;
    
    // Free the PCM data that was played
    if (g_current_pcm_data) {
        delete g_current_pcm_data;
        g_current_pcm_data = nullptr;
    }
    
    XPLMDebugString("RadioPlugin: Audio playback completed.\n");
}

bool InitAudioPlayback() {
    XPLMDebugString("RadioPlugin: InitAudioPlayback success.\n");
    return true;
}

void CleanupAudioPlayback() {
    if (g_playback_channel) {
        // XPLMStopAudio(g_playback_channel); // Requires X-Plane 12 API
        g_playback_channel = nullptr;
    }
    if (g_current_pcm_data) {
        delete g_current_pcm_data;
        g_current_pcm_data = nullptr;
    }
}

void PlayVoiceAudio(const std::vector<int16_t>& pcmData) {
    if (pcmData.empty()) return;

    // If already playing something, ignore or stop it
    if (g_playback_channel != nullptr) {
        XPLMDebugString("RadioPlugin: Already playing audio. Ignoring new request.\n");
        return;
    }

    // Allocate a copy of the PCM data to keep it alive during playback
    g_current_pcm_data = new std::vector<int16_t>(pcmData);

    int sampleRate = 44100;
    int numChannels = 1;
    
    g_playback_channel = XPLMPlayPCMOnBus(
        (void*)g_current_pcm_data->data(),
        (uint32_t)(g_current_pcm_data->size() * sizeof(int16_t)),
        FMOD_SOUND_FORMAT_PCM16,
        sampleRate,
        numChannels,
        0, // no loop
        xplm_AudioRadioCom1, // Use COM1 radio bus
        MySoundCompleteCallback,
        nullptr
    );

    if (g_playback_channel) {
        XPLMDebugString("RadioPlugin: Started playing PCM audio on COM1 radio bus.\n");
    } else {
        XPLMDebugString("RadioPlugin: Failed to play PCM audio.\n");
        delete g_current_pcm_data;
        g_current_pcm_data = nullptr;
    }
}
