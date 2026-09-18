/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import { CodePushConstants } from './CodePushConstants'
import {
  UITurboModule,
  UITurboModuleContext,
} from '@rnoh/react-native-openharmony/ts'
import dataPreferences from '@ohos.data.preferences'
import { CodePushUpdateUtils } from './CodePushUpdateUtils'
import { CodePushUpdateManager } from './CodePushUpdateManager'
import { CodePushTelemetryManager } from './CodePushTelemetryManager'
import { CodePush } from './CodePush'
import fs, { ListFileOptions } from '@ohos.file.fs'
import { SettingsManager } from './SettingsManager'
import { BusinessError } from '@kit.BasicServicesKit'
import { CodePushUtils } from './CodePushUtils'
import { CodePushUpdateState } from './CodePushUpdateState'
import { CodePushMalformedDataException } from './CodePushMalformedDataException'
import { CodePushUnknownException } from './CodePushUnknownException'
import { TM } from '@rnoh/react-native-openharmony/generated/ts'
import { window } from '@kit.ArkUI'
import { RN_INSTANCE_MANAGER } from '@xrnjs/multi-bundle/ts'
import deviceInfo from '@ohos.deviceInfo'

import Logger from './Logger'
import { log } from './nativeCodePush/Logging'
import { CodePushBuilder } from './CodePushBuilder'

const TAG = 'CodePushNativeModule: '

function generateUUID(): string {
  Logger.info(TAG, `generateUUID uuid = ${deviceInfo.ODID}`)
  return deviceInfo.ODID
}

export class CodePushNativeModule
  extends UITurboModule
  implements TM.RTNCodePush.Spec
{
  private mBinaryContentsHash: string = ''
  private mClientUniqueId: string = ''
  private mCodePush: CodePush = null
  private _restartQueue: boolean[] = []
  private preferences: dataPreferences.Preferences | null = null
  private mTelemetryManager: CodePushTelemetryManager | null = null
  private mSettingsManager: SettingsManager | null = null
  private mUpdateManager: CodePushUpdateManager | null = null
  private installMode: number = -1
  private ready: boolean = false

  private serverUrl: string;
  private commonHash: string;

  codePushInstallModeImmediate() {
    return 0
  }
  codePushInstallModeOnNextRestart() {
    return 1
  }
  codePushInstallModeOnNextResume() {
    return 2
  }
  codePushInstallModeOnNextSuspend() {
    return 3
  }

  codePushUpdateStateRunning() {
    return 0
  }
  codePushUpdateStatePending() {
    return 1
  }
  codePushUpdateStateLatest() {
    return 2
  }

  isNativeSyncing(): boolean {
    return this.mCodePush.getNativeSyncing()
  }

  // 在加载biz bundle前，调用`initializeUpdateAfterRestart`
  beforeLoadBizBundleHandlePendingUpdate(): void {
    this.mCodePush?.beforeLoadBizBundleHandlePendingUpdate()
  }

  sync(): Promise<Object> {
    throw new Error('Method not implemented.')
  }

  constructor(
    private rnContext: UITurboModuleContext,
    codePush: CodePush, commonHash: string, serverUrl: string
  ) {
    super(rnContext)
    Logger.info(TAG, `constructor start`)
    console.log(`[Preload]-CodePushNativeModule====.constructor:codePush.getDeploymentKey()=${codePush?.getDeploymentKey()}, codePush.bundleInfo=${JSON.stringify(codePush?.bundleInfo)}, commonHash=${codePush?.getCommonHash()}`)
    this.commonHash = commonHash
    this.serverUrl = serverUrl
    this.init(codePush)
    // Initialize module state while we have a reference to the current context.
    
    Logger.info(TAG, `constructor end`)
  }

  private init(codePush: CodePush) {
    if (this.mCodePush) {
      return
    } else if (!codePush) {
      return
    }
    this.mTelemetryManager = new CodePushTelemetryManager(
      this.rnContext.uiAbilityContext,
      codePush.bundleInfo?.bundleName,
      codePush.getDeploymentKey()
    )
    this.mSettingsManager = new SettingsManager(
      this.rnContext.uiAbilityContext,
      codePush.bundleInfo?.bundleName,
      codePush.getDeploymentKey(),
    )
    this.mUpdateManager = new CodePushUpdateManager(
      this.rnContext.uiAbilityContext,
      '',
      codePush.bundleInfo?.bundleName,
      codePush.getDeploymentKey(),
    )

    dataPreferences.getPreferences(
      this.rnContext.uiAbilityContext,
      CodePushConstants.CODE_PUSH_PREFERENCES,
      (err: BusinessError, val: dataPreferences.Preferences) => {
        if (err) {
          Logger.error(
            TAG,
            `Failed to get preferences.error: ${JSON.stringify(err)}`,
          )
          return
        }
        this.preferences = val
        Logger.info(TAG, 'Succeeded in getting preferences.')
        this.mClientUniqueId = this.preferences?.getSync(
          CodePushConstants.CLIENT_UNIQUE_ID_KEY,
          null,
        ) as string
        Logger.info(TAG, `mClientUniqueId: ${this.mClientUniqueId}`)
        if (this.mClientUniqueId == null) {
          this.mClientUniqueId = generateUUID()
          this.preferences.putSync(
            CodePushConstants.CLIENT_UNIQUE_ID_KEY,
            this.mClientUniqueId,
          )
          this.preferences.flush()
        }
      },
    )
    this.mCodePush = codePush
  }

  async downloadUpdate(
    updatePackage: Record<string, any>,
    notifyProgress: boolean,
  ): Promise<Object> {
    Logger.info(
      TAG,
      `downloadUpdate, updatePackage: ${JSON.stringify(updatePackage)}`,
    )
    let mutableUpdatePackage: Record<string, any> = updatePackage
    mutableUpdatePackage[CodePushConstants.BINARY_MODIFIED_TIME_KEY] = 0

    await this.mUpdateManager.downloadPackage(
      mutableUpdatePackage,
      this.mCodePush.bundleInfo.getJSBundleName(),
      this.ctx.httpClient,
      (totalBytes, receivedBytes) => {
        this.ctx.rnInstance.emitDeviceEvent('CodePushDownloadProgress', {
          totalBytes: totalBytes,
          receivedBytes: receivedBytes,
        })
      },
      '',
    )

    return this.mUpdateManager.getPackage(updatePackage.packageHash)
  }

  async isFailedUpdate(packageHash: string): Promise<boolean> {
    try {
      return this.mSettingsManager.isFailedHash(packageHash)
    } catch (CodePushUnknownException) {
      Logger.error(
        TAG,
        `isFailedUpdate error: ${JSON.stringify(CodePushUnknownException)}`,
      )
      return CodePushUnknownException
    }
  }

  async getConfiguration(): Promise<Object> {
    Logger.info(TAG, `getConfiguration start`)

    interface ConfigMap {
      appVersion: string
      clientUniqueId: string
      deploymentKey: string
      serverUrl: string
      packageHash?: string
      commonHash?: string
    }

    let configMap: ConfigMap = {...CodePushUtils.getConfiguration(this.mCodePush, this.mClientUniqueId)}

    const expectedBundleFileName = this.mCodePush.bundleInfo.getJSBundleName()
    const hasRawBundle = CodePushUtils.rawfileExists(this.rnContext.uiAbilityContext, expectedBundleFileName)
    let basePackageHash = ''
    
    if (hasRawBundle) {
      basePackageHash = CodePushUpdateUtils.getBasePackageHashFromRawfile(
        this.rnContext.uiAbilityContext,
        this.mCodePush?.getDeploymentKey()
      ) || ''
    } else {
      basePackageHash = this.mUpdateManager.getBasePackageHash() || ''
    }
    
    configMap[CodePushConstants.PACKAGE_HASH_KEY] = basePackageHash
    Logger.info(TAG, `getConfiguration start：bssePackageHash=${basePackageHash}`)

    Logger.info(TAG, `[Preload]-getConfiguration configMap: ${JSON.stringify(configMap)}, bundleName=${this.mCodePush?.bundleInfo?.bundleName}`)
    return new Promise((resolve) => {
      resolve(configMap)
    })
  }

  async getUpdateMetadata(updateState: number) {
    return this.doInBackgroundForUpdateMetadata(updateState)
  }

  async doInBackgroundForUpdateMetadata(updateState: number) {
    Logger.info(
      TAG,
      `doInBackgroundForUpdateMetadata updateState=${updateState}`,
    )
    try {
      let currentPackage = this.mUpdateManager.getCurrentPackage()
      if (!currentPackage) {
        Logger.info(TAG, `currentPackage is empty`)
        return null
      }

      let currentUpdateIsPending: boolean = false
      if (currentPackage[CodePushConstants.PACKAGE_HASH_KEY]) {
        Logger.info(TAG, `currentPackage hasKey packageHash`)
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
        Logger.info(
          TAG,
          `doInBackgroundForUpdateMetadata previousPackage=${packageHash}`,
        )
        return packageHash
      } else {
        if (this.mCodePush.isRunningBinaryVersion()) {
          currentPackage['_isDebugOnly'] = true
        }
        // Enable differentiating pending vs. non-pending updates
        currentPackage['isPending'] = currentUpdateIsPending
        Logger.info(
          TAG,
          `currentPackage currentPackage=${JSON.stringify(currentPackage)}`,
        )
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

  async getNewStatusReport(): Promise<Object> {
    this.mUpdateManager == null &&
      (this.mUpdateManager = new CodePushUpdateManager(
        this.rnContext.uiAbilityContext,
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
        Logger.info(
          TAG,
          `getNewStatusReport currentPackage: ${JSON.stringify(currentPackage)}`,
        )
        if (currentPackage != null) {
          let newPackageStatusReport =
            this.mTelemetryManager.getUpdateReport(currentPackage)
          Logger.info(
            TAG,
            `newPackageStatusReport: ${JSON.stringify(newPackageStatusReport)}`,
          )
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
        Logger.info(
          TAG,
          `retryStatusReport: ${JSON.stringify(retryStatusReport)}`,
        )
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

  async installUpdate(
    updatePackage: Record<string, any>,
    installMode: number,
    minimumBackgroundDuration: number,
  ): Promise<void> {
    try {
      this.installMode = installMode
      this.ctx.uiAbilityContext.windowStage.on('windowStageEvent', (data) => {
        if (data === window.WindowStageEventType.SHOWN) {
          Logger.info(TAG, `Switch to foreground：${this.installMode}`)
          if (
            this.installMode === this.codePushInstallModeOnNextResume() &&
            this.ready === true
          ) {
            RN_INSTANCE_MANAGER.reCreateRNInstance(
              this.mCodePush.bundleInfo.bundleName,
            )
          }
        }

        if (data === window.WindowStageEventType.HIDDEN) {
          Logger.info(TAG, `Switch to background：${this.installMode}`)
          if (
            this.installMode === this.codePushInstallModeOnNextSuspend() &&
            this.ready === true
          ) {
            RN_INSTANCE_MANAGER.reCreateRNInstance(
              this.mCodePush.bundleInfo.bundleName,
            )
          }
        }

        Logger.info(
          TAG,
          'Succeeded in enabling the listener for window stage event changes. Data: ' +
            JSON.stringify(data),
        )
      })
      Logger.info(TAG, 'installPackage--CodePushNativeModule-entry')
      this.mUpdateManager.installPackage(
        updatePackage,
        this.mSettingsManager.isPendingUpdate(null),
      )
      Logger.info(TAG, 'installPackage--CodePushNativeModule-end')
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
      Logger.info(
        TAG,
        `installPackage--CodePushNativeModule-end3=${installMode},CodePushInstallMode.IMMEDIATE`,
      )

      Promise.resolve('')
    } catch (err) {
      CodePushUtils.log(err)
      Promise.reject(err)
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

  async restartApp(onlyIfUpdateIsPending: boolean): Promise<boolean> {
    try {
      this.restartAppInternal(onlyIfUpdateIsPending)
      return Promise.resolve(true)
    } catch (e) {
      Logger.info(TAG, e)
      return Promise.reject(e)
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
        this.rnContext.uiAbilityContext,
        this.mCodePush?.bundleInfo?.bundleName,
        this.mCodePush.getDeploymentKey(),
      ).recordStatusReported(statusReport)
    } catch (err) {
      CodePushUtils.log(err)
    }
  }

  async saveStatusReportForRetry(statusReport: Record<string, any>) {
    try {
      new CodePushTelemetryManager(
        this.rnContext.uiAbilityContext,
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

  async notifyApplicationReady() {
    try {
      const pendingPackageHash = this.mSettingsManager?.getPendingUpdate()?.[CodePushConstants.PENDING_UPDATE_HASH_KEY]
      const runningPackageHash = CodePushUpdateUtils.getRunningPackageHash(this.mCodePush.bundleInfo.bundleName)
      log(`[Preload]-initializeUpdateAfterRestart.notifyApplicationReady:pendingPackageHas${pendingPackageHash}, runningPackageHash=${runningPackageHash}, bundleName=${this.mCodePush?.bundleInfo?.bundleName}, this=${this}`)
      if (pendingPackageHash && (!runningPackageHash || pendingPackageHash === runningPackageHash)) {
        this.mSettingsManager.removePendingUpdate()
      }
      return Promise.resolve('')
    } catch (err) {
      CodePushUtils.log(err)
      Promise.reject(err)
    }
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
    // this.mCodePush.initializeUpdateAfterRestart()
    Logger.info(TAG, 'restartAppInternal RELOAD end')

    if (
      this.installMode === this.codePushInstallModeImmediate() ||
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

  // asset://assets/icon.png
  // asset://assets/release_oh/icon1.png
  public isFileExist(path: string): boolean {
    try {
      const bundleParentDir = fs.openSync(
        this.ctx.rnInstance.getInitialBundleUrl(),
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE,
      )
      const fullPath = CodePushUtils.join(
        bundleParentDir.getParent() || '',
        path.replace('asset://', ''),
      )
      // log(`${TAG}.isFileExist: path=${path}, fullPath=${fullPath}`)
      return fs.statSync(fullPath).isFile()
    } catch {
      return false
    }
  }

  public getIntlResourcePath(path: string) {
    return 'resource://RAWFILE/assets/' + path
  }

  isAssetBundleFileExists(): boolean {
    return false;
  }

  getBasePackageBundlePath(): string {
    return "";
  }

  addListener(eventName: string): void {
  }

  removeListeners(count: number): void {
  }
}
