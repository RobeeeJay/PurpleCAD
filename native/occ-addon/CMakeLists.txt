cmake_minimum_required(VERSION 3.15)
project(occ_addon CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Resolve node-addon-api include dir at configure time so we don't need
# to hard-code paths.  cmake-js supplies CMAKE_JS_INC (Node.js headers)
# and CMAKE_JS_SRC (win_delay_load_hook.cc on Windows, empty elsewhere).
execute_process(
  COMMAND node -p "require('node-addon-api').include"
  WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
  OUTPUT_VARIABLE NODE_ADDON_API_DIR
  OUTPUT_STRIP_TRAILING_WHITESPACE
)
# node -p wraps the path in quotes on some platforms; strip them.
string(REPLACE "\"" "" NODE_ADDON_API_DIR "${NODE_ADDON_API_DIR}")

# OpenCASCADE — look for the homebrew installation on macOS first, then fall
# back to whatever find_package would find on a system-wide install.
find_package(OpenCASCADE REQUIRED
  HINTS
    "$ENV{HOME}/occ-8.0.1-arm64/lib/cmake/opencascade"
    "$ENV{HOME}/occ-8.0-arm64/lib/cmake/opencascade"
    "$ENV{HOME}/occ-arm64/lib/cmake/opencascade"
    /opt/homebrew/opt/opencascade/lib/cmake/opencascade
    /usr/local/opt/opencascade/lib/cmake/opencascade
)

# meshoptimizer, vendored at a pinned release (third_party/meshoptimizer/
# VENDORED.md).  Only the translation units the addon uses are compiled.
set(MESHOPT_DIR ${CMAKE_CURRENT_SOURCE_DIR}/third_party/meshoptimizer/src)

add_library(${PROJECT_NAME} SHARED
  src/binding.cc
  src/mesh_tools.cpp
  ${MESHOPT_DIR}/allocator.cpp
  ${MESHOPT_DIR}/indexgenerator.cpp
  ${MESHOPT_DIR}/simplifier.cpp
  ${CMAKE_JS_SRC}
)

# .node is the Node.js native addon extension; no "lib" prefix.
set_target_properties(${PROJECT_NAME} PROPERTIES
  PREFIX ""
  SUFFIX ".node"
)

target_include_directories(${PROJECT_NAME} PRIVATE
  ${MESHOPT_DIR}
  ${CMAKE_JS_INC}
  ${NODE_ADDON_API_DIR}
  ${OpenCASCADE_INCLUDE_DIR}
)

# mesh_tools.cpp measures deviation across threads; gcc needs pthread linked.
find_package(Threads REQUIRED)

target_link_libraries(${PROJECT_NAME} PRIVATE
  ${CMAKE_JS_LIB}
  Threads::Threads
  TKernel
  TKMath
  TKG2d
  TKG3d
  TKGeomBase
  TKGeomAlgo
  TKBRep
  TKTopAlgo
  TKPrim
  TKBO
  TKBool
  TKOffset
  TKFillet
  TKShHealing
  TKMesh
  TKXSBase
  TKDESTEP
)

# NAPI_CPP_EXCEPTIONS lets node-addon-api throw Napi::Error from catch blocks.
# NAPI_VERSION=9 matches Node.js 24 (N-API was stabilised at v9 in Node 18).
target_compile_definitions(${PROJECT_NAME} PRIVATE
  NAPI_CPP_EXCEPTIONS
  NAPI_VERSION=9
)
