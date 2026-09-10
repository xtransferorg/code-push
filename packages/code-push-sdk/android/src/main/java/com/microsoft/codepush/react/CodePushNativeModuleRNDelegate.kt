package com.microsoft.codepush.react

import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.microsoft.codepush.react.type.ICodePushNativeModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext


internal class CodePushNativeModuleRNDelegate
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
) : ICodePushNativeModule by delegate {

    fun getConfigure(promise: Promise) {
        try {
            val configure = CodePushUtils.convertJsonObjectToWritable(delegate.getRawConfigure())
            promise.resolve(configure)
        } catch (e: CodePushUnknownException) {
            CodePushUtils.log(e)
            promise.reject(e)
        }
    }

    fun downloadUpdate(
        reactApplicationContext: ReactApplicationContext,
        updatePackage: ReadableMap,
        notifyProgress: Boolean,
        promise: Promise
    ) = launch {
        val localPackage = withContext(Dispatchers.IO) {
            delegate.downloadUpdate(
                CodePushUtils.convertReadableToJsonObject(updatePackage),
                notifyProgress,
                object : DownloadProgressCallback {
                    override fun call(downloadProgress: DownloadProgress) {
                        reactApplicationContext
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit(
                                CodePushConstants.DOWNLOAD_PROGRESS_EVENT_NAME,
                                downloadProgress.createWritableMap()
                            )

                    }

                    override fun patchEvent(state: CodePushPatchState, errorCode: Int) {
                        reactApplicationContext
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit(
                                CodePushConstants.CODE_PUSH_PATCH_STATUS_NAME,
                                Arguments.createMap().apply {
                                    putString("state", state.value)
                                    putInt("code", errorCode)
                                }
                            )
                    }
                }
            )
        }

        if (localPackage == null) {
            promise.resolve(null)
        } else {
            promise.resolve(CodePushUtils.convertJsonObjectToWritable(localPackage))
        }
    }

    fun installUpdate(
        reactApplicationContext: ReactApplicationContext,
        updatePackage: ReadableMap,
        installMode: CodePushInstallMode,
        minimumBackgroundDuration: Int,
        promise: Promise
    ) = launch {
        try {
            withContext(Dispatchers.IO) {
                delegate.installUpdate(
                    reactApplicationContext,
                    CodePushUtils.convertReadableToJsonObject(updatePackage),
                    installMode,
                    minimumBackgroundDuration
                )
            }
            promise.resolve("")
        } catch (e: CodePushUnknownException) {
            CodePushUtils.log(e)
            promise.reject(e)
        }
    }

    fun getUpdateMetadata(updateState: CodePushUpdateState, promise: Promise) = launch {
        try {
            val meta = withContext(Dispatchers.IO) { delegate.getRawUpdateMetadata(updateState) }
            if (meta == null) {
                promise.resolve(null)
            } else {
                promise.resolve(CodePushUtils.convertJsonObjectToWritable(meta))
            }
        } catch (e: CodePushUnknownException) {
            promise.reject(e)
        }
    }

    fun getNewStatusReport(promise: Promise) = launch {
        try {
            val report = withContext(Dispatchers.IO) { delegate.getRawNewStatusReport() }
            if (report == null) {
                promise.resolve("")
            } else {
                promise.resolve(report)
            }
        } catch (e: CodePushUnknownException) {
            promise.reject(e)
        }
    }

    private fun launch(block: suspend CoroutineScope.() -> Unit) {
        CoroutineScope(Dispatchers.Main + Job()).launch(block = block)
    }

}