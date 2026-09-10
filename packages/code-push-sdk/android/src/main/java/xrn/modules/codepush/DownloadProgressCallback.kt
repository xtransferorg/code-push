package xrn.modules.codepush

import com.microsoft.codepush.react.DownloadProgress

interface DownloadProgressCallback {
    fun onProgress(downloadProgress: DownloadProgress)
}