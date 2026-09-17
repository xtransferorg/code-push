cmake_minimum_required(VERSION 3.4.1)
project(hpatchz C CXX)

set(HDP_ROOT ${CMAKE_CURRENT_SOURCE_DIR})

add_compile_definitions(
    _IS_NEED_BLOCK_DEV=0
    _IS_NEED_MAIN=0
    _IS_NEED_CMDLINE=0
    _IS_NEED_SFX=0
    _IS_USED_MULTITHREAD=0
    _IS_NEED_DIR_DIFF_PATCH=1
    _IS_NEED_ALL_CompressPlugin=0
    _7ZIP_ST
    Z7_ST
    BZ_NO_STDIO
    _FILE_OFFSET_BITS=64
    _LARGEFILE_SOURCE
    _LARGEFILE64_SOURCE
)

# ==== 源码收集 ====
file(GLOB HPATCH_CORE
    "${HDP_ROOT}/libHDiffPatch/HPatch/*.c"
    "${HDP_ROOT}/libHDiffPatch/HDiff/private_diff/limit_mem_diff/adler_roll.c"
    "${HDP_ROOT}/dirDiffPatch/dir_patch/*.c"
    "${HDP_ROOT}/bsdiff_wrapper/*.c"
    "${HDP_ROOT}/vcdiff_wrapper/*.c"
    "${HDP_ROOT}/file_for_patch.c"
    "${HDP_ROOT}/builds/android_ndk_jni_mk/hpatch.c"
)

file(GLOB BZIP2_SRC "${HDP_ROOT}/bzip2/*.c")
file(GLOB LZMA_SRC  "${HDP_ROOT}/lzma/C/*.c")
file(GLOB ZSTD_SRC
    "${HDP_ROOT}/zstd/lib/common/*.c"
    "${HDP_ROOT}/zstd/lib/decompress/*.c"
)

# 过滤掉 zstd 的 ASM 汇编文件（鸿蒙 arm64 下也能用，但先排除避免意外）
list(FILTER ZSTD_SRC EXCLUDE REGEX ".*_asm.*")

# ==== 入口壳 ====
set(NAPI_WRAPPER ${HDP_ROOT}/builds/ohos_napi/hpatch_napi.cpp)

# ==== 产出动态库 libhpatchz.so ====
add_library(hpatchz SHARED
    ${HPATCH_CORE}
    ${BZIP2_SRC}
    ${LZMA_SRC}
    ${ZSTD_SRC}
    ${NAPI_WRAPPER}
)

target_include_directories(hpatchz PRIVATE
    ${HDP_ROOT}
    ${HDP_ROOT}/bzip2
    ${HDP_ROOT}/lzma/C
    ${HDP_ROOT}/zstd/lib
)

# 鸿蒙 N-API 依赖
find_library(libace-napi libace_napi.z.so)

# 鸿蒙系统自带的 zlib（libz.so），供 HDiffPatch 的 zlib 解压插件使用
find_library(libz-lib z)

# 鸿蒙系统自带的log
find_library(libhilog-ndk libhilog_ndk.z.so)

target_link_libraries(hpatchz PUBLIC
    ${libace-napi}
    ${libz-lib}
    ${libhilog-ndk}
)