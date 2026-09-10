package com.microsoft.codepush.react

import android.content.Context
import com.microsoft.codepush.react.GsonUtils.fromJsonObj
import com.microsoft.codepush.react.type.ICodePushNativeModule
import com.microsoft.codepush.react.type.ICodePushNativeModuleKTDelegate
import org.json.JSONObject
import xrn.modules.codepush.LocalPackage
import xrn.modules.codepush.RemotePackage
import xrn.modules.codepush.RollbackInfo
import xrn.modules.codepush.sdk.StatusReport

internal class CodePushNativeModuleKTDelegate
@JvmOverloads
constructor(
    context: Context,
    codePush: CodePush,
    updateManager: CodePushUpdateManager,
    telemetryManager: CodePushTelemetryManager,
    settingsManager: SettingsManager,
    private val delegate: ICodePushNativeModule = CodePushNativeModuleInternal(
        context, codePush, updateManager, telemetryManager, settingsManager
    )
) : ICodePushNativeModuleKTDelegate, ICodePushNativeModule by delegate {

    override fun getConfigure(): CodePushConfiguration {
        val json = delegate.getRawConfigure()

        return fromJsonObj<CodePushConfiguration>(json)!!
    }

    override fun downloadUpdate(
        updatePackage: RemotePackage, notifyProgress: Boolean, callback: DownloadProgressCallback?
    ): LocalPackage? {
        val json = delegate.downloadUpdate(
            updatePackage.toJsonObj(), notifyProgress, callback
        ) ?: return null

        return fromJsonObj<LocalPackage>(json)
    }

    override fun installUpdate(
        updatePackage: LocalPackage,
        installMode: CodePushInstallMode,
        minimumBackgroundDuration: Int,
    ) {
        delegate.installUpdate(
            reactApplicationContext = null,
            updatePackage.toJsonObj(),
            installMode,
            minimumBackgroundDuration
        )
    }

    override fun getNewStatusReport(): StatusReport? {
        val rawMap = delegate.getRawNewStatusReport() ?: return null
        val rawJsonObj = CodePushUtils.convertReadableToJsonObject(rawMap)
        val instance = fromJsonObj<StatusReport>(rawJsonObj)

        return instance
    }

    override fun getUpdateMetadata(updateState: CodePushUpdateState): LocalPackage? {
        val json = delegate.getRawUpdateMetadata(updateState) ?: return null

        var updateMetadata = fromJsonObj<LocalPackage>(json)

        if (updateMetadata != null) {
            val failedInstall = isFailedUpdate(updateMetadata.packageHash)
            val isFirstRun = isFirstRun(updateMetadata.packageHash)

            updateMetadata = updateMetadata.copy(
                isPending = false,
                failedInstall = failedInstall,
                isFirstRun = isFirstRun
            )
        }

        return updateMetadata
    }

    override fun getLatestRollbackInfo(): RollbackInfo? {
        val json = delegate.getRawLatestRollbackInfo() ?: return null

        return fromJsonObj<RollbackInfo>(json)
    }

    override fun getCurrentPackage(): LocalPackage? {
        return getUpdateMetadata(CodePushUpdateState.LATEST)
    }

    override fun getPackage(packageHash: String): LocalPackage? {
        val json = delegate.getRawPackage(packageHash) ?: return null
        return fromJsonObj<LocalPackage>(json)
    }
}