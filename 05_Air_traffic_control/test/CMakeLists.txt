cmake_minimum_required(VERSION 3.15)
project(RadioPluginTests LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Define the test executable
add_executable(run_tests
    TestMain.cpp
)

# Set include directories
# We need the Mock directory, the fake XPLM directory inside it, and the original src directory
target_include_directories(run_tests PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}/XPLM"
    "${CMAKE_CURRENT_SOURCE_DIR}/../RadioPlugin/src"
)

# Since we are including .cpp files directly in TestMain.cpp to mock symbols,
# we don't necessarily need to link them, but we must define the same macros
# that the source files expect.
target_compile_definitions(run_tests PRIVATE 
    LIN=1 
    XPLM_MOCK=1
)

# Allow the test to run
add_custom_command(TARGET run_tests POST_BUILD
    COMMAND run_tests
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    COMMENT "Running unit tests..."
)
