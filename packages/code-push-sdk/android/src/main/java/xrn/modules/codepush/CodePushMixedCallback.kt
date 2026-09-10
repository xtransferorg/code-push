package xrn.modules.codepush

import com.facebook.react.bridge.UiThreadUtil
import com.microsoft.codepush.react.CodePushPatchException
import com.microsoft.codepush.react.CodePushPatchState
import com.microsoft.codepush.react.CodePushUtils
import com.microsoft.codepush.react.DownloadProgress
import com.microsoft.codepush.react.DownloadProgressCallback as MicrosoftDownloadProgressCallback
import java.util.concurrent.CopyOnWriteArrayList

class CodePushMixedCallback : SyncStatusChangedCallback, MicrosoftDownloadProgressCallback,
    HandleBinaryVersionMismatchCallback {

    data class CheckDownloadSubscriber(
        val syncStatusChanged: SyncStatusChangedCallback?,
        val downloadProgress: DownloadProgressCallback?,
        val handleBinaryVersionMismatch: HandleBinaryVersionMismatchCallback?,
    )

    /** 写：主线程；读：任意线程（multicast 从 IO/下载线程取快照广播给订阅者）。 */
    private val checkDownloadSubscribers = CopyOnWriteArrayList<CheckDownloadSubscriber>()

    fun addSubscriber(subscriber: CheckDownloadSubscriber) {
        checkDownloadSubscribers.add(subscriber)
    }

    fun clearSubscriber() {
        checkDownloadSubscribers.clear()
    }

    override fun call(
        status: SyncStatus,
        remotePackage: RemotePackage?,
        localPackage: LocalPackage?,
        e: Throwable?
    ) {
        runOnUiThread {
            for (sub in checkDownloadSubscribers) {
                try {
                    sub.syncStatusChanged?.call(status, remotePackage, localPackage, e)
                } catch (e: Throwable) {
                    CodePushUtils.log(e)
                }
            }
        }
    }

    override fun call(downloadProgress: DownloadProgress) {
        runOnUiThread {
            for (sub in checkDownloadSubscribers) {
                try {
                    sub.downloadProgress?.onProgress(downloadProgress)
                } catch (e: Throwable) {
                    CodePushUtils.log(e)
                }
            }
        }
    }

    override fun patchEvent(state: CodePushPatchState, errorCode: Int) {
        runOnUiThread {
            when (state) {
                CodePushPatchState.START -> SyncStatus.PATCH_START
                CodePushPatchState.DONE -> SyncStatus.PATCH_DONE
                CodePushPatchState.ERROR -> SyncStatus.PATCH_ERROR
            }.let {
                val error = if (state == CodePushPatchState.ERROR) {
                    CodePushPatchException("CodePush Patch exception.", errorCode)
                } else {
                    null
                }

                for (sub in checkDownloadSubscribers) {
                    try {
                        sub.syncStatusChanged?.call(
                            it,
                            null,
                            null,
                            error
                        )
                    } catch (e: Throwable) {
                        CodePushUtils.log(e)
                    }
                }
            }
        }
    }

    override fun call(update: RemotePackage?) {
        runOnUiThread {
            for (sub in checkDownloadSubscribers) {
                try {
                    sub.handleBinaryVersionMismatch?.call(update)
                } catch (e: Throwable) {
                    CodePushUtils.log(e)
                }
            }
        }
    }

    private fun runOnUiThread(runnable: Runnable) {
        if (UiThreadUtil.isOnUiThread()) {
            runnable.run()
        } else {
            UiThreadUtil.runOnUiThread(runnable)
        }
    }

}