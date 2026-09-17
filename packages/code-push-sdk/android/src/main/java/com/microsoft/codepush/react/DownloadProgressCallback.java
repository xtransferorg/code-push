package com.microsoft.codepush.react;

public interface DownloadProgressCallback {
    void call(DownloadProgress downloadProgress);

    void patchEvent(CodePushPatchState state,int errorCode);
}
