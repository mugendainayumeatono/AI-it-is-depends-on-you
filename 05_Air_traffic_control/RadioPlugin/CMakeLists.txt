cmake_minimum_required(VERSION 3.15)
project(RadioPlugin LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Define the plugin target
add_library(RadioPlugin SHARED
    src/RadioPlugin.cpp
    src/AudioPlayback.cpp
    src/AudioCapture.cpp
)

# Rename output to .xpl
set_target_properties(RadioPlugin PROPERTIES PREFIX "" SUFFIX ".xpl")
if(APPLE)
    set_target_properties(RadioPlugin PROPERTIES SUFFIX ".xpl")
endif()

# Assuming SDK is extracted to SDK/CHeaders in the current directory
set(XPLANE_SDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/SDK/CHeaders")

if(NOT EXISTS "${XPLANE_SDK_DIR}/XPLM/XPLMDefs.h")
    message(WARNING "X-Plane SDK not found at ${XPLANE_SDK_DIR}. Please download it from https://developer.x-plane.com/sdk/")
endif()

target_include_directories(RadioPlugin PRIVATE
    "${XPLANE_SDK_DIR}/XPLM"
    "${XPLANE_SDK_DIR}/Widgets"
    "src"
)

# Define X-Plane required macros depending on OS
if(WIN32)
    target_compile_definitions(RadioPlugin PRIVATE IBM=1 XPLM200=1 XPLM210=1 XPLM300=1 XPLM301=1 XPLM302=1 XPLM303=1 XPLM400=1)
elseif(APPLE)
    target_compile_definitions(RadioPlugin PRIVATE APL=1 XPLM200=1 XPLM210=1 XPLM300=1 XPLM301=1 XPLM302=1 XPLM303=1 XPLM400=1)
    set_target_properties(RadioPlugin PROPERTIES LINK_FLAGS "-undefined dynamic_lookup")
elseif(UNIX)
    target_compile_definitions(RadioPlugin PRIVATE LIN=1 XPLM200=1 XPLM210=1 XPLM300=1 XPLM301=1 XPLM302=1 XPLM303=1 XPLM400=1)
    target_compile_options(RadioPlugin PRIVATE -fPIC -fvisibility=hidden)
endif()
