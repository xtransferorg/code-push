package com.microsoft.codepush.react

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.ChoreographerCompat
import com.facebook.react.modules.core.ReactChoreographer
import com.microsoft.codepush.react.type.ICodePushNativeModule
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.util.Date


internal open class CodePushNativeModuleInternal(
    private val context: Context,
    private val mCodePush: CodePush,
    private val mUpdateManager: CodePushUpdateManager,
    private val mTelemetryManager: CodePushTelemetryManager,
    private val mSettingsManager: SettingsManager
) : ICodePushNativeModule {
    private var mBinaryContentsHash: String? = null
    private var mLifecycleEventListener: LifecycleEventListener? = null
    private var mMinimumBackgroundDuration = 0

    private val mClientUniqueId: String
        @SuppressLint("HardwareIds")
        get() {
            return DeviceUtils.getUniqueDeviceId(context)
        }

    init {
        // Initialize module state while we have a reference to the current context.
        mBinaryContentsHash = mUpdateManager.getBinaryContentsHash(mCodePush.isDebugMode);
    }

    private fun loadBundleLegacy(applicationContext: ReactApplicationContext) {
        // The currentActivity can be null if it is backgrounded / destroyed, so we simply
        // no-op to prevent any null pointer exceptions.
        val currentActivity: Activity = applicationContext.currentActivity ?: return

        mCodePush.invalidateCurrentInstance()

        currentActivity.runOnUiThread { currentActivity.recreate() }
    }

    private fun loadBundle() {
        /*
        * initializeUpdateAfterRestart 统一收拢到加载 Bundle 前调用
        * */
//        Handler(Looper.getMainLooper()).post {
//            try {
//                mCodePush.initializeUpdateAfterRestart()
//            } catch (e: Exception) {
//                CodePushUtils.log(e)
//            }
//        }
    }

    private fun loadBundle(reactApplicationContext: ReactApplicationContext?) {
        if (reactApplicationContext == null) return

        clearLifecycleEventListener(reactApplicationContext)

        try {
            mCodePush.clearDebugCacheIfNeeded(resolveReactHost(reactApplicationContext))
        } catch (e: Exception) {
            // If we got error in out reflection we should clear debug cache anyway.
            mCodePush.clearDebugCacheIfNeeded(null)
        }

        try {
            // #1) Get the ReactInstanceManager instance, which is what includes the
            //     logic to reload the current React context.
            val reactHost = resolveReactHost(reactApplicationContext) ?: return

            val latestJSBundleFile =
                mCodePush.getJSBundleFileInternal(mCodePush.assetsBundleFileName)

            // #2) Update the locally stored JS bundle file path
            // 拆包，common 都是内置的，无需修改 JSBundleLoader
            // setJSBundle(instanceManager, latestJSBundleFile);

            // #3) Get the context creation method and fire it on the UI thread (which RN enforces)
            Handler(Looper.getMainLooper()).post {
                try {
                    // We don't need to resetReactRootViews anymore
                    // due the issue https://github.com/facebook/react-native/issues/14533
                    // has been fixed in RN 0.46.0
                    //resetReactRootViews(instanceManager);
                    reactHost.reload("")
                        /*
                         * initializeUpdateAfterRestart 统一收拢到加载 Bundle 前调用
                         * */
//                    mCodePush.initializeUpdateAfterRestart()
                } catch (e: Exception) {
                    // The recreation method threw an unknown exception
                    // so just simply fallback to restarting the Activity (if it exists)
                    loadBundleLegacy(reactApplicationContext)
                }
            }
        } catch (e: Exception) {
            // Our reflection logic failed somewhere
            // so fall back to restarting the Activity (if it exists)
            CodePushUtils.log("Failed to load the bundle, falling back to restarting the Activity (if it exists). " + e.message)
            loadBundleLegacy(reactApplicationContext)
        }
    }

    private fun clearLifecycleEventListener(reactApplicationContext: ReactApplicationContext?) {
        // Remove LifecycleEventListener to prevent infinite restart loop
        if (mLifecycleEventListener != null && reactApplicationContext != null) {
            reactApplicationContext.removeLifecycleEventListener(mLifecycleEventListener)
            mLifecycleEventListener = null
        }
    }

    // Use reflection to find the ReactInstanceManager. See #556 for a proposal for a less brittle way to approach this.
    @Throws(NoSuchFieldException::class, IllegalAccessException::class)
    private fun resolveReactHost(reactApplicationContext: ReactApplicationContext?): ReactHost? {
        var reactHost = mCodePush.reactHost
        if (reactHost != null) {
            return reactHost
        }

        val currentActivity: Activity = reactApplicationContext?.currentActivity ?: return null

        val reactApplication = currentActivity.application as ReactApplication
        reactHost = reactApplication.reactHost

        return reactHost
    }

    override fun getRawConfigure(): JSONObject {
        return JSONObject().apply {
            put("appVersion", mCodePush.appVersion)
            put("clientUniqueId", mClientUniqueId)
            put("deploymentKey", mCodePush.deploymentKey)
            put("serverUrl", mCodePush.serverUrl)
            put("commonHash", mCodePush.binaryCommonHash)

            // The binary hash may be null in debug builds
            if (mBinaryContentsHash != null) {
                put(CodePushConstants.PACKAGE_HASH_KEY, mBinaryContentsHash)
            }
        }
    }

    override fun downloadUpdate(
        updatePackage: JSONObject, notifyProgress: Boolean, callback: DownloadProgressCallback?
    ): JSONObject? {
        try {
            CodePushUtils.setJSONValueForKey(
                updatePackage,
                CodePushConstants.BINARY_MODIFIED_TIME_KEY,
                "" + mCodePush.binaryResourcesModifiedTime
            )

            var newPackage = mUpdateManager.getPackage(
                updatePackage.optString(CodePushConstants.PACKAGE_HASH_KEY)
            )

            if (newPackage != null) {
                return newPackage
            }

            mUpdateManager.downloadPackage(
                updatePackage,
                mCodePush.assetsBundleFileName,
                object : DownloadProgressCallback {
                    private var hasScheduledNextFrame = false
                    private var currentPatchStep: CodePushPatchState? = null
                    private var latestDownloadProgress: DownloadProgress? = null

                    override fun call(downloadProgress: DownloadProgress) {
                        if (!notifyProgress) {
                            return
                        }

                        latestDownloadProgress = downloadProgress
                        // If the download is completed, synchronously send the last event.
                        if (latestDownloadProgress!!.isCompleted) {
                            callback?.call(downloadProgress)
                            return
                        }

                        if (hasScheduledNextFrame) {
                            return
                        }

                        hasScheduledNextFrame = true
                        UiThreadUtil.runOnUiThread {
                            ReactChoreographer.getInstance()
                                .postFrameCallback(
                                    ReactChoreographer.CallbackType.TIMERS_EVENTS,
                                    object : ChoreographerCompat.FrameCallback() {
                                        override fun doFrame(frameTimeNanos: Long) {
                                            if (!latestDownloadProgress!!.isCompleted) {
                                                callback?.call(latestDownloadProgress)
                                            }

                                            hasScheduledNextFrame = false
                                        }
                                    })
                        }
                    }

                    override fun patchEvent(patchStep: CodePushPatchState, code: Int) {
                        UiThreadUtil.runOnUiThread {
                            ReactChoreographer.getInstance()
                                .postFrameCallback(
                                    ReactChoreographer.CallbackType.TIMERS_EVENTS,
                                    object : ChoreographerCompat.FrameCallback() {
                                        override fun doFrame(frameTimeNanos: Long) {
                                            if (patchStep != currentPatchStep) {
                                                currentPatchStep = patchStep
                                                callback?.patchEvent(patchStep, code)
                                            }
                                        }
                                    })
                        }
                    }

                },
                mCodePush.publicKey
            )

            newPackage = mUpdateManager.getPackage(
                updatePackage.optString(CodePushConstants.PACKAGE_HASH_KEY)
            )

            return newPackage
        } catch (e: CodePushInvalidUpdateException) {
            CodePushUtils.log(e)
            mSettingsManager.saveFailedUpdate(updatePackage)
            throw e
        }
    }

    /**
     * @throws CodePushUnknownException
     * */
    @Throws(CodePushUnknownException::class)
    override fun getRawUpdateMetadata(updateState: CodePushUpdateState): JSONObject? {
        try {
            val currentPackage = mUpdateManager.currentPackage ?: return null

            var currentUpdateIsPending = false

            if (currentPackage.has(CodePushConstants.PACKAGE_HASH_KEY)) {
                val currentHash =
                    currentPackage.optString(CodePushConstants.PACKAGE_HASH_KEY, null)
                currentUpdateIsPending = mSettingsManager.isPendingUpdate(currentHash)
            }

            if (updateState == CodePushUpdateState.PENDING && !currentUpdateIsPending) {
                // The caller wanted a pending update
                // but there isn't currently one.
                return null
            } else if (updateState == CodePushUpdateState.RUNNING && currentUpdateIsPending) {
                // The caller wants the running update, but the current
                // one is pending, so we need to grab the previous.
                val previousPackage = mUpdateManager.previousPackage ?: return null

                return previousPackage
            } else {
                // The current package satisfies the request:
                // 1) Caller wanted a pending, and there is a pending update
                // 2) Caller wanted the running update, and there isn't a pending
                // 3) Caller wants the latest update, regardless if it's pending or not
                if (mCodePush.isRunningBinaryVersion) {
                    // This only matters in Debug builds. Since we do not clear "outdated" updates,
                    // we need to indicate to the JS side that somehow we have a current update on
                    // disk that is not actually running.
                    CodePushUtils.setJSONValueForKey(currentPackage, "_isDebugOnly", true)
                }

                // Enable differentiating pending vs. non-pending updates
                CodePushUtils.setJSONValueForKey(
                    currentPackage, "isPending", currentUpdateIsPending
                )

                return currentPackage
            }
        } catch (e: CodePushMalformedDataException) {
            // We need to recover the app in case 'codepush.json' is corrupted
            CodePushUtils.log(e.message)
            clearUpdates()
            return null
        } catch (e: CodePushUnknownException) {
            CodePushUtils.log(e)
            throw e
        }
    }

    override fun getRawNewStatusReport(): WritableMap? {
        try {
            if (mCodePush.needToReportRollback()) {
                mCodePush.setNeedToReportRollback(false)
                val failedUpdates = mSettingsManager.failedUpdates
                if (failedUpdates != null && failedUpdates.length() > 0) {
                    try {
                        val lastFailedPackageJSON: JSONObject =
                            failedUpdates.getJSONObject(failedUpdates.length() - 1)
                        val lastFailedPackage =
                            CodePushUtils.convertJsonObjectToWritable(lastFailedPackageJSON)
                        val failedStatusReport =
                            mTelemetryManager.getRollbackReport(lastFailedPackage)
                        if (failedStatusReport != null) {
                            return failedStatusReport
                        }
                    } catch (e: JSONException) {
                        throw CodePushUnknownException(
                            "Unable to read failed updates information stored in SharedPreferences.",
                            e
                        )
                    }
                }
            } else if (mCodePush.didUpdate()) {
                val currentPackage = mUpdateManager.currentPackage
                if (currentPackage != null) {
                    val newPackageStatusReport = mTelemetryManager.getUpdateReport(
                        CodePushUtils.convertJsonObjectToWritable(currentPackage)
                    )
                    if (newPackageStatusReport != null) {
                        return newPackageStatusReport
                    }
                }
            } else if (mCodePush.isRunningBinaryVersion) {
                val newAppVersionStatusReport =
                    mTelemetryManager.getBinaryUpdateReport(mCodePush.appVersion)
                if (newAppVersionStatusReport != null) {
                    return newAppVersionStatusReport
                }
            } else {
                val retryStatusReport = mTelemetryManager.retryStatusReport
                if (retryStatusReport != null) {
                    return retryStatusReport
                }
            }
        } catch (e: CodePushUnknownException) {
            CodePushUtils.log(e)
            throw e
        }

        return null
    }

    override fun installUpdate(
        reactApplicationContext: ReactApplicationContext?,
        updatePackage: JSONObject,
        installMode: CodePushInstallMode,
        minimumBackgroundDuration: Int,
    ) {
        mUpdateManager.installPackage(
            updatePackage, mSettingsManager.isPendingUpdate(null)
        )

        val pendingHash: String? = updatePackage.optString(CodePushConstants.PACKAGE_HASH_KEY, null)

        if (pendingHash == null) {
            throw CodePushUnknownException("Update package to be installed has no hash.")
        } else {
            mSettingsManager.savePendingUpdate(pendingHash,  /* isLoading */false)
        }

        if (
        // We also add the resume listener if the installMode is IMMEDIATE, because
        // if the current activity is backgrounded, we want to reload the bundle when
        // it comes back into the foreground.
            installMode == CodePushInstallMode.ON_NEXT_RESUME
            || installMode == CodePushInstallMode.IMMEDIATE
            || installMode == CodePushInstallMode.ON_NEXT_SUSPEND
        ) {
            if (reactApplicationContext == null) {
                loadBundle()
                return
            }

            // Store the minimum duration on the native module as an instance
            // variable instead of relying on a closure below, so that any
            // subsequent resume-based installs could override it.
            this@CodePushNativeModuleInternal.mMinimumBackgroundDuration = minimumBackgroundDuration

            if (mLifecycleEventListener == null) {
                // Ensure we do not add the listener twice.
                mLifecycleEventListener = object : LifecycleEventListener {
                    private var lastPausedDate: Date? = null
                    private val appSuspendHandler = Handler(Looper.getMainLooper())
                    private val loadBundleRunnable = Runnable {
                        CodePushUtils.log("Loading bundle on suspend")
                        loadBundle(reactApplicationContext)
                    }

                    override fun onHostResume() {
                        appSuspendHandler.removeCallbacks(loadBundleRunnable)
                        // As of RN 36, the resume handler fires immediately if the app is in
                        // the foreground, so explicitly wait for it to be backgrounded first
                        if (lastPausedDate != null) {
                            val durationInBackground =
                                (Date().time - lastPausedDate!!.time) / 1000
                            if (installMode == CodePushInstallMode.IMMEDIATE || durationInBackground >= this@CodePushNativeModuleInternal.mMinimumBackgroundDuration) {
                                CodePushUtils.log("Loading bundle on resume")
                                loadBundle(reactApplicationContext)
                            }
                        }
                    }

                    override fun onHostPause() {
                        // Save the current time so that when the app is later
                        // resumed, we can detect how long it was in the background.
                        lastPausedDate = Date()

                        if (installMode == CodePushInstallMode.ON_NEXT_SUSPEND && mSettingsManager.isPendingUpdate(
                                null
                            )
                        ) {
                            appSuspendHandler.postDelayed(
                                loadBundleRunnable, (minimumBackgroundDuration * 1000).toLong()
                            )
                        }
                    }

                    override fun onHostDestroy() {
                    }
                }

                reactApplicationContext.addLifecycleEventListener(
                    mLifecycleEventListener
                )
            }
        }

    }

    @Throws(CodePushUnknownException::class)
    override fun getRawLatestRollbackInfo(): JSONObject? {
        return mSettingsManager.latestRollbackInfo
    }

    override fun getRawPackage(packageHash: String): JSONObject? {
        return mUpdateManager.getPackage(packageHash)
    }

    @Throws(CodePushUnknownException::class)
    override fun isFailedUpdate(packageHash: String?): Boolean {
        return mSettingsManager.isFailedHash(packageHash)
    }

    @Throws(CodePushUnknownException::class)
    override fun setLatestRollbackInfo(packageHash: String?) {
        mSettingsManager.setLatestRollbackInfo(packageHash)
    }

    @Throws(CodePushUnknownException::class)
    override fun isFirstRun(packageHash: String?): Boolean {
        return mCodePush.didUpdate() && !packageHash.isNullOrEmpty() && packageHash == mUpdateManager.currentPackageHash
    }

    @Throws(CodePushUnknownException::class)
    override fun notifyApplicationReady() {
        if (mSettingsManager.isPendingHash(mCodePush.runningPackageHash)) {
            mSettingsManager.removePendingUpdate()
        }
    }

    @Throws(CodePushUnknownException::class)
    override fun restartApp(
        reactApplicationContext: ReactApplicationContext,
        onlyIfUpdateIsPending: Boolean
    ): Boolean {
        // If this is an unconditional restart request, or there
        // is current pending update, then reload the app.
        if (!onlyIfUpdateIsPending || mSettingsManager.isPendingUpdate(null)) {
            loadBundle(reactApplicationContext)
            return true
        }

        return false
    }

    @Throws(CodePushUnknownException::class)
    override fun recordStatusReported(statusReport: ReadableMap) {
        mTelemetryManager.recordStatusReported(statusReport)
    }

    @Throws(CodePushUnknownException::class)
    override fun saveStatusReportForRetry(statusReport: ReadableMap) {
        mTelemetryManager.saveStatusReportForRetry(statusReport)
    }

    // Replaces the current bundle with the one downloaded from removeBundleUrl.
    // It is only to be used during tests. No-ops if the test configuration flag is not set.
    override fun downloadAndReplaceCurrentBundle(remoteBundleUrl: String) {
        try {
            if (CodePush.isUsingTestConfiguration()) {
                try {
                    mUpdateManager.downloadAndReplaceCurrentBundle(
                        remoteBundleUrl, mCodePush.assetsBundleFileName
                    )
                } catch (e: IOException) {
                    throw CodePushUnknownException("Unable to replace current bundle", e)
                }
            }
        } catch (e: CodePushUnknownException) {
            CodePushUtils.log(e)
        } catch (e: CodePushMalformedDataException) {
            CodePushUtils.log(e)
        }
    }

    /**
     * This method clears CodePush's downloaded updates.
     * It is needed to switch to a different deployment if the current deployment is more recent.
     * Note: we don’t recommend to use this method in scenarios other than that (CodePush will call
     * this method automatically when needed in other cases) as it could lead to unpredictable
     * behavior.
     */
    override fun clearUpdates() {
        CodePushUtils.log("Clearing updates.")
        mCodePush.clearUpdates()
    }

    private fun getApplicationContext(): Context {
        return this.context.applicationContext
    }

}