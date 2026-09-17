// hpatch.c
// Created by sisong on 2019-12-30.
#include "hpatch.h"

#define _IS_NEED_PRINT_LOG              0
#ifndef _IS_USED_MULTITHREAD
#define _IS_USED_MULTITHREAD            0
#endif
#define _IS_NEED_DIR_DIFF_PATCH         1
#define _IS_NEED_MAIN                   0
#define _IS_NEED_CMDLINE                0
#define _IS_NEED_SFX                    0
#define _IS_NEED_ALL_CompressPlugin     0
#include "../../hpatchz.c"

#ifdef _CompressPlugin_bz2
# ifdef BZ_NO_STDIO
#ifdef __cplusplus
extern "C" {
#endif
void bz_internal_error(int errcode){
    LOG_ERR("\n\nbzip2 v%s: internal error number %d.\n",
            BZ2_bzlibVersion(),errcode);
    exit(HPATCH_DECOMPRESSER_DECOMPRESS_ERROR);
}
#ifdef __cplusplus
}
#endif
# endif
#endif

    static inline size_t getCacheMemory(int64_t cacheMemory){
        #define kPatchCacheSize_def  (1024*256)
        #define kPatchCacheSize_max ((int64_t)((size_t)(~(size_t)0)))
        if (cacheMemory<0) return kPatchCacheSize_def;
        if (sizeof(int64_t)<=sizeof(size_t)) return (size_t)cacheMemory;
        return (size_t)((cacheMemory<kPatchCacheSize_max)?cacheMemory:kPatchCacheSize_max);
    }

int hpatchz(const char *oldFileName,const char *diffFileName,
            const char *outNewFileName,int64_t cacheMemory){
#if (_IS_NEED_DIR_DIFF_PATCH)
    TDirDiffInfo dirDiffInfo;
    if (getDirDiffInfoByFile(&dirDiffInfo,diffFileName,0,0) && dirDiffInfo.isDirDiff){
        size_t cacheSize=getCacheMemory(cacheMemory);
        TDirPatchChecksumSet checksumSet={0,hpatch_FALSE,hpatch_TRUE,hpatch_TRUE,hpatch_FALSE};
        return hpatch_dir(oldFileName,diffFileName,outNewFileName,
                          hpatch_FALSE,cacheSize,kMaxOpenFileNumber_default_patch,
                          &checksumSet,&defaultPatchDirlistener,0,0);
    }
#endif
    return hpatch(oldFileName,diffFileName,outNewFileName,
                  hpatch_FALSE,getCacheMemory(cacheMemory),0,0,1,1);
}
