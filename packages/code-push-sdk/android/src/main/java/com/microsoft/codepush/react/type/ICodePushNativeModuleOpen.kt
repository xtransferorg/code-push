package com.microsoft.codepush.react.type

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap

interface ICodePushNativeModuleOpen {

    fun isFailedUpdate(packageHash: String?): Boolean

    fun setLatestRollbackInfo(packageHash: String?)

    fun isFirstRun(packageHash: String?): Boolean

    fun notifyApplicationReady()

    fun clearUpdates()

    /**
     * Immediately restarts the app.
     *
     * @param onlyIfUpdateIsPending Indicates whether you want the restart to no-op if there isn't currently a pending update.
     */
    fun restartApp(reactApplicationContext: ReactApplicationContext, onlyIfUpdateIsPending: Boolean = false): Boolean

    fun recordStatusReported(statusReport: ReadableMap)

    fun saveStatusReportForRetry(statusReport: ReadableMap)

    fun downloadAndReplaceCurrentBundle(remoteBundleUrl: String)

}