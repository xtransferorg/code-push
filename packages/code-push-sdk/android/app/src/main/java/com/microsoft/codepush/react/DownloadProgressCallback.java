package com.microsoft.codepush.react;

interface DownloadProgressCallback {
    void call(DownloadProgress downloadProgress);

    void patchEvent(CodePushPatchState state,int errorCode);
}
