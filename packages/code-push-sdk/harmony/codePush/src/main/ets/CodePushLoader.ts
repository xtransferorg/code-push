import {
  JSBundleProvider,
  JSBundleProviderError,
} from '@rnoh/react-native-openharmony/ts'
import fs from '@ohos.file.fs'
import Logger from './Logger'
import { CodePushUpdateManager } from './CodePushUpdateManager'
import { CodePushNativeModule } from './CodePushNativeModule'
import { common } from '@kit.AbilityKit'
import NativeCodePush, { getOrCreateNativeCodePush } from './nativeCodePush/NativeCodePush'
import { log } from './nativeCodePush/Logging'
import { DEFAULT_ROLLBACK_RETRY_OPTIONS, SyncStatus,
  UPDATE_CHECK_TIMEOUT } from './nativeCodePush/NativeCodePushConstant'
import { RemotePackage } from './nativeCodePush/core/RemotePackage'
import { Callback, emitter } from '@kit.BasicServicesKit'
import { BundleInfo } from '@xrnjs/multi-bundle/src/main/ets/bundle/BundleInfo'
import { rawfileExists, getRawFileBundleName } from './nativeCodePush/NativeCodePushUtil'
import { JSON } from '@kit.ArkTS'
import { CodePushConstants } from '../../../ts'
import { CodePushUtils } from './CodePushUtils'
import { CodePushUpdateUtils } from './CodePushUpdateUtils'
import { getGlobalErrorCallback } from './CodePush'
import { Preloadable } from '@xrnjs/multi-bundle/src/main/ets/bundle/Preloadable'

const TAG = 'CodePushLoader:'
const SYNC_STALE_TIME_MS = 5 * 60 * 1000

export class CodePushJSBundleProvider extends JSBundleProvider implements Preloadable {

  private readonly  nativeCodePush: NativeCodePush
  private codePushUpdateManager: CodePushUpdateManager

  private retryResolve: (value) => void
  /** preload() 已成功完成，getBundle() 跳过重复热更新 */
  private hotUpdateChecked: boolean = false

  constructor(
    private appKeys: string[] = [],
    private context: common.UIAbilityContext,
    private bundleInfo: BundleInfo,
    private deploymentKey: string,
    private serverUrl: string,
    private commonHash: string,
    private useNativeCodePush: boolean,
    private onSyncStatus?: (status: number, bundleName: string) => void
  ) {
    super()
    this.useNativeCodePush = useNativeCodePush
    if (useNativeCodePush) {
      this.nativeCodePush = getOrCreateNativeCodePush(context, bundleInfo, serverUrl, commonHash)
    }
    this.codePushUpdateManager = new CodePushUpdateManager(
      this.context,
      '',
      bundleInfo.bundleName,
      this.deploymentKey,
    )
  }

  getURL(): string {
    return this.getCurrentBundlePath()
  }

  getAppKeys(): string[] {
    return this.appKeys
  }
  
  private hasBasePackage(): boolean {
    let result: boolean = rawfileExists(this.context, getRawFileBundleName(this.bundleInfo.bundleName))
    if (!result && this.nativeCodePush && this.nativeCodePush.codePush) {
      result = !!this.nativeCodePush.codePush.mUpdateManager.getBasePackage()
    }
    return result
  }


  // ─── Preloadable ───────────────────────────────────────

  /**
   * 预加载：提前执行热更新 check → download，缓存结果。
   * 失败时静默忽略，getBundle() 会在需要时重试完整流程。
   */
  async preload(): Promise<void> {
    if (this.hotUpdateChecked) return
    if (!this.useNativeCodePush || !this.nativeCodePush) {
      this.hotUpdateChecked = true
      return
    }
    try {
      this.hasBasePackageInfo = this.hasBasePackage()
      await this.codePushSyncForPreload()
      this.hotUpdateChecked = true
      log(`[Preload]-${TAG}.preload: completed`)
    } catch (err) {
      log(`[Preload]-${TAG}.preload: silently failed (will retry in getBundle)=${JSON.stringify(err)}`)
    }
  }

  /**
   * 专为预加载的轻量 sync：与主流程 callback 逻辑一致，但任意最终状态均静默 resolve，不触发错误 UI。
   */
  private codePushSyncForPreload(): Promise<void> {
    return new Promise<void>((resolve) => {   // executor 是同步的，不带 async
      const settle = () => resolve()          // 多次调用安全，Promise 只 resolve 一次

      this.nativeCodePush
        .sync(
          {
            rollbackRetryOptions: DEFAULT_ROLLBACK_RETRY_OPTIONS,
            staleTime: SYNC_STALE_TIME_MS,
            updateCheckHttpTimeoutOptions: UPDATE_CHECK_TIMEOUT,
          },
          (syncStatus: number, remotePackage: RemotePackage, _error: Error) => {
            log(`[Preload]-${TAG}.codePushSyncForPreload: syncStatus=${syncStatus}, remotePackage=${JSON.stringify(remotePackage)}`)

            if (syncStatus === SyncStatus.UP_TO_DATE) {
              settle()
            } else if (syncStatus === SyncStatus.UPDATE_INSTALLED) {
              if (remotePackage?.isMandatory) {
                // mandatory 安装后立即触发重启，确保崩溃保护生效
                // this.nativeCodePush.initializeUpdateAfterRestart()
              }
              settle()
            } else if (syncStatus === SyncStatus.DOWNLOADING_PACKAGE) {
              if (remotePackage && !remotePackage.isMandatory) {
                // 非 mandatory 下载开始即可继续，结果在下次 cold start 生效
                settle()
              }
            } else if (
              syncStatus === SyncStatus.UPDATE_IGNORED ||
              syncStatus === SyncStatus.UNKNOWN_ERROR
            ) {
              settle()
            }
          },
          undefined,
          undefined,
        )
        .then(settle)                           // sync() 正常完成（callback 未提前 settle 时兜底）
        .catch((err) => {                       // sync() reject 时静默兜底
          log(`${TAG}.codePushSyncForPreload: catch=${JSON.stringify(err)}`)
          settle()
        })
    })
}


  async codePushSync(isRetry: boolean): Promise<boolean> {
    const promise = new Promise<boolean>(async (resolve, reject) => {
      try {
        const syncState = await this.nativeCodePush.sync({
          rollbackRetryOptions: DEFAULT_ROLLBACK_RETRY_OPTIONS,
          staleTime: SYNC_STALE_TIME_MS,
          updateCheckHttpTimeoutOptions: UPDATE_CHECK_TIMEOUT,
        }, (syncStatus: number, remotePackage: RemotePackage, error: Error) => {
          log(`${TAG}.codePushSync: syncStatusChangeCallback: syncStatus=${syncStatus}, remotePackage=${remotePackage}`)
          this.onSyncStatus?.(syncStatus, this.bundleInfo.bundleName)
          if (syncStatus === SyncStatus.UP_TO_DATE) {
            this.continueCodePushSyncSuccessCase(isRetry, resolve)
          } else if (syncStatus === SyncStatus.UPDATE_INSTALLED) {
            if (remotePackage && remotePackage.isMandatory) {
              // this.nativeCodePush.initializeUpdateAfterRestart()
              this.continueCodePushSyncSuccessCase(isRetry, resolve)
            }
          } else if (syncStatus === SyncStatus.DOWNLOADING_PACKAGE) {
            if (remotePackage && !remotePackage.isMandatory) {
              this.continueCodePushSyncSuccessCase(isRetry, resolve)
            }
          } else if (syncStatus === SyncStatus.UNKNOWN_ERROR) {
            const params: Record<string, string | number> = {}
            params["error"] = JSON.stringify(error)
            params["remotePackage"] = JSON.stringify(remotePackage)
            params["bundleInfo"] = JSON.stringify(this.bundleInfo)
            getGlobalErrorCallback()?.callback("NativeCodePushSyncError", params)
          }
        }, ({updatePackage, totalBytes, receivedBytes}) => {
          if (updatePackage && updatePackage.isMandatory) {
            const percent = (receivedBytes as number)/(totalBytes as number)
            emitter.emit("XT_NATIVE_CODE_PUSH_UPDATE_PROGRESS", { data: {percent, bundleName: this.bundleInfo.bundleName}})
          }
        }, () => {})
        log(`${TAG}.codePushSync:sync syncState=${syncState}`)
      } catch (err) {
        log(`${TAG}.codePushSync: catch err=${JSON.stringify(err)}`)
        this.handleCodePushSyncError(isRetry, err, resolve)
      }
    })

    return promise
  }

  /**
   * sync 正常流程
   * 如果是 getBundle 流程，则继续后续流程；
   * 如果是 retry 流程，则回到 getBundle 后续流程中
   * @param resolve
   */
  private continueCodePushSyncSuccessCase(isRetry: boolean, resolve) {
    log(`${TAG}.continueCodePushSyncSuccessCase: isRetry=${isRetry}, resolve=${resolve}`)
    resolve(true)
    if (!isRetry) {
      this.uninstallRetryCase()
    }
  }

  /**
   * sync 异常流程
   * 如果是 getBundle 流程，则继续后续流程
   * 如果是 retry 流程，则停住
   * @param isRetry
   * @param resolve
   */
  private continueCodePushSyncFailCase(isRetry:boolean, resolve) {
    log(`${TAG}.continueCodePushSyncFailCase: isRetry=${isRetry}, resolve=${resolve}`)
    resolve(false)
    if (!isRetry) {
      this.uninstallRetryCase()
    }
  }

  /**
   * sync 重试流程
   * 如果是 getBundle 流程，显示 404 页面，并监听事件
   * 如果是 retry 流程，什么都不做
   * @param resolve
   * @param err
   */
  private continueCodePushSyncRetryCase(isRetry:boolean, resolve, err) {
    log(`${TAG}.continueCodePushSyncRetryCase: isRetry=${isRetry}, resolve=${resolve}`)
    if (!isRetry) {
      this.installRetryCase(resolve)
      emitter.emit("XT_BUNDLE_ERROR_SHOW", { data: { "scene": "native_code_push_sync", error: err, bundleName: this.bundleInfo.bundleName } })
    }
  }

  /**
   * 处理 CodePushSync 异常
   * @param isRetry
   * @param error
   * @param resolve
   */
  private handleCodePushSyncError(isRetry: boolean, error, resolve) {
    log(`${TAG}handleCodePushSyncError: isRetry=${isRetry}, hasBasePackageInfo=${this.hasBasePackageInfo}, err=${JSON.stringify(error)}`)
    if (isRetry || this.hasBasePackageInfo) { //getBundle 流程有base包 或者 retry 流程
      this.continueCodePushSyncFailCase(isRetry, resolve)
    } else { //getBundle 流程没有 base 包
      this.continueCodePushSyncRetryCase(isRetry, resolve, error)
    }
  }

  private retryEventCallback: Callback<emitter.EventData> = undefined

  /**
   * 安装 retry 数据
   */
  private installRetryCase(resolve) {
    log(`${TAG}.installRetryCase`)
    if (!this.retryEventCallback) {
      this.retryEventCallback = async (data) => {
        emitter.emit("XT_BUNDLE_ERROR_HIDE")
        const result = await this.codePushSync(true)
        log(`${TAG}.installRetryCase, receive, result=${result}, retryResolve=${this.retryResolve}`)
        if (this.retryResolve) {
          if (result) {
            this.retryResolve(result)
          } else {
            emitter.emit("XT_BUNDLE_ERROR_SHOW", { data: { "scene": "native_code_push_sync", error: undefined, bundleName: this.bundleInfo.bundleName } })
          }
        }
      }
    }
    emitter.on("native_code_push_sync_retry", this.retryEventCallback)
    this.retryResolve = resolve
  }

  /**
   * 卸载 retry 数据
   * 只有 getBundle 才会有重试，才可以调用该方法
   */
  private uninstallRetryCase() {
    if (this.retryEventCallback) {
      emitter.off("native_code_push_sync_retry", this.retryEventCallback)
    }
    this.retryResolve = undefined
  }

  private hasBasePackageInfo: boolean = false

  async getBundle(
    onProgress?: (progress: number) => void,
  ): Promise<ArrayBuffer> {
    try {

      this.hasBasePackageInfo = this.hasBasePackage()

      if (this.useNativeCodePush && this.nativeCodePush && !this.hotUpdateChecked) {
        // preload() 未完成或失败，走完整热更新流程（含错误 UI 和重试）
        await this.codePushSync(false)
      }

      const url = this.getURL()
      log(`${TAG}.getBundle: url=${url}`)
      if (!url) {
        throw new Error('Bundle not found. ' + this.bundleInfo.bundleName + ' ' + this.deploymentKey)
      }

      const curPackageHash = this.codePushUpdateManager.getCurrentPackageHash()
      CodePushUpdateUtils.setRunningPackageHash(this.bundleInfo.bundleName, curPackageHash)

      const file = await fs.open(url, fs.OpenMode.READ_ONLY)
      const { size } = await fs.stat(file.fd)
      const buffer = new ArrayBuffer(size)
      await fs.read(file.fd, buffer, { length: size })
      return buffer
    } catch (err) {
      log(`${TAG}.getBundle: catch err=${JSON.stringify(err)}`)
      Logger.error(TAG, err)
      throw new JSBundleProviderError({
        whatHappened: `Couldn't load JSBundle from ${this.getURL()}`,
        extraData: err,
        howCanItBeFixed: [
          `Check if a bundle exists at "${this.getURL()}" on your device.`,
        ],
      })
    }
  }

  getCurrentBundlePath() {
    Logger.info(TAG, 'getCurrentBundlePath=' + this.deploymentKey)
    Logger.info(TAG, 'bundleName=' + this.bundleInfo.bundleName)
    const codePushUpdateManager = new CodePushUpdateManager(
      this.context,
      '',
      this.bundleInfo.bundleName,
      this.deploymentKey,
    )
    const bundlePath = codePushUpdateManager.getCurrentPackageBundlePath(
      this.bundleInfo.bundleName,
    )
    Logger.info(TAG, 'getCurrentBundlePath--bundlePath=' + bundlePath)
    return bundlePath
  }

  static loadCodePushBundle(
    context: common.UIAbilityContext,
    bundleInfo: BundleInfo,
    deploymentKey: string,
    serverUrl: string,
    commonHash: string,
    useNativeCodePush: boolean,
    onSyncStatus?: (status: number, bundleName: string) => void,
  ) {
    return new CodePushJSBundleProvider([], context, bundleInfo, deploymentKey, serverUrl, commonHash, useNativeCodePush, onSyncStatus)
  }
}
