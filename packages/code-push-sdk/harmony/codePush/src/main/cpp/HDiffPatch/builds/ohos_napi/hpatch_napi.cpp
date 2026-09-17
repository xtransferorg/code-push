#include "napi/native_api.h"
#include <string>
#include <hilog/log.h>
#include "../../builds/android_ndk_jni_mk/hpatch.h"

#define LOG_TAG "HPatch"

static bool GetStringArg(napi_env env, napi_value val, std::string& out) {
    size_t len = 0;
    napi_status s = napi_get_value_string_utf8(env, val, nullptr, 0, &len);
    if (s != napi_ok) return false;
    out.resize(len);
    if (len == 0) return true;
    return napi_get_value_string_utf8(env, val, &out[0], len + 1, &len) == napi_ok;
}

static napi_value Patch(napi_env env, napi_callback_info info) {
    size_t argc = 4;
    napi_value argv[4];
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

    std::string oldPath, diffPath, newPath;
    int64_t cacheMemory = -1;
    GetStringArg(env, argv[0], oldPath);
    GetStringArg(env, argv[1], diffPath);
    GetStringArg(env, argv[2], newPath);
    if (argc >= 4) napi_get_value_int64(env, argv[3], &cacheMemory);

    int result = hpatchz(
        oldPath.empty() ? nullptr : oldPath.c_str(),
        diffPath.c_str(),
        newPath.c_str(),
        cacheMemory
    );

    OH_LOG_INFO(LOG_APP,
        "result=%{public}d old=%{public}s diff=%{public}s new=%{public}s cache=%{public}lld",
        result,              // %{public}d
        oldPath.c_str(),     // %{public}s
        diffPath.c_str(),    // %{public}s
        newPath.c_str(),     // %{public}s
        (long long)cacheMemory); // %{public}lld

    napi_value ret;
    napi_create_int32(env, result, &ret);
    return ret;
}

EXTERN_C_START
static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor desc[] = {
        { "patch", nullptr, Patch, nullptr, nullptr, nullptr, napi_default, nullptr }
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    return exports;
}
EXTERN_C_END

static napi_module hpatchModule = {
    .nm_version       = 1,
    .nm_flags         = 0,
    .nm_filename      = nullptr,
    .nm_register_func = Init,
    .nm_modname       = "hpatchz",
    .nm_priv          = nullptr,
    .reserved         = { 0 },
};

extern "C" __attribute__((constructor)) void RegisterHPatchModule() {
    napi_module_register(&hpatchModule);
}