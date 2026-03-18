#include "XPLMMock.h"
#include <iostream>
#include <cassert>
#include <vector>

// Mock Global Initialization
int MockXPLM::currentCom1Frequency = 0;
bool MockXPLM::pttCaptured = false;
bool MockXPLM::audioPlaying = false;
std::vector<int16_t> MockXPLM::lastPlayedPcm = {};

// We need to include the source files directly for this simple test runner
// since we are mocking the symbols they depend on.
#define XPLM_MOCK
#include "../RadioPlugin/src/AudioPlayback.cpp"
#include "../RadioPlugin/src/AudioCapture.cpp"
#include "../RadioPlugin/src/RadioPlugin.cpp"

void TestAudioPlayback() {
    std::cout << "Running TestAudioPlayback..." << std::endl;
    MockXPLM::Reset();
    
    // Test normal playback
    std::vector<int16_t> testPcm = {100, 200, 300, 400};
    PlayVoiceAudio(testPcm);
    assert(MockXPLM::audioPlaying == true);
    assert(MockXPLM::lastPlayedPcm.size() == testPcm.size());
    
    // Test playing when already playing
    PlayVoiceAudio(testPcm); // Should be ignored
    
    // Test empty data
    MockXPLM::Reset();
    std::vector<int16_t> emptyPcm;
    PlayVoiceAudio(emptyPcm);
    assert(MockXPLM::audioPlaying == false);

    // Test lifecycle functions
    InitAudioPlayback();
    CleanupAudioPlayback();
    
    std::cout << "TestAudioPlayback PASSED." << std::endl;
}

void TestAudioCapture() {
    std::cout << "Running TestAudioCapture..." << std::endl;
    MockXPLM::Reset();
    
    InitAudioCapture();
    assert(IsRecording() == false);
    
    // Normal start/stop
    StartRecording();
    assert(IsRecording() == true);
    StopRecording();
    assert(IsRecording() == false);
    
    // Double start
    StartRecording();
    StartRecording(); 
    assert(IsRecording() == true);
    
    // Double stop
    StopRecording();
    StopRecording();
    assert(IsRecording() == false);

    CleanupAudioCapture();
    
    std::cout << "TestAudioCapture PASSED." << std::endl;
}

void TestRadioPluginPTT() {
    std::cout << "Running TestRadioPluginPTT..." << std::endl;
    MockXPLM::Reset();
    
    // Setup global state required for RadioPlugin logic
    g_com1_freq_ref = (XPLMDataRef)0x123;
    
    // 1. Test case: Not on the target frequency
    MockXPLM::currentCom1Frequency = 118000;
    int result = PTTCommandHandler(nullptr, xplm_CommandBegin, nullptr);
    assert(result == 1);
    
    // 2. Test case: On target frequency, PTT Begin
    MockXPLM::currentCom1Frequency = 121500;
    result = PTTCommandHandler(nullptr, xplm_CommandBegin, nullptr);
    assert(result == 0);
    assert(IsRecording() == true);
    
    // 3. Test case: On target frequency, PTT End
    result = PTTCommandHandler(nullptr, xplm_CommandEnd, nullptr);
    assert(result == 0);
    assert(IsRecording() == false);
    
    std::cout << "TestRadioPluginPTT PASSED." << std::endl;
}

void TestPluginLifecycle() {
    std::cout << "Running TestPluginLifecycle..." << std::endl;
    
    char name[256], sig[256], desc[256];
    XPluginStart(name, sig, desc);
    XPluginEnable();
    XPluginReceiveMessage(0, 0, nullptr);
    XPluginDisable();
    XPluginStop();
    
    std::cout << "TestPluginLifecycle PASSED." << std::endl;
}

int main() {
    try {
        TestAudioPlayback();
        TestAudioCapture();
        TestRadioPluginPTT();
        TestPluginLifecycle();
        std::cout << "\nAll tests completed successfully!" << std::endl;
    } catch (const std::exception& e) {
        std::cerr << "Test failed with exception: " << e.what() << std::endl;
        return 1;
    }
    return 0;
}
