import { http } from '@kit.NetworkKit';
import { Package } from '../core/Package';
import { RemotePackage } from '../core/RemotePackage'
import {
  DeploymentStatus,
  X_CODE_PUSH_PLUGIN_NAME, X_CODE_PUSH_PLUGIN_VERSION, X_CODE_PUSH_SDK_VERSION } from '../NativeCodePushConstant';
import { HttpTimeoutOption, request } from './HttpRequest'
import { NativeCodePushHttpConfig } from './NativeCodePushHttpConfig';
import { NativeCodePushCommonCode, NativeCodePushError, NativeCodeSyncHttpCode } from '../NativeCodePushError';
import { NativeCodePushStage } from '../NativeCodePushStage';
import { log } from '../Logging';
import { JSON } from '@kit.ArkTS';
import { UpdateCheckRequest } from './entity/UpdateCheckRequest';
import { UpdateCheckResponse } from './entity/UpdateCheckResponse';
import { DownloadReportRequest } from './entity/DownloadReportRequest';
import { DeploymentReportRequest } from './entity/DeploymentReportRequest';
import { HttpRequestError } from 'xrn-multi-bundle/src/main/ets/bundle/remoteBundle/http/HttpRequestError';
import { BatchUpdateCheckManager } from '../../batchUpdateCheck/BatchUpdateCheckManager'
import { isCodePushLabelNewer } from '../../Utils'


/**
 * common headers
 */
const HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'X-CodePush-Plugin-Name': X_CODE_PUSH_PLUGIN_NAME,
  'X-CodePush-Plugin-Version': X_CODE_PUSH_PLUGIN_VERSION,
  'X-CodePush-SDK-Version': X_CODE_PUSH_SDK_VERSION,
}

export interface NativeUpdateNotification {
  updateAppVersion: boolean // Always true
  appVersion: string
}

const TAG = "NativeCodePushHttpClient"

export class NativeCodePushHttpClient {

  private _appVersion: string
  private _clientUniqueId: string
  private _deploymentKey: string
  private _ignoreAppVersion: boolean
  private _serverUrl: string

  constructor(config: NativeCodePushHttpConfig) {
    this._appVersion = config.appVersion
    this._clientUniqueId = config.clientUniqueId
    this._deploymentKey = config.deploymentKey
    this._ignoreAppVersion = config.ignoreAppVersion
    this._serverUrl = config.serverUrl
    if (this._serverUrl.slice(-1) !== '/') {
      this._serverUrl += '/'
    }
  }

  /**
   * send a request of updateCheck
   * @param currentPackage
   * @returns
   */
  async queryUpdateWithCurrentPackage(
    currentPackage: Package & { basePackageHash?: string, commonHash?: string }, isPredownload: boolean, staleTime?: number, httpTimeoutOption?: HttpTimeoutOption,
  ): Promise<RemotePackage | NativeUpdateNotification> {
    return new Promise(async (resolve, reject) => {

      if (!currentPackage || !currentPackage.appVersion) {
        log(`${TAG}.queryUpdateWithCurrentPackage: invalid param, currentPackage=${currentPackage}, urrentPackage.appVersion=${currentPackage.appVersion}`)
        reject(Error(`queryUpdateWithCurrentPackage， invalid param, currentPackage=${currentPackage}, currentPackage.appVersion=${currentPackage.appVersion}`)) // Unexpected; indicates error in our implementation
        return
      }

      var updateRequest: UpdateCheckRequest = {
        deploymentKey: this._deploymentKey,
        appVersion: currentPackage.appVersion,
        packageHash: currentPackage.packageHash,
        isCompanion: this._ignoreAppVersion,
        label: currentPackage.label,
        clientUniqueId: this._clientUniqueId,
        basePackageHash: currentPackage.basePackageHash,
        commonHash: currentPackage.commonHash,
      }

      log(`${TAG}.currentPackage:=${JSON.stringify(currentPackage)}`)

      const batchCheckCacheData = BatchUpdateCheckManager.INSTANCE.getBatchUpdateCacheData()
      const cacheItem = batchCheckCacheData[this._deploymentKey]
      const cacheUpdateInfo = cacheItem?.updateInfo as UpdateCheckResponse
      if (cacheUpdateInfo) {
        log(`${TAG}.currentKeyCacheData:=${JSON.stringify(cacheUpdateInfo)}`)

        if (staleTime != null && Date.now() - cacheItem.cachedAt > staleTime) {
          log(`${TAG}.cache expired, staleTime=${staleTime}, cachedAt=${cacheItem.cachedAt}`)
        } else {
          const cacheDeploymentKey = cacheUpdateInfo.deploymentKey
          log(`${TAG}.cacheDeploymentKey:=${cacheDeploymentKey}`)

          const cacheLabel = cacheUpdateInfo.label
          const requestLabel = updateRequest.label
          const cacheAppVersion = cacheUpdateInfo.appVersion
          const requestAppVersion = updateRequest.appVersion

          if (cacheDeploymentKey === this._deploymentKey &&
            cacheAppVersion === requestAppVersion &&
            isCodePushLabelNewer(cacheLabel, requestLabel)) {
            log(`${TAG}.存在本地数据，不在发起网络请求:=${cacheDeploymentKey}`)
            this.handleCodePushUpdateInfo(cacheUpdateInfo, currentPackage, resolve, reject)
            return
          }
        }
      }

      var requestUrl: string = this._serverUrl + 'updateCheck?' + queryStringify(updateRequest)
      log(`${TAG}.requestUrl=${requestUrl}`)

      try {
        const json = await request({url: requestUrl, method: http.RequestMethod.GET, header: HEADERS, ...httpTimeoutOption})
        var responseObject: any = JSON.parse(json)
        var updateInfo: UpdateCheckResponse = responseObject.updateInfo
        log(`${TAG}.updateInfo:=${JSON.stringify(updateInfo)}`)
        this.handleCodePushUpdateInfo(updateInfo, currentPackage, resolve, reject)
      } catch (e) {
        log(`${TAG}.queryUpdateWithCurrentPackage:catch, e=${e}`)
        const isHttpError = e instanceof HttpRequestError
        reject(new NativeCodePushError(NativeCodePushStage.SYNC_CHECK, isHttpError? NativeCodePushCommonCode.HTTP_ERROR : NativeCodePushCommonCode.UNKNOWN_ERROR, "", isHttpError ? e.error : e))
      }

    })
  }

  private handleCodePushUpdateInfo(
    updateInfo: UpdateCheckResponse,
    currentPackage: Package & { basePackageHash?: string, commonHash?: string },
    resolve: (value: RemotePackage | NativeUpdateNotification) => void,
    reject: (reason?: Object) => void,
  ): void {
    if (!updateInfo) {
      log(`${TAG}.queryUpdateWithCurrentPackage:invalid response case, updateInfo=${updateInfo}`)
      reject(new NativeCodePushError(NativeCodePushStage.SYNC_CHECK, NativeCodeSyncHttpCode.NULL_RESPONSE, ""))
      return
    } else if (updateInfo.updateAppVersion) {
      log(`${TAG}.queryUpdateWithCurrentPackage:updateAppVersion=${updateInfo.updateAppVersion}`)
      resolve({
        updateAppVersion: true,
        appVersion: updateInfo.appVersion,
      })
      return
    } else if (!updateInfo.isAvailable) {
      log(`${TAG}.queryUpdateWithCurrentPackage:invalid response, isAvailable=${updateInfo.isAvailable}`)
      resolve(null)
      return
    }

    const currentPackageDiff = updateInfo.currentPackageDiff
    let isDiffAvailable = updateInfo.isDiffAvailable
    let downloadDiffUrl = updateInfo.downloadDiffUrl
    let downloadDiffSize = updateInfo.downloadDiffSize
    let hasCurrentPackageDiff = false

    if (currentPackageDiff &&
      currentPackageDiff.isDiffAvailable &&
      currentPackageDiff.downloadDiffUrl &&
      currentPackageDiff.downloadDiffSize > 0
    ) {
      hasCurrentPackageDiff = true
      isDiffAvailable = currentPackageDiff.isDiffAvailable
      downloadDiffUrl = currentPackageDiff.downloadDiffUrl
      downloadDiffSize = currentPackageDiff.downloadDiffSize
    }

    var remotePackage: RemotePackage = {
      deploymentKey: this._deploymentKey,
      description: updateInfo.description,
      label: updateInfo.label,
      appVersion: updateInfo.appVersion,
      isDisabled: updateInfo.isDisabled,
      isMandatory: updateInfo.isMandatory,
      packageHash: updateInfo.packageHash,
      packageSize: updateInfo.packageSize,
      downloadUrl: updateInfo.downloadURL,
      originalLabel: updateInfo.originalLabel,
      downloadDiffUrl: downloadDiffUrl,
      downloadDiffSize: downloadDiffSize,
      isDiffAvailable: isDiffAvailable,
      baseDownloadUrl: updateInfo.baseDownloadUrl,
      basePackageHash: updateInfo.basePackageHash,
      basePackageSize: updateInfo.basePackageSize,
      hasCurrentPackageDiff: hasCurrentPackageDiff,
      previousPackageHash: currentPackage.packageHash ?? ''
    }

    log(`${TAG}.remotePackage:, e=${JSON.stringify(remotePackage)}`)
    resolve(remotePackage)
  }

  async reportStatusDownload(
    downloadedPackage: Package,
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      var url: string = this._serverUrl + 'reportStatus/download'
      var body: DownloadReportRequest = {
        clientUniqueId: this._clientUniqueId,
        deploymentKey: this._deploymentKey,
        label: downloadedPackage.label,
      }

      try {
        await request({
          url,
          method: http.RequestMethod.POST,
          header: HEADERS,
          body: JSON.stringify(body)
        })
        resolve()
      } catch (err) {
        log(`${TAG}.reportStatusDownload: catch err=${err}`)
        reject(err)
      }

    })
  }

  async reportStatusDeploy(
    deployedPackage?: Package,
    status?: string,
    previousLabelOrAppVersion?: string,
    previousDeploymentKey?: string,
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      var url: string = this._serverUrl + 'reportStatus/deploy'
      var body: DeploymentReportRequest = {
        appVersion: this._appVersion,
        deploymentKey: this._deploymentKey,
      }

      if (this._clientUniqueId) {
        body.clientUniqueId = this._clientUniqueId
      }

      if (deployedPackage) {
        body.label = deployedPackage.label
        body.appVersion = deployedPackage.appVersion
        body.patchFailed = deployedPackage.patchFailed

        switch (status) {
          case DeploymentStatus.SUCCEEDED:
          case DeploymentStatus.FAILED:
            body.status = status
            break

          default:
            log(`${TAG}.reportStatusDeploy:invalid param, status=${status}`)
            if (!status) {
              reject(new Error('Missing status argument.'))
            } else {
              reject(new Error('Unrecognized status "' + status + '".'),)
            }
            return
        }
      }

      if (previousLabelOrAppVersion) {
        body.previousLabelOrAppVersion = previousLabelOrAppVersion
      }

      if (previousDeploymentKey) {
        body.previousDeploymentKey = previousDeploymentKey
      }

      try {
        await request({url, method: http.RequestMethod.POST, header: HEADERS, body: JSON.stringify(body)})
        resolve()
      } catch (err) {
        log(`${TAG}.reportStatusDeploy:catch err=${err}`)
        reject(err)
      }

    })
  }
}

function queryStringify(object: Object): string {
  var queryString = ''
  var isFirst: boolean = true

  for (var property in object) {
    if (object.hasOwnProperty(property)) {
      var value: string = (<any>object)[property]
      if (!isFirst) {
        queryString += '&'
      }

      queryString += encodeURIComponent(property) + '='
      if (value !== null && typeof value !== 'undefined') {
        queryString += encodeURIComponent(value)
      }

      isFirst = false
    }
  }

  return queryString
}
