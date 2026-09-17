package com.microsoft.codepush.react.type

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.microsoft.codepush.react.CodePushInstallMode
import com.microsoft.codepush.react.CodePushUpdateState
import com.microsoft.codepush.react.DownloadProgressCallback
import org.json.JSONObject

interface ICodePushNativeModuleInternal {

    fun getRawConfigure(): JSONObject

    fun downloadUpdate(
        updatePackage: JSONObject,
        notifyProgress: Boolean,
        callback: DownloadProgressCallback?
    ): JSONObject?

    fun getRawUpdateMetadata(updateState: CodePushUpdateState): JSONObject?

    fun getRawNewStatusReport(): WritableMap?

    fun installUpdate(
        reactApplicationContext: ReactApplicationContext?,
        updatePackage: JSONObject,
        installMode: CodePushInstallMode,
        minimumBackgroundDuration: Int,
    )

    fun getRawLatestRollbackInfo(): JSONObject?

    fun getRawPackage(packageHash: String): JSONObject?

}
