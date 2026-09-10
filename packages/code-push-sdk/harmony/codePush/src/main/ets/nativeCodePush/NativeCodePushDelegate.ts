
import { CodePushConstants } from '../CodePushConstants'
import {
  UITurboModule,
  UITurboModuleContext,
} from '@rnoh/react-native-openharmony/ts'
import { CodePushUpdateUtils } from '../CodePushUpdateUtils'
import { CodePushUpdateManager } from '../CodePushUpdateManager'
import { CodePushTelemetryManager } from '../CodePushTelemetryManager'
import { CodePush } from '../CodePush'
import fs, { ListFileOptions } from '@ohos.file.fs'
import { SettingsManager } from '../SettingsManager'
import { BusinessError, Callback } from '@kit.BasicServicesKit'
import { CodePushUtils } from '../CodePushUtils'
import { CodePushUpdateState } from '../CodePushUpdateState'
import { CodePushMalformedDataException } from '../CodePushMalformedDataException'
import { CodePushUnknownException } from '../CodePushUnknownException'
import { TM } from '@rnoh/react-native-openharmony/generated/ts'
import { window } from '@kit.ArkUI'
import { RN_INSTANCE_MANAGER } from 'xrn-multi-bundle/ts'
import deviceInfo from '@ohos.deviceInfo'
import Logger from "../Logger"
import { common } from '@kit.AbilityKit'
import { CodePushInstallMode } from '../CodePushInstallMode'
import { DefaultHttpClient } from '@rnoh/react-native-openharmony/src/main/ets/HttpClient/HttpClient'
import { Configuration } from './NativeCodePushConfig'
import { log } from './Logging'
import { NativeCodePushCommonCode, NativeCodePushError } from './NativeCodePushError'
import { NativeCodePushStage } from './NativeCodePushStage'
import { JSON } from '@kit.ArkTS'
import { getClientUniqueId } from '../Utils'

const TAG = 'NativeCodePushDelegate'

function generateUUID(): string {
  log(`${TAG}.generateUUID uuid = ${deviceInfo.ODID}`)
  return deviceInfo.ODID
}

export class NativeCodePushDelegate {

  private abilityContext: common.UIAbilityContext = null
  private mBinaryContentsHash: string = ''
  private mClientUniqueId: string = ''
  private mCodePush: CodePush = null
  private _restartQueue: boolean[] = []
  private mTelemetryManager: CodePushTelemetryManager | null = null
  private mSettingsManager: SettingsManager | null = null
  private mUpdateManager: CodePushUpdateManager | null = null
  private installMode: number = -1
  private ready: boolean = false

  private httpClient = new DefaultHttpClient()

  private windowStageCallback: Callback<window.WindowStageEventType> = undefined

  constructor(abilityContext: common.UIAbilityContext, codePush: CodePush) {
    console.log(`[Preload]-NativeCodePushDelegate.constructor:bundleInfo=${JSON.stringify(codePush?.bundleInfo)}`)
    this.abilityContext = abilityContext
    this.mTelemetryManager = new CodePushTelemetryManager(
      abilityContext,
      codePush.bundleInfo?.bundleName,
      codePush.getDeploymentKey(),
    )
    this.mSettingsManager = new SettingsManager(
      abilityContext,
      codePush.bundleInfo?.bundleName,
      codePush.getDeploymentKey(),
    )
    this.mUpdateManager = new CodePushUpdateManager(
      abilityContext,
      '',
      codePush.bundleInfo?.bundleName,
      codePush.getDeploymentKey(),
    )

    this.initClientUniqueID()

    this.mCodePush = codePush
    // Initialize module state while we have a reference to the current context.

    log(`${TAG}: getDeploymentKey=${codePush.getDeploymentKey()}`)

  }

  private initClientUniqueID() {
    this.mClientUniqueId = getClientUniqueId(this.abilityContext )
    log(`${TAG}.initClientUniqueID: mClientUniqueId=${this.mClientUniqueId}`)
  }

  async downloadUpdate(
    updatePackage: Record<string, any>,
    callback,
  ): Promise<Record<string, any>> {
    // log(`${TAG}.downloadUpdate, updatePackage=${JSON.stringify(updatePackage)}`)
    let mutableUpdatePackage: Record<string, any> = updatePackage
    mutableUpdatePackage[CodePushConstants.BINARY_MODIFIED_TIME_KEY] = 0

    await this.mUpdateManager.downloadPackage(
      mutableUpdatePackage,
      this.mCodePush.bundleInfo.getJSBundleName(),
      this.httpClient,
      (totalBytes, receivedBytes) => {
        // log(`${TAG}.downloadUpdate:totalBytes=${totalBytes}, receivedBytes=${receivedBytes}, percent=${(receivedBytes as number)/(totalBytes as number)}`)
        callback && callback({updatePackage, totalBytes, receivedBytes})
      },
      '',
    )

    return this.mUpdateManager.getPackage(updatePackage.packageHash)
  }

  async isFailedUpdate(packageHash: string): Promise<boolean> {
    try {
      return this.mSettingsManager.isFailedHash(packageHash)
    } catch (CodePushUnknownException) {
      log(`${TAG}.isFailedUpdate: isFailedUpdate error: ${JSON.stringify(CodePushUnknownException)}`)
      return CodePushUnknownException
    }
  }

  async getConfiguration(): Promise<Configuration> {
    let config = CodePushUtils.getConfiguration(this.mCodePush, this.mClientUniqueId)

    const expectedBundleFileName = this.mCodePush.bundleInfo.getJSBundleName()
    const hasRawBundle = CodePushUtils.rawfileExists(this.abilityContext, expectedBundleFileName)
    let basePackageHash = ''
    
    if (hasRawBundle) {
      basePackageHash = CodePushUpdateUtils.getBasePackageHashFromRawfile(
        this.abilityContext,
        this.mCodePush?.getDeploymentKey()
      ) || ''
    } else {
      basePackageHash = this.mUpdateManager.getBasePackageHash() || ''
    }
    
    config[CodePushConstants.PACKAGE_HASH_KEY] = basePackageHash
    Logger.info(TAG, `getConfiguration start：bssePackageHash=${basePackageHash}`)

    log(`${TAG}.getConfiguration: config=${JSON.stringify(config)}`)
    return new Promise((resolve) => {
      resolve(config)
    })
  }

  async getUpdateMetadata(updateState: number) {
    const result = this.doInBackgroundForUpdateMetadata(updateState)
    log(`${TAG}.getUpdateMetadata:updateState=${updateState}, result=${JSON.stringify(result)}`)
    return result
  }

  async doInBackgroundForUpdateMetadata(updateState: number) {
    try {
      let currentPackage = this.mUpdateManager.getCurrentPackage()
      if (!currentPackage) {
        log(`${TAG}.doInBackgroundForUpdateMetadata:currentPackage is empty`)
        return null
      }

      let currentUpdateIsPending: boolean = false
      if (currentPackage[CodePushConstants.PACKAGE_HASH_KEY]) {
        let currentHash = currentPackage[
        CodePushConstants.PACKAGE_HASH_KEY
        ] as string
        currentUpdateIsPending =
          this.mSettingsManager.isPendingUpdate(currentHash)
      }

      if (
        updateState == CodePushUpdateState.PENDING.valueOf() &&
          !currentUpdateIsPending
      ) {
        // The caller wanted a pending update
        // but there isn't currently one.
        log(`${TAG}.doInBackgroundForUpdateMetadata:currentPackage is empty`)
        return null
      } else if (
        updateState == CodePushUpdateState.RUNNING.valueOf() &&
          currentUpdateIsPending
      ) {
        // The caller wants the running update, but the current
        // one is pending, so we need to grab the previous.

        // let previousPackage = new CodePushUpdateManager('').getPreviousPackage();

        // if (previousPackage == null) {
        //   Logger.info(TAG, `currentPackage previousPackage is null`);
        //   return null;
        // }

        // return previousPackage;
        let previousPackage = this.mUpdateManager.getCurrentPackageInfo()
        const packageHash = {
          packageHash: previousPackage['previousPackage'],
        }

        log(`${TAG}.doInBackgroundForUpdateMetadata previousPackage=${packageHash}`)
        return packageHash
      } else {
        if (this.mCodePush.isRunningBinaryVersion()) {
          currentPackage['_isDebugOnly'] = true
        }
        // Enable differentiating pending vs. non-pending updates
        currentPackage['isPending'] = currentUpdateIsPending
        log(`${TAG}.doInBackgroundForUpdateMetadata: currentPackage=${JSON.stringify(currentPackage)}`)
        return currentPackage
      }
    } catch (e) {
      // We need to recover the app in case 'codepush.json' is corrupted
      if (e instanceof CodePushMalformedDataException) {
        CodePushUtils.log(e.message)
        this.clearUpdates()
        return Promise.resolve(null)
      } else if (e instanceof CodePushUnknownException) {
        CodePushUtils.log(e.message)
        return Promise.reject(e)
      }
    }
  }

  async getNewStatusReport(): Promise<object> {
    this.mUpdateManager == null &&
      (this.mUpdateManager = new CodePushUpdateManager(
        this.abilityContext,
        '',
        this.mCodePush.bundleInfo?.bundleName,
        this.mCodePush.getDeploymentKey(),
      ))
    try {
      if (this.mCodePush.needToReportRollback()) {
        this.mCodePush.setNeedToReportRollback(false)
        let failedUpdates = this.mSettingsManager.getFailedUpdates()
        if (failedUpdates != null && failedUpdates.length > 0) {
          try {
            let lastFailedPackage = failedUpdates[failedUpdates.length - 1]
            let failedStatusReport =
              this.mTelemetryManager.getRollbackReport(lastFailedPackage)
            if (failedStatusReport != null) {
              return Promise.resolve(failedStatusReport)
            }
          } catch (err) {
            throw new CodePushUnknownException(
              'Unable to read failed updates information stored in SharedPreferences.',
              err,
            )
          }
        }
      } else if (this.mCodePush.didUpdate()) {
        let currentPackage = this.mUpdateManager.getCurrentPackage()
        log(`${TAG}.getNewStatusReport: currentPackage: ${JSON.stringify(currentPackage)}`,)
        if (currentPackage != null) {
          let newPackageStatusReport =
            this.mTelemetryManager.getUpdateReport(currentPackage)
          log(`${TAG}.getNewStatusReport: newPackageStatusReport: ${JSON.stringify(newPackageStatusReport)}`,)
          if (newPackageStatusReport != null) {
            return Promise.resolve(newPackageStatusReport)
          }
        }
      } else if (this.mCodePush.isRunningBinaryVersion()) {
        let newAppVersionStatusReport =
          this.mTelemetryManager.getBinaryUpdateReport(
            this.mCodePush.getAppVersion(),
          )
        if (newAppVersionStatusReport != null) {
          Promise.resolve(newAppVersionStatusReport)
          return null
        }
      } else {
        let retryStatusReport = this.mTelemetryManager.getRetryStatusReport()
        log(`${TAG}.getNewStatusReport: retryStatusReport: ${JSON.stringify(retryStatusReport)}`,)
        if (retryStatusReport != null) {
          return Promise.resolve(retryStatusReport)
        }
      }
      Promise.resolve('')
    } catch (err) {
      CodePushUtils.log(err)
      Promise.reject(err)
    }
    return null
  }

  private installWindowStageCallback(installMode: number) {
    if (!this.windowStageCallback && this.abilityContext) {
      this.windowStageCallback = (data) => {
        if (data === window.WindowStageEventType.SHOWN) {
          log(`${TAG}.installUpdate: Switch to foreground：${installMode}`)
          if (installMode === CodePushInstallMode.ON_NEXT_RESUME
          ) {
            this.uninstallWindowStageCallback()
            RN_INSTANCE_MANAGER.reCreateRNInstance(
              this.mCodePush.bundleInfo.bundleName,
            )
          }
        }

        if (data === window.WindowStageEventType.HIDDEN) {
          log(`${TAG}.installUpdate: Switch to background：${this.installMode}`)
          if (
            this.installMode === CodePushInstallMode.ON_NEXT_SUSPEND
          ) {
            this.uninstallWindowStageCallback()
            RN_INSTANCE_MANAGER.reCreateRNInstance(
              this.mCodePush.bundleInfo.bundleName,
            )
          }
        }

        log(`${TAG}.installUpdate:Succeeded in enabling the listener for window stage event changes. Data: ${JSON.stringify(data)}`)
      }
    }
    this.abilityContext.windowStage.on("windowStageEvent", this.windowStageCallback)
  }

  private uninstallWindowStageCallback() {
    if (this.windowStageCallback && this.abilityContext) {
      this.abilityContext.windowStage.off("windowStageEvent", this.windowStageCallback)
      this.windowStageCallback = undefined
    }
  }

  async installUpdate(
    updatePackage: Record<string, any>,
    installMode: number,
    minimumBackgroundDuration: number,
  ): Promise<void> {
    try {
      this.installMode = installMode
      // this.installWindowStageCallback(installMode)
      this.mUpdateManager.installPackage(
        updatePackage,
        this.mSettingsManager.isPendingUpdate(null),
      )
      let pendingHash = updatePackage[CodePushConstants.PACKAGE_HASH_KEY]
      if (pendingHash == null) {
        throw new CodePushUnknownException(
          'Update package to be installed has no hash.',
        )
      } else {
        this.mSettingsManager.savePendingUpdate(
          pendingHash,
          /* isLoading */ false,
        )
      }
      Promise.resolve('')
    } catch (err) {
      const finalError = new NativeCodePushError(NativeCodePushStage.SYNC_INSTALL, NativeCodePushCommonCode.UNKNOWN_ERROR, "", err)
      log(`.install: catch finalError=${JSON.stringify(finalError)}`)
      Promise.reject(finalError)
    }
    return null
  }

  async disallow() {
    return new Promise((resolve) => {
      Logger.info(TAG, 'Disallowing restarts')
      resolve(null)
    })
  }

  async clearPendingRestart() {
    return new Promise((resolve) => {
      this._restartQueue = []
      resolve(null)
    })
  }

  async restartApp(onlyIfUpdateIsPending: boolean) {
    try {
      this.restartAppInternal(onlyIfUpdateIsPending)
      return null
    } catch (e) {
      Logger.info(TAG, e)
      return e
    }
  }

  async setLatestRollbackInfo(packageHash: string): Promise<null | string> {
    try {
      this.mSettingsManager.setLatestRollbackInfo(packageHash)
      return Promise.resolve(packageHash)
    } catch (e) {
      CodePushUtils.log(e)
      Promise.reject(e)
    }
  }

  async isFirstRun(packageHash: string): Promise<boolean | null> {
    try {
      let isFirstRun =
        this.mCodePush.didUpdate() &&
          packageHash != null &&
          packageHash.length > 0 &&
          packageHash === this.mUpdateManager.getCurrentPackageHash()
      return Promise.resolve(isFirstRun)
    } catch (err) {
      CodePushUtils.log(err)
      Promise.reject(err)
    }
  }

  async recordStatusReported(statusReport: Record<string, any>) {
    try {
      new CodePushTelemetryManager(
        this.abilityContext,
        this.mCodePush.bundleInfo?.bundleName,
        this.mCodePush.getDeploymentKey(),
      ).recordStatusReported(statusReport)
    } catch (err) {
      CodePushUtils.log(err)
    }
  }

  async saveStatusReportForRetry(statusReport: Record<string, any>) {
    try {
      new CodePushTelemetryManager(
        this.abilityContext,
        this.mCodePush.bundleInfo?.bundleName,
        this.mCodePush.getDeploymentKey(),
      ).saveStatusReportForRetry(statusReport)
    } catch (err) {
      CodePushUtils.log(err)
    }
  }

  async downloadAndReplaceCurrentBundle(remoteBundleUrl: string) {}

  restartAppInternal(onlyIfUpdateIsPending: boolean) {
    this.loadBundle()
  }

  async allow() {
    return new Promise((resolve) => {
      Logger.info(TAG, 'Re-allowing restarts')
      if (this._restartQueue.length > 0) {
        Logger.info(TAG, 'Executing pending restart')
        let buf: boolean = this._restartQueue[0]
        this._restartQueue.splice(0, 1)
        this.restartAppInternal(buf)
      }
      resolve(null)
    })
  }

  async clearUpdates() {
    CodePushUtils.log('Clearing updates.')
    this.mCodePush.clearUpdates()
  }

  async getBundle(path: string): Promise<ArrayBuffer> {
    try {
      const file = await fs.open(path, fs.OpenMode.READ_ONLY)
      const { size } = await fs.stat(file.fd)
      const buffer = new ArrayBuffer(size)
      await fs.read(file.fd, buffer, { length: size })
      return buffer
    } catch (err) {}
  }

  private async loadBundle(): Promise<void> {
    this.ready = true
    console.log(`[Preload]-NativeCodePushDelegate.loadBundle=====`)
    // this.mCodePush.initializeUpdateAfterRestart()
    Logger.info(TAG, 'restartAppInternal RELOAD end')

    if (
      this.installMode === CodePushInstallMode.IMMEDIATE ||
        this.installMode === -1
    ) {
      RN_INSTANCE_MANAGER.reCreateRNInstance(
        this.mCodePush.bundleInfo.bundleName,
      )
    }
  }

  public getLatestRollbackInfo(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      try {
        let latestRollbackInfo: object =
          this.mSettingsManager.getLatestRollbackInfo()
        if (latestRollbackInfo != null) {
          resolve(JSON.stringify(latestRollbackInfo))
        } else {
          resolve(null)
        }
      } catch (err) {
        CodePushUtils.log(err)
        reject(err)
      }
    })
  }

  //TODO
  // asset://assets/icon.png
  // asset://assets/release_oh/icon1.png
  // public isFileExist(path: string): boolean {
  //   try {
  //     const bundleParentDir = fs.openSync(
  //       this.ctx.rnInstance.getInitialBundleUrl(),
  //       fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE,
  //     )
  //     const fullPath = CodePushUtils.join(
  //       bundleParentDir.getParent() || '',
  //       path.replace('asset://', ''),
  //     )
  //     return fs.statSync(fullPath).isFile()
  //   } catch {
  //     return false
  //   }
  // }

  public getIntlResourcePath(path: string) {
    return 'resource://RAWFILE/assets/' + path
  }
}