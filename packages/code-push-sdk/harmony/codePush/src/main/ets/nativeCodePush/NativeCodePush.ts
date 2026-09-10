import { log } from "./Logging"
import { NativeCodePushDelegate } from "./NativeCodePushDelegate"
import getMixPackage from "./PackageMixins"
import { common } from "@kit.AbilityKit"
import { CodePush } from "../CodePush"
import { DEFAULT_ROLLBACK_RETRY_OPTIONS,
  DEFAULT_UPDATE_CHECK_TIMEOUT,
  DEFAULT_UPDATE_DIALOG, SyncStatus} from "./NativeCodePushConstant"
import { BundleInfo } from "xrn-multi-bundle/src/main/ets/bundle/BundleInfo"
import { CodePushBuilder } from "../CodePushBuilder"
import { Configuration } from "./NativeCodePushConfig"
import { CodePushInstallMode } from "../CodePushInstallMode"
import { CodePushUpdateState } from "../CodePushUpdateState"
import { SyncOptions } from "./NativeCodePushSyncOptions"
import { NativeCodePushHttpClient } from "./http/NativeCodePushHttpClient"
import { HttpTimeoutOption } from "./http/HttpRequest"
import { NativeCodePushHttpConfig } from "./http/NativeCodePushHttpConfig"
import { rawfileExists } from "./NativeCodePushUtil"
import { JSON } from "@kit.ArkTS"

interface CheckAndDownloadResult {
  syncStatus?: number
  syncOptions?: SyncOptions
  remotePackage?: Object | null
  localPackage?: Object | null
}


/**
 * 存储 NativeCodePush
 * 每个 Bundle 有一个 NativeCodePush
 */
const nativeCodePushMap = new Map<string, NativeCodePush>()

/**
 * 获取 NativeCodePush
 * @param abilityContext
 * @param bundleInfo
 * @param serverUrl
 * @returns
 */
export function getOrCreateNativeCodePush(abilityContext: common.UIAbilityContext, bundleInfo: BundleInfo, serverUrl: string, commonHash: string): NativeCodePush {
  log(`${TAG}.[Preload]-NativeCodePush.getOrCreateNativeCodePush:bundleInfo=${JSON.stringify(bundleInfo)}, commonHash=${commonHash}`)
  if (!abilityContext || !bundleInfo || !bundleInfo.bundleName) {
    return null
  }
  let nativeCodePush = nativeCodePushMap[bundleInfo.bundleName]
  if (!nativeCodePush) {
    const codePush = new CodePushBuilder(bundleInfo, bundleInfo.getCodePushKey(), serverUrl, commonHash).build(abilityContext)
    nativeCodePush = new NativeCodePush(abilityContext, bundleInfo, codePush)
    nativeCodePushMap[bundleInfo.bundleName] = nativeCodePush
  }
  return nativeCodePush
}

const TAG = "NativeCodePush"

/**
 * Native CodePush workflow
 */
class NativeCodePush {

  /**
   * ui context
   */
  readonly abilityContext: common.UIAbilityContext = null

  /**
   * bundle info
   */
  readonly bundleInfo: BundleInfo = null

  readonly codePush: CodePush = null

  private nativeCodePushDelegate: NativeCodePushDelegate = null

  private PackageMixins = null

  /**
   * Native CodePush Configuration
   */
  private config: Configuration = null
  private testConfig: Configuration = null

  private checkDownloadFlowPromise: Promise<any> = null

  constructor(abilityContext: common.UIAbilityContext, bundleInfo: BundleInfo, codePush: CodePush) {
    this.abilityContext = abilityContext
    this.bundleInfo = bundleInfo
    this.codePush = codePush
    this.nativeCodePushDelegate = new NativeCodePushDelegate(this.abilityContext, this.codePush)
    this.PackageMixins = getMixPackage(this.nativeCodePushDelegate)
  }

  /**
   * Initialize local data for CodePush (pendingPackage, isLoading).
   */
  initializeUpdateAfterRestart() {
    console.log(`[Preload]-NativeCodePush.initializeUpdateAfterRestart=====`)
    this.codePush.initializeUpdateAfterRestart()
  }

  // This function is only used for tests. Replaces the default SDK, configuration and native bridge
  // setUpTestDependencies(providedTestConfig: Configuration, testNativeBridge: NativeCodePushDelegate) {
  //   if (providedTestConfig) this.testConfig = providedTestConfig
  //   if (testNativeBridge) this.nativeCodePushDelegate = testNativeBridge
  // }

  /**
   *
   * @param deploymentKey
   * @param isPredownload:是否是预下载流程
   * @param httpTimeoutOption
   * @param handleBinaryVersionMismatchCallback
   * @returns
   */
  async checkForUpdate(
    deploymentKey = null,
    isPredownload: boolean,
    staleTime?: number,
    httpTimeoutOption: HttpTimeoutOption = null,
    handleBinaryVersionMismatchCallback = null,
  ) {
    /*
     * Before we ask the server if an update exists, we
     * need to retrieve three pieces of information from the
     * native side: deployment key, app version (e.g. 1.0.1)
     * and the hash of the currently running update (if there is one).
     * This allows the client to only receive updates which are targetted
     * for their specific deployment and version and which are actually
     * different from the CodePush update they have already installed.
     */
    const nativeConfig = await this.getConfiguration()

    /*
     * If a deployment key was explicitly provided,
     * then let's override the one we retrieved
     * from the native-side of the app. This allows
     * dynamically "redirecting" end-users at different
     * deployments (e.g. an early access deployment for insiders).
     */
    const config = deploymentKey
      ? { ...nativeConfig, ...{ deploymentKey } }
      : nativeConfig

    // Use dynamically overridden getCurrentPackage() during tests.
    const localPackage = await this.getCurrentPackage()

    /*
     * If the app has a previously installed update, and that update
     * was targetted at the same app version that is currently running,
     * then we want to use its package hash to determine whether a new
     * release has been made on the server. Otherwise, we only need
     * to send the app version to the server, since we are interested
     * in any updates for current app store version, regardless of hash.
     */
    let queryPackage
    if (localPackage) {
      queryPackage = localPackage
    } else {
      queryPackage = { appVersion: config.appVersion }
    }

    log(`${TAG}.checkForUpdate:deploymentKey=${deploymentKey}, config=${JSON.stringify(config)}, queryPackage=${JSON.stringify(queryPackage)}`)

    const httpRequest = this.getHttpRequest({...config, ...httpTimeoutOption})
    const update: any = await httpRequest.queryUpdateWithCurrentPackage({...queryPackage, basePackageHash: nativeConfig.packageHash, commonHash: nativeConfig.commonHash}, isPredownload, staleTime, httpTimeoutOption)

    log(`${TAG}.checkForUpdate:update=${JSON.stringify(update)}`)

    /*
     * There are four cases where checkForUpdate will resolve to null:
     * ----------------------------------------------------------------
     * 1) The server said there isn't an update. This is the most common case.
     * 2) The server said there is an update but it requires a newer binary version.
     *    This would occur when end-users are running an older app store version than
     *    is available, and CodePush is making sure they don't get an update that
     *    potentially wouldn't be compatible with what they are running.
     * 3) The server said there is an update, but the update's hash is the same as
     *    the currently running update. This should _never_ happen, unless there is a
     *    bug in the server, but we're adding this check just to double-check that the
     *    client app is resilient to a potential issue with the update check.
     * 4) The server said there is an update, but the update's hash is the same as that
     *    of the binary's currently running version. This should only happen in Android -
     *    unlike iOS, we don't attach the binary's hash to the updateCheck request
     *    because we want to avoid having to install diff updates against the binary's
     *    version, which we can't do yet on Android.
     */
    if (
      !update ||
      update.updateAppVersion ||
        (localPackage && update.packageHash === localPackage.packageHash) ||
        ((!localPackage || localPackage._isDebugOnly) &&
          config.packageHash === update.packageHash)
    ) {

      if (update && update.updateAppVersion) {
        log(
          'An update is available but it is not targeting the binary version of your app.',
        )
        if (
          handleBinaryVersionMismatchCallback &&
            typeof handleBinaryVersionMismatchCallback === 'function'
        ) {
          handleBinaryVersionMismatchCallback(update)
        }
      }
      log(`${TAG}.checkForUpdate:no need to update package, return null`)
      return null
    } else {
      const remotePackage = {
        ...update,
        ...this.PackageMixins.remote(httpRequest.reportStatusDownload),
      }
      remotePackage.failedInstall = await this.nativeCodePushDelegate.isFailedUpdate(
        remotePackage.packageHash,
      )
      remotePackage.deploymentKey = deploymentKey || nativeConfig.deploymentKey
      log(`${TAG}.checkForUpdate: need to update package, remotePackage${JSON.stringify(remotePackage)}`)
      return remotePackage
    }
  }

  async getConfiguration(): Promise<Configuration> {
    if (this.config) {
      return this.config
    } else if (this.testConfig) {
      return this.testConfig
    } else {
      this.config = await this.nativeCodePushDelegate.getConfiguration()
      return this.config
    }
  }

  async getCurrentPackage() {
    return await this.getUpdateMetadata(CodePushUpdateState.LATEST)
  }

  async getUpdateMetadata(updateState) {
    let updateMetadata = await this.nativeCodePushDelegate.getUpdateMetadata(
      updateState || CodePushUpdateState.RUNNING,
    )
    if (updateMetadata) {
      updateMetadata = { ...this.PackageMixins.local, ...updateMetadata }
      updateMetadata.failedInstall = await this.nativeCodePushDelegate.isFailedUpdate(
        updateMetadata.packageHash,
      )
      updateMetadata.isFirstRun = await this.nativeCodePushDelegate.isFirstRun(
        updateMetadata.packageHash,
      )
    }
    return updateMetadata
  }

  getHttpRequest(config: NativeCodePushHttpConfig): NativeCodePushHttpClient {
    return new NativeCodePushHttpClient(config)
  }

  async tryReportStatus(statusReport, resumeListener) {
    const config = await this.getConfiguration()
    const previousLabelOrAppVersion = statusReport.previousLabelOrAppVersion
    const previousDeploymentKey =
      statusReport.previousDeploymentKey || config.deploymentKey
    try {
      if (statusReport.appVersion) {
        log(`${TAG}.tryReportStatus:Reporting binary update (${statusReport.appVersion})`)

        const httpRequest = this.getHttpRequest(config)
        await httpRequest.reportStatusDeploy(
          /* deployedPackage */ null,
          /* status */ null,
          previousLabelOrAppVersion,
          previousDeploymentKey,
        )
      } else {
        const label = statusReport.package.label
        if (statusReport.status === 'DeploymentSucceeded') {
          log(`${TAG}.tryReportStatus:Reporting CodePush update success (${label})`)
        } else {
          log(`${TAG}.tryReportStatus:Reporting CodePush update rollback (${label})`)
          await this.nativeCodePushDelegate.setLatestRollbackInfo(
            statusReport.package.packageHash,
          )
        }

        config.deploymentKey = statusReport.package.deploymentKey
        const httpRequest = this.getHttpRequest(config)
        await httpRequest.reportStatusDeploy(
          statusReport.package,
          statusReport.status,
          previousLabelOrAppVersion,
          previousDeploymentKey,
        )
      }

      this.nativeCodePushDelegate.recordStatusReported(statusReport)
    } catch (e) {
      log(`${TAG}.tryReportStatus:Report status failed: ${JSON.stringify(statusReport)}`)
      this.nativeCodePushDelegate.saveStatusReportForRetry(statusReport)
    }
  }

  async shouldUpdateBeIgnored(remotePackage, syncOptions) {
    log(`${TAG}.shouldUpdateBeIgnored: remotePackage=${JSON.stringify(remotePackage)}, syncOptions=${JSON.stringify(syncOptions)}`)
    let { rollbackRetryOptions } = syncOptions

    const isFailedPackage = remotePackage && remotePackage.failedInstall
    if (!isFailedPackage || !syncOptions.ignoreFailedUpdates) {
      log(`${TAG}.shouldUpdateBeIgnored: return false, isFailedPackage=${isFailedPackage}, syncOptions.ignoreFailedUpdates=${syncOptions.ignoreFailedUpdates}`)
      return false
    }

    if (!rollbackRetryOptions) {
      log(`${TAG}.shouldUpdateBeIgnored: return true, rollbackRetryOptions=${rollbackRetryOptions}`)
      return true
    }

    if (typeof rollbackRetryOptions !== 'object') {
      rollbackRetryOptions = DEFAULT_ROLLBACK_RETRY_OPTIONS
    } else {
      rollbackRetryOptions = {
        ...DEFAULT_ROLLBACK_RETRY_OPTIONS,
        ...rollbackRetryOptions,
      }
    }

    if (!this.validateRollbackRetryOptions(rollbackRetryOptions)) {
      log(`${TAG}.shouldUpdateBeIgnored: return true, validateRollbackRetryOptions=false`)
      return true
    }

    const latestRollbackInfoStr = await this.nativeCodePushDelegate.getLatestRollbackInfo()
    const latestRollbackInfo = JSON.parse(latestRollbackInfoStr)
    if (
      !this.validateLatestRollbackInfo(latestRollbackInfo, remotePackage.packageHash)
    ) {
      log(`${TAG}.shouldUpdateBeIgnored: return true, The latest rollback info is not valid.`)
      return true
    }

    const { delayInHours, maxRetryAttempts } = rollbackRetryOptions
    const hoursSinceLatestRollback =
      (Date.now() - (latestRollbackInfo as any).time) / (1000 * 60 * 60)
    if (
      hoursSinceLatestRollback >= delayInHours &&
        maxRetryAttempts >= (latestRollbackInfo as any).count
    ) {
      log(`${TAG}.shouldUpdateBeIgnored: return false, Previous rollback should be ignored due to rollback retry options.`)
      return false
    }
    log(`${TAG}.shouldUpdateBeIgnored: return true`)
    return true
  }

  validateLatestRollbackInfo(latestRollbackInfo, packageHash) {
    return (
      latestRollbackInfo &&
      latestRollbackInfo.time &&
      latestRollbackInfo.count &&
      latestRollbackInfo.packageHash &&
        latestRollbackInfo.packageHash === packageHash
    )
  }

  validateRollbackRetryOptions(rollbackRetryOptions) {
    if (typeof rollbackRetryOptions.delayInHours !== 'number') {
      log(`${TAG}.validateRollbackRetryOptions: return false, The 'delayInHours' rollback retry parameter must be a number.`)
      return false
    }

    if (typeof rollbackRetryOptions.maxRetryAttempts !== 'number') {
      log(`${TAG}.validateRollbackRetryOptions: return false, The 'maxRetryAttempts' rollback retry parameter must be a number.`)
      return false
    }

    if (rollbackRetryOptions.maxRetryAttempts < 1) {
      log(`${TAG}.validateRollbackRetryOptions: return false, The 'maxRetryAttempts' rollback retry parameter cannot be less then 1.`)
      return false
    }

    return true
  }

  sync(options: SyncOptions = {},
    syncStatusChangeCallback,
    downloadProgressCallback,
    handleBinaryVersionMismatchCallback) {
    const localOptions: SyncOptions = {updateCheckHttpTimeoutOptions: DEFAULT_UPDATE_CHECK_TIMEOUT, ...options, bundleName: this.bundleInfo.bundleName}
    let syncStatusCallbackWithTryCatch, downloadProgressCallbackWithTryCatch
    if (typeof syncStatusChangeCallback === 'function') {
      syncStatusCallbackWithTryCatch = (...args) => {
        try {
          syncStatusChangeCallback(...args)
        } catch (error) {
          log(`An error has occurred : ${error.stack}`)
        }
      }
    }

    if (typeof downloadProgressCallback === 'function') {
      downloadProgressCallbackWithTryCatch = (...args) => {
        try {
          downloadProgressCallback(...args)
        } catch (error) {
          log(`An error has occurred: ${error.stack}`)
        }
      }
    }

    log(`${TAG}.sync: syncInProgress=${this.getSyncing()}`)
    if (this.getSyncing()) {
      typeof syncStatusCallbackWithTryCatch === 'function'
        ? syncStatusCallbackWithTryCatch(SyncStatus.SYNC_IN_PROGRESS)
        : log('Sync already in progress.')
      return Promise.resolve(SyncStatus.SYNC_IN_PROGRESS)
    }

    log(`${TAG}.setSyncCompleted:syncInProgress=true`)
    this.setSyncStarted()
    const syncPromise = this.syncInternal(
      localOptions,
      syncStatusCallbackWithTryCatch,
      downloadProgressCallbackWithTryCatch,
      handleBinaryVersionMismatchCallback,
    )
    syncPromise.then(() => this.setSyncCompleted()).catch(() => this.setSyncCompleted())

    return syncPromise
  }

  private setSyncStarted() {
    this.codePush.setNativeSyncing(true)
  }

  private setSyncCompleted() {
    log(`${TAG}.setSyncCompleted:syncInProgress=false`)
    this.codePush.setNativeSyncing(false)
  }

  private getSyncing(): boolean {
    return this.codePush.getNativeSyncing()
  }


  /*
   * The syncInternal method provides a simple, one-line experience for
   * incorporating the check, download and installation of an update.
   *
   * It simply composes the existing API methods together and adds additional
   * support for respecting mandatory updates, ignoring previously failed
   * releases, and displaying a standard confirmation UI to the end-user
   * when an update is available.
   */
  private async syncInternal(
    options: SyncOptions = {},
    syncStatusChangeCallback,
    downloadProgressCallback,
    handleBinaryVersionMismatchCallback,
  ) {
    const { syncStatus, syncOptions, remotePackage, localPackage } = await this.checkAndDownload(options, false, syncStatusChangeCallback, downloadProgressCallback, handleBinaryVersionMismatchCallback)
    if (syncStatus === SyncStatus.INSTALLING_UPDATE) {
      return await this.installPackage(syncOptions, localPackage, remotePackage, syncStatusChangeCallback)
    } else {
      return syncStatus
    }
  }

  /**
   * 「检查 + 下载」流程的并发控制入口，同一bundleName（即同一实例）下保证只有一个检查下载流程在执行
   */
  async checkAndDownload(
    options: SyncOptions = {},
    isPredownload: boolean,
    syncStatusChangeCallback,
    downloadProgressCallback,
    handleBinaryVersionMismatchCallback,
  ): Promise<CheckAndDownloadResult> {
    if (isPredownload) {
      if (this.getSyncing()) {
        log(`${TAG}.checkAndDownload: sync in progress, skip predownload.`)
        typeof syncStatusChangeCallback === 'function' && syncStatusChangeCallback(SyncStatus.SYNC_IN_PROGRESS)
        return { syncStatus: SyncStatus.SYNC_IN_PROGRESS }
      }

      if (this.checkDownloadFlowPromise) {
        log(`${TAG}.checkAndDownload: check-download flow in progress, skip predownload.`)
        typeof syncStatusChangeCallback === 'function' && syncStatusChangeCallback(SyncStatus.SYNC_IN_PROGRESS)
        return { syncStatus: SyncStatus.SYNC_IN_PROGRESS }
      }
    }

    let predownloadedResult = null
    if (!isPredownload && this.checkDownloadFlowPromise) {
      log(`${TAG}.checkAndDownload: predownload in progress, sync waits for it to finish.`)
      try {
        predownloadedResult = await this.checkDownloadFlowPromise
      } catch (error) {
        log(`${TAG}.checkAndDownload: in-flight predownload failed, sync continues. error=${error?.message}`)
      }

      if (!predownloadedResult || !predownloadedResult.localPackage) {
        predownloadedResult = null
      }
      log(`${TAG}.checkAndDownload: in-flight predownload finished, reuseResult=${!!predownloadedResult}`)
    }

    const flowPromise = this.checkAndDownloadInternal(
      options,
      isPredownload,
      syncStatusChangeCallback,
      downloadProgressCallback,
      handleBinaryVersionMismatchCallback,
      predownloadedResult,
    )
    this.checkDownloadFlowPromise = flowPromise
    const clearFlowPromise = () => {
      if (this.checkDownloadFlowPromise === flowPromise) {
        this.checkDownloadFlowPromise = null
      }
    }
    flowPromise.then(clearFlowPromise, clearFlowPromise)

    return await flowPromise
  }

  private async checkAndDownloadInternal(
    options: SyncOptions = {},
    isPredownload: boolean,
    syncStatusChangeCallback,
    downloadProgressCallback,
    handleBinaryVersionMismatchCallback,
    predownloadedResult = null,
  ): Promise<CheckAndDownloadResult> {
    log(`${TAG}.checkAndDownload: ${isPredownload}`)
    log(`${TAG}.checkAndDownload: options=${JSON.stringify(options)}, syncStatusChangeCallback=${syncStatusChangeCallback}, downloadProgressCallback=${downloadProgressCallback}, handleBinaryVersionMismatchCallback=${handleBinaryVersionMismatchCallback}`)

    let resolvedInstallMode
    const syncOptions: SyncOptions = {
      deploymentKey: null,
      ignoreFailedUpdates: true,
      rollbackRetryOptions: null,
      installMode: CodePushInstallMode.ON_NEXT_RESTART,
      mandatoryInstallMode: CodePushInstallMode.IMMEDIATE,
      minimumBackgroundDuration: 0,
      updateDialog: null,
      ...options,
    }

    syncStatusChangeCallback =
      typeof syncStatusChangeCallback === 'function'
        ? syncStatusChangeCallback
        : (syncStatus) => {
        switch (syncStatus) {
          case SyncStatus.CHECKING_FOR_UPDATE:
            log('Checking for update.')
            break
          case SyncStatus.AWAITING_USER_ACTION:
            log('Awaiting user action.')
            break
          case SyncStatus.DOWNLOADING_PACKAGE:
            log('Downloading package.')
            break
          case SyncStatus.INSTALLING_UPDATE:
            log('Installing update.')
            break
          case SyncStatus.UP_TO_DATE:
            log('App is up to date.')
            break
          case SyncStatus.UPDATE_IGNORED:
            log('User cancelled the update.')
            break
          case SyncStatus.UPDATE_INSTALLED:
            if (resolvedInstallMode == CodePushInstallMode.ON_NEXT_RESTART) {
              log(
                'Update is installed and will be run on the next app restart.',
              )
            } else if (
              resolvedInstallMode == CodePushInstallMode.ON_NEXT_RESUME
            ) {
              if (syncOptions.minimumBackgroundDuration > 0) {
                log(
                  `Update is installed and will be run after the app has been in the background for at least ${syncOptions.minimumBackgroundDuration} seconds.`,
                )
              } else {
                log(
                  'Update is installed and will be run when the app next resumes.',
                )
              }
            }
            break
          case SyncStatus.UNKNOWN_ERROR:
            log('An unknown error occurred.')
            break
        }
      }

    try {
      const statusReport = await this.nativeCodePushDelegate.getNewStatusReport()
      statusReport && this.tryReportStatus(statusReport, null) // Don't wait for this to complete.

      if (!isPredownload && predownloadedResult?.localPackage) {
        const remotePackage = predownloadedResult.remotePackage
        const localPackage = predownloadedResult.localPackage
        if (remotePackage) {
          remotePackage['isMandatory'] = true
          remotePackage['isPreDownloadPackage'] = true
        }
        localPackage['isMandatory'] = true
        localPackage['isPreDownloadPackage'] = true
        log(`${TAG}.checkAndDownload: sync流程，前面有预下载的包，直接安装，跳过checkUpdate，remotePackage=${JSON.stringify(remotePackage)}`)
        syncStatusChangeCallback(SyncStatus.INSTALLING_UPDATE, remotePackage)
        // const syncStatus = await this.installPackage(resolvedInstallMode, syncOptions, localPackage, remotePackage, syncStatusChangeCallback)
        return { syncStatus: SyncStatus.INSTALLING_UPDATE, syncOptions, remotePackage, localPackage }
      }

      log(`${TAG}.checkAndDownload: check前=，isPredownload=${isPredownload}`)
      syncStatusChangeCallback(SyncStatus.CHECKING_FOR_UPDATE, null)
      const remotePackage = await this.checkForUpdate(
        syncOptions.deploymentKey,
        isPredownload,
        syncOptions.staleTime,
        syncOptions.updateCheckHttpTimeoutOptions,
        handleBinaryVersionMismatchCallback,
      )

      if (remotePackage) {
        remotePackage['isPreDownloadFlow'] = isPredownload
      }

      const isExistPredownloadPackage = this.isExistPreDownloadPackage(remotePackage)
      if (isExistPredownloadPackage) {
        remotePackage['isMandatory'] = true
        remotePackage['isPreDownloadPackage'] = true
      }

      log(`${TAG}.checkAndDownload:remotePackage=${JSON.stringify(remotePackage)}, isExistPredownloadPackage=${isExistPredownloadPackage}`)

      syncStatusChangeCallback(SyncStatus.CHECKING_DONE, remotePackage)

      const doDownload = async () => {
        if (isExistPredownloadPackage) {
          const packageHash = remotePackage['packageHash']
          const localPackage = this.codePush.mUpdateManager.getPackage(packageHash) ?? {}
          if (isPredownload) {
            log(`${TAG}.checkAndDownload:预下载流程，已经预下载过，不在重复下载：${JSON.stringify(remotePackage)}, isExistPredownloadPackage=${isExistPredownloadPackage}`)
            syncStatusChangeCallback(SyncStatus.DOWNLOADED_PACKAGE, remotePackage)
            return { syncStatus: SyncStatus.DOWNLOADED_PACKAGE, remotePackage, localPackage }
          }

          log(`${TAG}.checkAndDownload: sync流程，存在预下载的包，直接走安装，不在重复下载。${JSON.stringify(remotePackage)}, isExistPredownloadPackage=${isExistPredownloadPackage}`)
          localPackage['isMandatory'] = true
          localPackage['isPreDownloadPackage'] = true
          syncStatusChangeCallback(SyncStatus.INSTALLING_UPDATE, remotePackage)
          // const syncStatus = await this.installPackage(resolvedInstallMode, syncOptions, localPackageInfo, remotePackage, syncStatusChangeCallback)
          return { syncStatus: SyncStatus.INSTALLING_UPDATE, syncOptions, remotePackage, localPackage }
        }

        syncStatusChangeCallback(SyncStatus.DOWNLOADING_PACKAGE, remotePackage)

        const localPackage = await remotePackage.download(
          downloadProgressCallback,
          (payload) => {
            const { state, code } = payload || {}
            const patchStatus = SyncStatus[state]
            if (patchStatus) {
              syncStatusChangeCallback(
                patchStatus,
                remotePackage,
                new Error('Patch failed. code: ' + code),
              )
            }
          },
        )

        if (isPredownload) {
          log(`${TAG}.checkAndDownload:预下载流程，只下载，不安装，${JSON.stringify(remotePackage)}, isExistPredownloadPackage=${isExistPredownloadPackage}`)
          syncStatusChangeCallback(SyncStatus.DOWNLOADED_PACKAGE, remotePackage)
          return { syncStatus: SyncStatus.DOWNLOADED_PACKAGE, remotePackage, localPackage }
        }

        syncStatusChangeCallback(SyncStatus.INSTALLING_UPDATE, remotePackage)
        // const syncStatus = await this.installPackage(resolvedInstallMode, syncOptions, localPackage, remotePackage, syncStatusChangeCallback)
        return { syncStatus: SyncStatus.INSTALLING_UPDATE, syncOptions, remotePackage, localPackage }
      }

      const updateShouldBeIgnored = await this.shouldUpdateBeIgnored(
        remotePackage,
        syncOptions,
      )

      log(`${TAG}.syncInternal:remotePackage=${JSON.stringify(remotePackage)}, updateShouldBeIgnored=${updateShouldBeIgnored}`)
      if (!remotePackage || updateShouldBeIgnored) {
        if (updateShouldBeIgnored) {
          log(`${TAG}.syncInternal: updateShouldBeIgnored=${updateShouldBeIgnored}, An update is available, but it is being ignored due to having been previously rolled back.`)
        }

        const currentPackage = await this.getCurrentPackage()
        if (currentPackage && currentPackage.isPending) {
          log(`${TAG}.syncInternal: currentPackage=${currentPackage}, currentPackage.isPending=${currentPackage.isPending}`)
          syncStatusChangeCallback(SyncStatus.UPDATE_INSTALLED, remotePackage)
          return { syncStatus: SyncStatus.UPDATE_INSTALLED, remotePackage }
        } else {
          log(`${TAG}.syncInternal:currentPackage is up to date`)
          syncStatusChangeCallback(SyncStatus.UP_TO_DATE, remotePackage)
          return { syncStatus: SyncStatus.UP_TO_DATE, remotePackage }
        }
      } else if (syncOptions.updateDialog) {
        log(`${TAG}.syncInternal: update dialog`)
        // updateDialog supports any truthy value (e.g. true, "goo", 12),
        // but we should treat a non-object value as just the default dialog
        if (typeof syncOptions.updateDialog !== 'object') {
          syncOptions.updateDialog = DEFAULT_UPDATE_DIALOG
        } else {
          syncOptions.updateDialog = {
            ...DEFAULT_UPDATE_DIALOG,
            ...syncOptions.updateDialog,
          }
        }

        return await new Promise<CheckAndDownloadResult>((resolve, reject) => {
          let message = null
          let installButtonText = null

          const dialogButtons = []

          if (remotePackage.isMandatory) {
            message = syncOptions.updateDialog.mandatoryUpdateMessage
            installButtonText =
              syncOptions.updateDialog.mandatoryContinueButtonLabel
          } else {
            message = syncOptions.updateDialog.optionalUpdateMessage
            installButtonText =
              syncOptions.updateDialog.optionalInstallButtonLabel
            // Since this is an optional update, add a button
            // to allow the end-user to ignore it
            dialogButtons.push({
              text: syncOptions.updateDialog.optionalIgnoreButtonLabel,
              onPress: () => {
                syncStatusChangeCallback(SyncStatus.UPDATE_IGNORED, remotePackage)
                resolve({ syncStatus: SyncStatus.UPDATE_IGNORED, remotePackage })
              },
            })
          }

          // Since the install button should be placed to the
          // right of any other button, add it last
          dialogButtons.push({
            text: installButtonText,
            onPress: () => {
              doDownload().then(resolve, reject)
            },
          })

          // If the update has a description, and the developer
          // explicitly chose to display it, then set that as the message
          if (
            syncOptions.updateDialog.appendReleaseDescription &&
            remotePackage.description
          ) {
            message += `${syncOptions.updateDialog.descriptionPrefix} ${remotePackage.description}`
          }

          syncStatusChangeCallback(SyncStatus.AWAITING_USER_ACTION, remotePackage)
        })
      } else {
        return await doDownload()
      }
    } catch (error) {
      syncStatusChangeCallback(SyncStatus.UNKNOWN_ERROR, null, error)
      log(`${TAG}.syncInternal: catch error=${JSON.stringify(error)}`)
      throw error
    }
  }

  async installPackage(syncOptions, localPackage, remotePackage, updateInstalledCallback) {
    // Determine the correct install mode based on whether the update is mandatory or not.
    const resolvedInstallMode = localPackage.isMandatory
      ? syncOptions.mandatoryInstallMode
      : syncOptions.installMode

    // updateInstalledCallback(SyncStatus.INSTALLING_UPDATE, remotePackage)
    await this.nativeCodePushDelegate.installUpdate(
      localPackage,
      resolvedInstallMode,
      syncOptions.minimumBackgroundDuration,
    )

    updateInstalledCallback && updateInstalledCallback(SyncStatus.UPDATE_INSTALLED, remotePackage)
    // if (installMode == CodePushInstallMode.IMMEDIATE) {
    //   nativeCodePushDelegate.restartApp(false)
    // } else {
    //   nativeCodePushDelegate.clearPendingRestart()
    //   localPackage.isPending = true // Mark the package as pending since it hasn't been applied yet
    // }

    return SyncStatus.UPDATE_INSTALLED
  }

  isExistPreDownloadPackage(remotePackage) {
    if (!remotePackage) {
      return false
    }

    const packageHash = remotePackage['packageHash']
    if (!packageHash) {
      return false
    }

    log(`${TAG}.isExistPreDownloadPackage: packageHash=${packageHash}`)
    const expectedBundleName = this.codePush.bundleInfo?.getJSBundleName()
    log(`${TAG}.isExistPreDownloadPackage: expectedBundleName=${expectedBundleName}`)
    const isExist = this.codePush.mUpdateManager.bundleFileExists(packageHash, expectedBundleName)
    log(`${TAG}.isExistPreDownloadPackage: isExist=${isExist}`)
    const localPackageInfo = this.codePush.mUpdateManager.getPackage(packageHash)
    log(`${TAG}.isExistPreDownloadPackage: localPackageInfo=${JSON.stringify(localPackageInfo)}`)
    const isPreDownloadFlow = localPackageInfo?.['isPreDownloadFlow']
    log(`${TAG}.isExistPreDownloadPackage: isPreDownloadFlow=${isPreDownloadFlow}`)
    return isExist && localPackageInfo && isPreDownloadFlow
  }
}

export default NativeCodePush