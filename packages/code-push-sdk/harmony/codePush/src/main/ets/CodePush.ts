/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import common from '@ohos.app.ability.common'
import { CodePushUpdateManager } from './CodePushUpdateManager'
import { SettingsManager } from './SettingsManager'
import { bundleManager } from '@kit.AbilityKit'
import { CodePushUnknownException } from './CodePushUnknownException'
import { CodePushConstants } from './CodePushConstants'
import { CodePushNotInitializedException } from './CodePushNotInitializedException'
import { CodePushUtils } from './CodePushUtils'
import Logger from './Logger'
import {
  RNOHError,
  UITurboModuleContext,
} from '@rnoh/react-native-openharmony/ts'
import { BundleInfo, RN_INSTANCE_MANAGER } from '@xrnjs/multi-bundle/ts'
import { log } from './nativeCodePush/Logging'
import { JSON } from '@kit.ArkTS'

const TAG = 'CodePushNativeModule-CodePushInstance: '

export interface ErrorCallback {
  callback: (eventID: string, params?: Record<string, string | number>) => void
}

let gErrorCallback: ErrorCallback = undefined

export function getGlobalErrorCallback(): ErrorCallback | undefined {
  return gErrorCallback
}

export function setGlobalErrorCallback(errorCallback: ErrorCallback | undefined) {
  gErrorCallback = errorCallback
}

export class CodePush {
  private sIsRunningBinaryVersion: boolean = false
  private sNeedToReportRollback: boolean = false
  private static sTestConfigurationFlag: boolean = false
  private sAppVersion: string = null
  private mDidUpdate: boolean = false
  private mAssetsBundleFileName: string = ''

  // Helper classes.
  readonly mUpdateManager: CodePushUpdateManager
  private mSettingsManager: SettingsManager

  // Config properties.
  private static mPublicKey: string = ''
  private mCurrentInstance: CodePush | null = null
  private context: common.UIAbilityContext

  private isNativeSyncing = false

  constructor(
    public bundleInfo: any,
    public deploymentKey: string,
    public isDebugMode: boolean,
    private mServerUrl: string,
    private commonHash: string,
    private rnContext: UITurboModuleContext | common.UIAbilityContext,
    publicKeyResourceDescriptor?: number,
  ) {
    Logger.info(
      TAG,
      `constructor start param, deploymentKey: ${deploymentKey}, isDebugMode: ${isDebugMode?.toString()}`,
    )
    if ("subscribeToRNInstanceErrors" in rnContext) {
      this.context = (this.rnContext as UITurboModuleContext)?.uiAbilityContext
    } else {
      this.context = this.rnContext as common.UIAbilityContext
    }

    this.mUpdateManager = new CodePushUpdateManager(
      this.context,
      '',
      bundleInfo?.bundleName,
      deploymentKey,
    )
    this.mSettingsManager = new SettingsManager(this.context, bundleInfo?.bundleName, deploymentKey)
    if (this.sAppVersion == null) {
      try {
        let bundleFlags = bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT
        const appInfo = bundleManager.getBundleInfoForSelfSync(bundleFlags)
        this.sAppVersion = appInfo.versionName
      } catch (e) {
        Logger.error(TAG, `constructor sAppVersion error: ${JSON.stringify(e)}`)
      }
    }

    this.mCurrentInstance = this
    this.mServerUrl = mServerUrl
    this.commonHash = commonHash

    // this.rnContext.rnInstance.subscribeToLifecycleEvents('JS_BUNDLE_EXECUTION_FINISH', () => {
    //   // this.rnContext.rnInstance.cppEventEmitter.subscribe('')
    //   setTimeout(() => {
    //     this.initializeUpdateAfterRestart()
    //   }, 1000)
    // })
    if ("subscribeToRNInstanceErrors" in rnContext) {
      (this.rnContext as UITurboModuleContext)?.subscribeToRNOHErrors((error) =>
        this.subscribeRNOHError(error),
      )
    }
    if (this.bundleInfo) {
      console.log(`[Preload]-CodePush.constructor=====`)
      // this.initializeUpdateAfterRestart()
    }
  }

  setBundleInfo(bundleInfo: BundleInfo) {
    console.log(`[Preload]-CodePush.setBundleInfo:bundleInfo=${JSON.stringify(bundleInfo)}}, this.bundleInfo=${JSON.stringify(this.bundleInfo)}`)
    if (!this.bundleInfo && bundleInfo) {
      this.bundleInfo = bundleInfo
      this.deploymentKey = bundleInfo.getCodePushKey()
      const bundleName = bundleInfo.bundleName
      this.mUpdateManager.setBundleInfo(bundleName, this.deploymentKey)
      this.mSettingsManager.setBundleInfo(bundleName, this.deploymentKey)
      console.log(`[Preload]-CodePush.setBundleInfo=====`)
      // this.initializeUpdateAfterRestart()
    }
  }

  setCommonHash(commonHash: string) {
    this.commonHash = commonHash
  }

  getNativeSyncing(): boolean {
    return this.isNativeSyncing
  }

  setNativeSyncing(syncing: boolean) {
    this.isNativeSyncing = syncing
  }

  private subscribeRNOHError(error: RNOHError) {
    if (
      error instanceof RNOHError &&
      error.getMessage() === "Couldn't run a JS bundle"
    ) {
      this.rollbackPackage()
    }
  }

  static isUsingTestConfiguration(): boolean {
    return CodePush.sTestConfigurationFlag
  }

  public setRnContext(rnContext: UITurboModuleContext | common.UIAbilityContext) {
    if ("subscribeToRNInstanceErrors" in rnContext) {
      this.rnContext = rnContext
      this.context = rnContext.uiAbilityContext
    } else {
      this.context = rnContext
    }
  }

  public didUpdate(): boolean {
    return this.mDidUpdate
  }

  public getAppVersion(): string {
    return this.sAppVersion
  }

  public getAssetsBundleFileName(): string {
    return this.mAssetsBundleFileName
  }

  public getPublicKey(): string {
    return CodePush.mPublicKey
  }

  public getPackageFolder(): string {
    const codePushLocalPackage = this.mUpdateManager.getCurrentPackage()
    if (codePushLocalPackage == null) {
      return null
    }
    return this.mUpdateManager.getPackageFolderPath(
      codePushLocalPackage['packageHash'],
    )
  }

  public getBundleUrl(assetsBundleFileName?: string): string {
    if (assetsBundleFileName) {
      return this.getJSBundleFile(assetsBundleFileName)
    }
    return this.getJSBundleFile()
  }

  public getContext(): any {
    return this.context
  }

  public getDeploymentKey(): string {
    return this.deploymentKey
  }

  public getJSBundleFile(assetsBundleFileName?: string): string {
    if (!this.mCurrentInstance) {
      throw new CodePushNotInitializedException(
        "A CodePush instance has not been created yet. Have you added it to your app's list of ReactPackages?",
      )
    }
    if (assetsBundleFileName) {
      return this.getJSBundleFile(CodePushConstants.DEFAULT_JS_BUNDLE_NAME)
    }
    return this.mCurrentInstance.getJSBundleFileInternal(assetsBundleFileName)
  }

  public getJSBundleFileInternal(assetsBundleFileName: string): string {
    this.mAssetsBundleFileName = assetsBundleFileName //mAssetsBundleFileName=index.android.bundle
    const binaryJsBundleUrl: string =
      CodePushConstants.ASSETS_BUNDLE_PREFIX + assetsBundleFileName
    let packageFilePath: string = null
    try {
      //mAssetsBundleFileName=index.android.bundle
      packageFilePath = this.mUpdateManager.getCurrentPackageBundlePath(
        this.mAssetsBundleFileName,
      )
    } catch (CodePushMalformedDataException) {
      // We need to recover the app in case 'codepush.json' is corrupted
      CodePushUtils.log(CodePushMalformedDataException)
      this.clearUpdates()
    }

    if (packageFilePath == null) {
      // There has not been any downloaded updates.
      CodePushUtils.log('Loading JS bundle from "' + binaryJsBundleUrl + '"')
      this.sIsRunningBinaryVersion = true
      return binaryJsBundleUrl //assets://index.android.bundle
    }

    const packageMetadata = this.mUpdateManager.getCurrentPackage()
    if (this.isPackageBundleLatest(packageMetadata)) {
      CodePushUtils.logBundleUrl(packageFilePath)
      this.sIsRunningBinaryVersion = false
      return packageFilePath
    } else {
      // The binary version is newer.
      this.mDidUpdate = false
      if (!this.isDebugMode || this.hasBinaryVersionChanged(packageMetadata)) {
        this.clearUpdates()
      }

      CodePushUtils.logBundleUrl(binaryJsBundleUrl)
      this.sIsRunningBinaryVersion = true
      return binaryJsBundleUrl
    }
  }

  initializeUpdateAfterRestart() {
    log(`[Preload]-${TAG}.initializeUpdateAfterRestart===:bundleName=${this.bundleInfo?.bundleName}`)
    if (!this.bundleInfo) {
      return
    }
    // 重置状态，指示应用是否刚刚更新过。
    this.mDidUpdate = false

    const pendingUpdate = this.mSettingsManager.getPendingUpdate()
    Logger.info(
      TAG,
      `[Preload]-initializeUpdateAfterRestart pendingUpdate ${pendingUpdate}, bundleName=${this.bundleInfo?.bundleName}`,
    )
    if (pendingUpdate != null) {
      const packageMetadata = this.mUpdateManager.getCurrentPackage()
      if (
        packageMetadata == null ||
        (!this.isPackageBundleLatest(packageMetadata) &&
          this.hasBinaryVersionChanged(packageMetadata))
      ) {
        Logger.info(
          TAG,
          `[Preload]-Skipping initializeUpdateAfterRestart(), binary version is newer,`,
        )
        return
      }

      try {
        let updateIsLoading =
          pendingUpdate[CodePushConstants.PENDING_UPDATE_IS_LOADING_KEY]
        log(`[Preload]-${TAG}.initializeUpdateAfterRestart===: updateIsLoading=${updateIsLoading}, bundleName=${this.bundleInfo?.bundleName}`)
        if (updateIsLoading) {
          // Pending update was initialized, but notifyApplicationReady was not called.
          // Therefore, deduce that it is a broken update and rollback.
          Logger.info(
            TAG,
            'Update did not finish loading the last time, rolling back to a previous version.' +
              this.mCurrentInstance?.deploymentKey,
          )
          this.sNeedToReportRollback = true
          this.rollbackPackage()
        } else {
          // 确实有一个新的更新正在首次运行，因此更新本地状态以确保客户端知道。
          this.mDidUpdate = true
          this.mSettingsManager.savePendingUpdate(
            pendingUpdate[CodePushConstants.PENDING_UPDATE_HASH_KEY],
            true,
          )
        }
      } catch (e) {
        Logger.error(
          TAG,
          `initializeUpdateAfterRestart error ${JSON.stringify(e)}`,
        )
      }
    }
  }

  beforeLoadBizBundleHandlePendingUpdate() {
    const currentPackageHash = this.mUpdateManager.getCurrentPackageHash()
    const pendingUpdate = this.mSettingsManager.getPendingUpdate()
    const isPendingHash = this.mSettingsManager.isPendingHash(currentPackageHash)
    if (pendingUpdate && isPendingHash) {
      this.initializeUpdateAfterRestart()
    }
  }

  private hasBinaryVersionChanged(
    packageMetadata: Record<string, any>,
  ): boolean {
    const packageAppVersion: string = packageMetadata['appVersion']
    return !(this.sAppVersion === packageAppVersion)
  }

  needToReportRollback(): boolean {
    return this.sNeedToReportRollback
  }

  overrideAppVersion(appVersionOverride: string): void {
    this.sAppVersion = appVersionOverride
  }

  setNeedToReportRollback(needToReportRollback: boolean): void {
    this.sNeedToReportRollback = needToReportRollback
  }

  setDeploymentKey(deploymentKey: string): void {
    this.deploymentKey = deploymentKey
  }

  static setUsingTestConfiguration(shouldUseTestConfiguration: boolean): void {
    this.sTestConfigurationFlag = shouldUseTestConfiguration
  }

  clearUpdates(): void {
    this.mUpdateManager.clearUpdates()
    this.mSettingsManager.removePendingUpdate()
    this.mSettingsManager.removeFailedUpdates()
  }

  private isPackageBundleLatest(packageMetadata: Record<string, any>): boolean {
    try {
      let binaryModifiedDateDuringPackageInstall = null
      let binaryModifiedDateDuringPackageInstallString: string =
        packageMetadata[CodePushConstants.BINARY_MODIFIED_TIME_KEY]
      if (binaryModifiedDateDuringPackageInstallString != null) {
        binaryModifiedDateDuringPackageInstall = parseInt(
          binaryModifiedDateDuringPackageInstallString,
        )
      }
      let packageAppVersion: string = packageMetadata['appVersion']
      return (
        binaryModifiedDateDuringPackageInstall &&
        (CodePush.isUsingTestConfiguration() ||
          this.sAppVersion === packageAppVersion)
      )
    } catch (e) {
      throw new CodePushUnknownException(
        'Error in reading binary modified date from package metadata',
        e,
      )
    }
  }

  private getCustomPropertyFromStringsIfExist(propertyName: string): string {
    let result: string
    try {
      result = this.context.resourceManager.getStringByNameSync(propertyName)
      Logger.info(
        TAG,
        `getCustomPropertyFromStringsIfExist propertyName: ${propertyName}, result: ${result}`,
      )
    } catch (error) {
      Logger.error(
        TAG,
        `getCustomPropertyFromStringsIfExist propertyName: ${propertyName}, error: ${JSON.stringify(error)}`,
      )
    }
    return result
  }

  getServerUrl(): string {
    return this.mServerUrl
  }

  getCommonHash(): string {
    return this.commonHash
  }

  isRunningBinaryVersion(): boolean {
    return this.sIsRunningBinaryVersion
  }

  invalidateCurrentInstance() {
    this.mCurrentInstance = null
  }

  public rollbackPackage(): void {
    log(`rollbackPackage======`)
    let info: object = this.mUpdateManager.getCurrentPackageInfo()
    Logger.info(
      TAG,
      `rollbackPackage getCurrentPackageInfo: ${JSON.stringify(info)}`,
    )
    // 存储有问题的热更新
    let failedPackage: object = this.mUpdateManager.getCurrentPackage()
    this.mSettingsManager.saveFailedUpdate(failedPackage)
    this.mUpdateManager.rollbackPackage()
    this.mSettingsManager.removePendingUpdate()
    // 主动触发 reload，这里不能重复创建 instance，不然存在回滚bug
    // RN_INSTANCE_MANAGER.reCreateRNInstance(
    //   this.bundleInfo.bundleName,
    // )
  }
}
