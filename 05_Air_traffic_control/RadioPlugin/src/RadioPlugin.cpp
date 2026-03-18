#include "XPLMPlugin.h"
#include "XPLMUtilities.h"
#include "XPLMDataAccess.h"
#include "XPLMProcessing.h"

#include "AudioCapture.h"
#include "AudioPlayback.h"

#include <string>
#include <cstring>

#if IBM
    #include <windows.h>
    #define PLUGIN_API __declspec(dllexport)
#else
    #define PLUGIN_API
#endif

// --- Global DataRefs and Commands ---
static XPLMDataRef g_com1_freq_ref = nullptr;
static XPLMCommandRef g_ptt_cmd = nullptr;

// We assume the designated "takeover" frequency is 121.500 MHz (represented as 121500 in XP12)
const int TARGET_FREQUENCY = 121500;

// Command Callback for PTT
static int PTTCommandHandler(XPLMCommandRef inCommand, XPLMCommandPhase inPhase, void * inRefcon) {
    if (g_com1_freq_ref == nullptr) return 1;

    // Check if the user is tuned to the right frequency
    int current_freq = XPLMGetDatai(g_com1_freq_ref);
    if (current_freq == TARGET_FREQUENCY) {
        if (inPhase == xplm_CommandBegin) {
            XPLMDebugString("RadioPlugin: PTT Pressed. Starting capture...\n");
            StartRecording();
        } else if (inPhase == xplm_CommandEnd) {
            XPLMDebugString("RadioPlugin: PTT Released. Stopping capture.\n");
            StopRecording();
            
            // Note: In a real implementation, you would send the recorded data over the network here.
        }
        
        // Return 0 to prevent the default X-Plane behavior (so we fully takeover the radio)
        return 0; 
    }
    
    // Not on our frequency, let the default simulator behavior handle it
    return 1;
}

extern "C" {

PLUGIN_API int XPluginStart(
    char * outName,
    char * outSig,
    char * outDesc) 
{
    std::strcpy(outName, "ATCRadioTakeover");
    std::strcpy(outSig, "com.example.atcradiotakeover");
    std::strcpy(outDesc, "A plugin to take over radio frequencies for voice AI.");

    XPLMDebugString("RadioPlugin: Starting...\n");

    // Initialize Subsystems
    InitAudioCapture();
    InitAudioPlayback();

    // Find DataRefs
    g_com1_freq_ref = XPLMFindDataRef("sim/cockpit2/radios/actuators/com1_frequency_hz_833");
    if (!g_com1_freq_ref) {
        XPLMDebugString("RadioPlugin: ERROR - Could not find COM1 frequency dataref.\n");
    }

    // Intercept PTT Command
    g_ptt_cmd = XPLMFindCommand("sim/radios/com1_transmit");
    if (g_ptt_cmd) {
        XPLMRegisterCommandHandler(g_ptt_cmd, PTTCommandHandler, 1, nullptr);
    } else {
        XPLMDebugString("RadioPlugin: ERROR - Could not find com1_transmit command.\n");
    }

    return 1;
}

PLUGIN_API void XPluginStop(void) 
{
    if (g_ptt_cmd) {
        XPLMUnregisterCommandHandler(g_ptt_cmd, PTTCommandHandler, 1, nullptr);
    }

    CleanupAudioCapture();
    CleanupAudioPlayback();

    XPLMDebugString("RadioPlugin: Stopped.\n");
}

PLUGIN_API void XPluginDisable(void) { }
PLUGIN_API int  XPluginEnable(void) { return 1; }
PLUGIN_API void XPluginReceiveMessage(XPLMPluginID inFrom, int inMsg, void * inParam) { }

} // extern "C"
