#pragma once

#include <vector>
#include <string>
#include <map>
#include <functional>
#include <cstdint>

// --- Mocked X-Plane SDK Definitions ---
typedef void* XPLMDataRef;
typedef void* XPLMCommandRef;
typedef int   XPLMPluginID; // Added this

enum XPLMCommandPhase {
    xplm_CommandBegin = 0,
    xplm_CommandEnd = 1
};

typedef int (*XPLMCommandHandler_f)(XPLMCommandRef inCommand, XPLMCommandPhase inPhase, void* inRefcon);
typedef void (*XPLMPCMComplete_f)(void* inRefcon, int status);

enum XPLMAudioBus {
    xplm_AudioRadioCom1 = 0
};

// --- Global Mock State ---
struct MockXPLM {
    static int currentCom1Frequency;
    static bool pttCaptured;
    static bool audioPlaying;
    static std::vector<int16_t> lastPlayedPcm;
    
    static void Reset() {
        currentCom1Frequency = 0;
        pttCaptured = false;
        audioPlaying = false;
        lastPlayedPcm.clear();
    }
};

// --- Mocked X-Plane SDK Functions ---
inline void XPLMDebugString(const char* s) { /* Silent for tests */ }

inline XPLMDataRef XPLMFindDataRef(const char* name) {
    if (std::string(name) == "sim/cockpit2/radios/actuators/com1_frequency_hz_833") {
        return (XPLMDataRef)0x123;
    }
    return nullptr;
}

inline int XPLMGetDatai(XPLMDataRef dataref) {
    if (dataref == (XPLMDataRef)0x123) {
        return MockXPLM::currentCom1Frequency;
    }
    return 0;
}

inline XPLMCommandRef XPLMFindCommand(const char* name) {
    if (std::string(name) == "sim/radios/com1_transmit") {
        return (XPLMCommandRef)0x456;
    }
    return nullptr;
}

inline void* XPLMPlayPCMOnBus(void* audioBuffer, uint32_t bufferSize, int format, int freq, int channels, int loop, XPLMAudioBus bus, XPLMPCMComplete_f callback, void* refcon) {
    MockXPLM::audioPlaying = true;
    MockXPLM::lastPlayedPcm.assign((int16_t*)audioBuffer, (int16_t*)audioBuffer + (bufferSize / sizeof(int16_t)));
    if (callback) callback(refcon, 0); 
    return (void*)0x789;
}

inline void XPLMRegisterCommandHandler(XPLMCommandRef, XPLMCommandHandler_f, int, void*) {}
inline void XPLMUnregisterCommandHandler(XPLMCommandRef, XPLMCommandHandler_f, int, void*) {}
