package xrn.modules.codepush

import com.microsoft.codepush.react.CodePush
import com.microsoft.codepush.react.CodePushConfiguration
import com.microsoft.codepush.react.CodePushUnknownException
import com.microsoft.codepush.react.CodePushUtils
import com.microsoft.codepush.react.DownloadProgressCallback as MicrosoftDownloadProgressCallback
import com.microsoft.codepush.react.type.ICodePushNativeModuleKTDelegate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okio.IOException
import xrn.modules.codepush.sdk.AcquisitionSdk
import xrn.modules.codepush.sdk.HttpUtils
import xrn.modules.codepush.sdk.ReportStatusDeployBody
import xrn.modules.codepush.sdk.StatusReport
import java.util.concurrent.TimeUnit


class CodePushManager(
    var codePush: CodePush,
    private val delegate: ICodePushNativeModuleKTDelegate = codePush.createNativeModule()
) : ICodePushNativeModuleKTDelegate by delegate {

    private var httpClient: OkHttpClient = HttpUtils.createHttpClient()

    /** 仅在主线程读写。 */
    private var checkDownloadFlowRunning = false

    private var checkDownloadCallback = CodePushMixedCallback()

    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    fun initialize(assetsBundleFileName: String) {
        // 提前设置 CodePush 内部状态属性。比如：mAssetsBundleFileName、mDidUpdate、sIsRunningBinaryVersion
        getReactPackage().getJSBundleFile(assetsBundleFileName)
    }

    fun getReactPackage(): CodePush {
        return codePush
    }

    /**
     * Asks the CodePush service whether the configured app deployment has an update available.
     *
     * @param deploymentKey The deployment key to use to query the CodePush server for an update.
     *
     * @param handleBinaryVersionMismatchCallback An optional callback for handling target binary version mismatch
     */
    @Throws(IOException::class)
    fun checkForUpdate(
        deploymentKey: String? = null,
        timeoutMillis: Int = DEFAULT_TIMEOUT_MILLIS,
        handleBinaryVersionMismatchCallback: HandleBinaryVersionMismatchCallback? = null,
        useCache: Boolean,
        staleTime: Long? = null,
    ): RemotePackage? {
        return checkForUpdateInternal(
            deploymentKey,
            timeoutMillis,
            handleBinaryVersionMismatchCallback,
            useCache,
            staleTime,
        )
    }

    @Throws(IOException::class)
    private fun checkForUpdateInternal(
        deploymentKey: String?,
        timeoutMillis: Int,
        handleBinaryVersionMismatchCallback: HandleBinaryVersionMismatchCallback?,
        useCache: Boolean,
        staleTime: Long? = null,
    ): RemotePackage? {
        val nativeConfig = delegate.getConfigure()

        val config = if (deploymentKey != null) {
            nativeConfig.copy(deploymentKey = deploymentKey)
        } else {
            nativeConfig
        }

        val queryPackage = getCurrentPackage() ?: LocalPackage(appVersion = config.appVersion)

        val sdk = getPromisifiedSdk(config, timeoutMillis)

        val update = sdk.queryUpdateWithCurrentPackage(
            queryPackage,
            basePackageHash = nativeConfig.packageHash,
            useCache = useCache,
            staleTime = staleTime,
        )

        if (update == null
            || update.updateAppVersion
            || (update.packageHash == queryPackage.packageHash)
            || (queryPackage.isDebugOnly && config.packageHash == update.packageHash)
        ) {
            if (update != null && update.updateAppVersion) {
                CodePushUtils.log("An update is available but it is not targeting the binary version of your app.")
                handleBinaryVersionMismatchCallback?.call(update)
            }

            return null
        } else {
            val localPackage = delegate.getPackage(update.packageHash)
            val localCacheHint =
                localPackage != null && localPackage.packageHash == update.packageHash
            val isMandatory = update.isMandatory || localCacheHint
            val isFailed = delegate.isFailedUpdate(update.packageHash)

            return update.copy(
                isMandatory = isMandatory,
                isPending = false,
                deploymentKey = deploymentKey ?: nativeConfig.deploymentKey,
                failedInstall = isFailed,
                localCacheHint = localCacheHint
            )
        }
    }

    private fun getPromisifiedSdk(
        config: CodePushConfiguration,
        timeoutMillis: Int = DEFAULT_TIMEOUT_MILLIS,
    ): AcquisitionSdk {
        val httpClient = this.httpClient.newBuilder()
            .connectTimeout(timeoutMillis.toLong(), TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMillis.toLong(), TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMillis.toLong(), TimeUnit.MILLISECONDS)
            .build()
        return AcquisitionSdk(httpClient, config)
    }

    private fun isSyncing(): Boolean {
        return codePush.isIsSyncing
    }

    private fun setSyncStarted() {
        codePush.isIsSyncing = true
    }

    private fun setSyncCompleted() {
        codePush.isIsSyncing = false
    }

    /**
     * Allows checking for an update, downloading it and installing it, all with a single call.
     *
     * @param options Options used to configure the end-user update experience (e.g. show an prompt?, install the update immediately?).
     * @param syncStatusChangedCallback An optional callback that allows tracking the status of the sync operation, as opposed to simply checking the resolved state via the returned Promise.
     * @param downloadProgressCallback An optional callback that allows tracking the progress of an update while it is being downloaded.
     * @param handleBinaryVersionMismatchCallback An optional callback for handling target binary version mismatch
     */
    fun sync(
        deploymentKey: String,
        options: SyncOptions,
        timeoutMillis: Int = DEFAULT_TIMEOUT_MILLIS,
        useCache: Boolean = false,
        staleTime: Long? = null,
        syncStatusChangedCallback: SyncStatusChangedCallback? = null,
        downloadProgressCallback: DownloadProgressCallback? = null,
        handleBinaryVersionMismatchCallback: HandleBinaryVersionMismatchCallback? = null
    ) {
        mainScope.launch {
            if (isSyncing()) {
                CodePushUtils.log("Sync already in progress.")
                syncStatusChangedCallback?.call(SyncStatus.SYNC_IN_PROGRESS, null)
                return@launch
            }

            setSyncStarted()

            val syncOptions = effectiveSyncOptions(deploymentKey, options)

            syncInternal(
                deploymentKey,
                syncOptions,
                timeoutMillis,
                useCache,
                staleTime,
                syncStatusChangedCallback,
                downloadProgressCallback,
                handleBinaryVersionMismatchCallback
            )
        }
    }

    private suspend fun syncInternal(
        deploymentKey: String,
        syncOptions: SyncOptions,
        timeoutMillis: Int,
        useCache: Boolean,
        staleTime: Long? = null,
        syncStatusChangedCallback: SyncStatusChangedCallback?,
        downloadProgressCallback: DownloadProgressCallback?,
        handleBinaryVersionMismatchCallback: HandleBinaryVersionMismatchCallback?
    ) {
        suspend fun install(remotePackage: RemotePackage?, localPackage: LocalPackage?) {
            if (localPackage == null) return

            val resolvedInstallMode =
                if (localPackage.isMandatory == true) syncOptions.mandatoryInstallMode else syncOptions.installMode

            syncStatusChangedCallback?.call(
                SyncStatus.INSTALLING_UPDATE,
                remotePackage,
                localPackage
            )
            withContext(Dispatchers.IO) {
                delegate.installUpdate(
                    localPackage, resolvedInstallMode, syncOptions.minimumBackgroundDuration
                )
            }
            syncStatusChangedCallback?.call(
                SyncStatus.UPDATE_INSTALLED,
                remotePackage,
                localPackage
            )
        }

        val checkDownloadSyncStatusChangedCallback = object : SyncStatusChangedCallback {
            override fun call(
                status: SyncStatus,
                remotePackage: RemotePackage?,
                localPackage: LocalPackage?,
                e: Throwable?
            ) {
                when (status) {
                    SyncStatus.UP_TO_DATE,
                    SyncStatus.UPDATE_INSTALLED,
                    SyncStatus.UNKNOWN_ERROR -> {
                        setSyncCompleted()
                    }

                    SyncStatus.PACKAGE_DOWNLOADED -> {
                        mainScope.launch {
                            try {
                                install(remotePackage, localPackage)
                            } catch (t: Throwable) {
                                CodePushUtils.log("Sync error: ${t.message}")
                                syncStatusChangedCallback?.call(
                                    SyncStatus.UNKNOWN_ERROR,
                                    null,
                                    null,
                                    t
                                )
                            } finally {
                                setSyncCompleted()
                            }
                        }
                    }

                    else -> {}
                }

                // 状态回调透传
                syncStatusChangedCallback?.call(status, remotePackage, localPackage, e)
            }
        }

        try {
            checkDownloadInternal(
                deploymentKey,
                syncOptions,
                timeoutMillis,
                useCache,
                staleTime,
                checkDownloadSyncStatusChangedCallback,
                downloadProgressCallback,
                handleBinaryVersionMismatchCallback
            )
        } catch (e: Throwable) {
            CodePushUtils.log("Sync error: ${e.message}")
            checkDownloadSyncStatusChangedCallback.call(SyncStatus.UNKNOWN_ERROR, null, null, e)
        }
    }

    fun preDownload(
        deploymentKey: String,
        options: SyncOptions,
        timeoutMillis: Int = DEFAULT_TIMEOUT_MILLIS,
        useCache: Boolean = true,
        staleTime: Long? = null,
        syncStatusChangedCallback: SyncStatusChangedCallback? = null,
        downloadProgressCallback: DownloadProgressCallback? = null,
        handleBinaryVersionMismatchCallback: HandleBinaryVersionMismatchCallback? = null
    ) {
        mainScope.launch {
            if (isSyncing()) {
                CodePushUtils.log("preDownload: sync is running. skip!")
                syncStatusChangedCallback?.call(SyncStatus.SYNC_IN_PROGRESS, null)
                return@launch
            }

            checkDownloadInternal(
                deploymentKey,
                options,
                timeoutMillis,
                useCache,
                staleTime,
                syncStatusChangedCallback,
                downloadProgressCallback,
                handleBinaryVersionMismatchCallback
            )
        }
    }

    /**
     * 独立的「检查更新 → 下载更新包」流程（不进行安装）。
     */
    private suspend fun checkDownloadInternal(
        deploymentKey: String,
        options: SyncOptions,
        timeoutMillis: Int = DEFAULT_TIMEOUT_MILLIS,
        useCache: Boolean,
        staleTime: Long? = null,
        syncStatusChangedCallback: SyncStatusChangedCallback? = null,
        downloadProgressCallback: DownloadProgressCallback? = null,
        handleBinaryVersionMismatchCallback: HandleBinaryVersionMismatchCallback? = null
    ) = withContext(Dispatchers.Main) {
        val subscriber = CodePushMixedCallback.CheckDownloadSubscriber(
            syncStatusChanged = syncStatusChangedCallback,
            downloadProgress = downloadProgressCallback,
            handleBinaryVersionMismatch = handleBinaryVersionMismatchCallback,
        )

        // 入口仅在主线程执行：check-then-act 由主线程串行模型保证原子，无需额外锁。
        checkDownloadCallback.addSubscriber(subscriber)
        if (checkDownloadFlowRunning) {
            CodePushUtils.log("checkAndDownload: subscriber registered, sharing in-flight pipeline.")
            return@withContext
        }
        checkDownloadFlowRunning = true

        try {
            val syncOptions = effectiveSyncOptions(deploymentKey, options)
            runCheckAndDownloadPipeline(
                syncOptions,
                timeoutMillis,
                useCache,
                staleTime,
                checkDownloadCallback,
                checkDownloadCallback,
                checkDownloadCallback,
            )
        } finally {
            finishCheckDownloadPipeline()
        }
    }

    private fun finishCheckDownloadPipeline() {
        checkDownloadCallback.clearSubscriber()
        checkDownloadFlowRunning = false
    }

    private suspend fun runCheckAndDownloadPipeline(
        syncOptions: SyncOptions,
        timeoutMillis: Int,
        useCache: Boolean,
        staleTime: Long? = null,
        syncStatusChangedCallback: SyncStatusChangedCallback,
        downloadProgressCallback: MicrosoftDownloadProgressCallback?,
        handleBinaryVersionMismatchCallback: HandleBinaryVersionMismatchCallback?
    ) {
        try {
            syncStatusChangedCallback.call(SyncStatus.CHECKING_FOR_UPDATE, null)
            val remotePackage = withContext(Dispatchers.IO) {
                checkForUpdate(
                    syncOptions.deploymentKey,
                    timeoutMillis,
                    handleBinaryVersionMismatchCallback,
                    useCache,
                    staleTime,
                )
            }
            syncStatusChangedCallback.call(SyncStatus.CHECKING_DONE, remotePackage)

            val updateShouldBeIgnored = shouldUpdateBeIgnored(remotePackage, syncOptions)
            if (remotePackage == null || updateShouldBeIgnored) {
                if (updateShouldBeIgnored) {
                    CodePushUtils.log("An update is available, but it is being ignored due to having been previously rolled back.")
                }

                val currentPackage = withContext(Dispatchers.IO) {
                    getCurrentPackage()
                }
                val finalStatus = if (currentPackage != null && currentPackage.isPending == true) {
                    SyncStatus.UPDATE_INSTALLED
                } else {
                    SyncStatus.UP_TO_DATE
                }
                syncStatusChangedCallback.call(finalStatus, remotePackage)
                return
            } else if (syncOptions.updateDialog) {
                // TODO 支持弹窗确认
                throw CodePushUnknownException("Not supported update dialog yet.")
            }

            syncStatusChangedCallback.call(SyncStatus.DOWNLOADING_PACKAGE, remotePackage)
            val localPackage = withContext(Dispatchers.IO) {
                delegate.downloadUpdate(
                    remotePackage, true, downloadProgressCallback
                )
            }

            if (localPackage == null) {
                reportStatusDownload(null)
                throw CodePushUnknownException("Failed to download update.")
            }

            syncStatusChangedCallback.call(
                SyncStatus.PACKAGE_DOWNLOADED,
                remotePackage,
                localPackage
            )

            reportStatusDownload(localPackage)
        } catch (e: Throwable) {
            CodePushUtils.log("Sync error: ${e.message}")
            syncStatusChangedCallback.call(SyncStatus.UNKNOWN_ERROR, null, null, e)
        }
    }

    private suspend fun shouldUpdateBeIgnored(
        remotePackage: RemotePackage?, syncOptions: SyncOptions
    ): Boolean {
        if (remotePackage == null) return false

        val isFailedPackage = remotePackage.failedInstall
        if (!isFailedPackage || !syncOptions.ignoreFailedUpdates) {
            return false
        }

        val rollbackRetryOptions = syncOptions.rollbackRetryOptions ?: return true
        if (!validateRollbackRetryOptions(rollbackRetryOptions)) {
            return true
        }

        val latestRollbackInfo = withContext(Dispatchers.IO) {
            delegate.getLatestRollbackInfo()
        }
        if (latestRollbackInfo == null || !validateLatestRollbackInfo(
                latestRollbackInfo, remotePackage.packageHash
            )
        ) {
            CodePushUtils.log("The latest rollback info is not valid.")
            return true
        }

        val delayInHours = rollbackRetryOptions.delayInHours
        val maxRetryAttempts = rollbackRetryOptions.maxRetryAttempts

        val hoursSinceLatestRollback =
            (System.currentTimeMillis() - latestRollbackInfo.time) / (1000 * 60 * 60)

        if (hoursSinceLatestRollback >= delayInHours && maxRetryAttempts >= latestRollbackInfo.count) {
            CodePushUtils.log("Previous rollback should be ignored due to rollback retry options.")
            return false
        }

        return true
    }

    private fun validateRollbackRetryOptions(rollbackRetryOptions: SyncOptions.RollbackRetryOptions): Boolean {
        return rollbackRetryOptions.isValid()
    }

    private fun validateLatestRollbackInfo(
        rollbackInfo: RollbackInfo?, packageHash: String
    ): Boolean {
        return rollbackInfo != null && rollbackInfo.time > 0 && rollbackInfo.count > 0 && rollbackInfo.packageHash == packageHash
    }

    // TODO 提供 rn api
    suspend fun notifyAppReady() = withContext(Dispatchers.IO) {
        delegate.notifyApplicationReady()

        val statusReport = delegate.getNewStatusReport()

        if (statusReport != null) {
            tryReportStatus(statusReport)
        }
    }

    private suspend fun tryReportStatus(statusReport: StatusReport) = withContext(Dispatchers.IO) {
        val config = getConfigure()
        val previousLabelOrAppVersion = statusReport.previousLabelOrAppVersion
        val previousDeploymentKey = statusReport.previousDeploymentKey ?: config.deploymentKey

        try {
            if (!statusReport.appVersion.isNullOrBlank()) {
                CodePushUtils.log("Reporting binary update (${statusReport.appVersion})")
                val sdk = getPromisifiedSdk(config)
                sdk.reportStatusDeploy(
                    null, null, previousLabelOrAppVersion, previousDeploymentKey
                )
            } else if (statusReport.localPackage != null) {
                val label = statusReport.localPackage.label

                if (statusReport.status == ReportStatusDeployBody.DeploymentSucceeded) {
                    CodePushUtils.log("Reporting CodePush update success (${label})")
                } else {
                    CodePushUtils.log("Reporting CodePush update rollback (${label})")
                    setLatestRollbackInfo(statusReport.localPackage.packageHash)
                }

                val newConfig =
                    config.copy(deploymentKey = statusReport.localPackage.deploymentKey!!)

                val sdk = getPromisifiedSdk(newConfig)
                sdk.reportStatusDeploy(
                    statusReport.localPackage,
                    statusReport.status,
                    previousLabelOrAppVersion,
                    previousDeploymentKey
                )

            } else {
                CodePushUtils.log("Report status failed. Invalid status report: $statusReport")
                return@withContext
            }

            delegate.recordStatusReported(statusReport.toReadable())
        } catch (e: RuntimeException) {
            CodePushUtils.log("Report status failed. Invalid status report: $statusReport")
            delegate.saveStatusReportForRetry(statusReport.toReadable())
            // TODO retry
        }
    }

    private fun reportStatusDownload(remotePackage: LocalPackage?) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val config = getConfigure()
                val sdk = getPromisifiedSdk(config)
                sdk.reportStatusDownload(remotePackage)
            } catch (e: RuntimeException) {
                CodePushUtils.log(e)
            }
        }
    }

    fun allowRestart() {
        TODO("Not yet implemented")
    }

    fun disallowRestart() {
        TODO("Not yet implemented")
    }

    private fun effectiveSyncOptions(deploymentKey: String, options: SyncOptions): SyncOptions =
        if (options.deploymentKey.isNullOrBlank()) options.copy(deploymentKey = deploymentKey) else options


    companion object {
        private const val DEFAULT_TIMEOUT_MILLIS = 10 * 1000
    }

}