package com.microsoft.codepush.react.type

import com.microsoft.codepush.react.CodePushConfiguration
import com.microsoft.codepush.react.CodePushInstallMode
import com.microsoft.codepush.react.CodePushUpdateState
import com.microsoft.codepush.react.DownloadProgressCallback
import xrn.modules.codepush.LocalPackage
import xrn.modules.codepush.RemotePackage
import xrn.modules.codepush.RollbackInfo
import xrn.modules.codepush.sdk.StatusReport

interface ICodePushNativeModuleKTDelegate : ICodePushNativeModuleOpen {
    fun getConfigure(): CodePushConfiguration

    fun downloadUpdate(
        updatePackage: RemotePackage,
        notifyProgress: Boolean,
        callback: DownloadProgressCallback?
    ): LocalPackage?

    fun installUpdate(
        updatePackage: LocalPackage,
        installMode: CodePushInstallMode,
        minimumBackgroundDuration: Int,
    )

    fun getNewStatusReport(): StatusReport?

    fun getUpdateMetadata(updateState: CodePushUpdateState): LocalPackage?

    fun getLatestRollbackInfo(): RollbackInfo?

    fun getCurrentPackage(): LocalPackage?

    fun getPackage(packageHash: String): LocalPackage?

}