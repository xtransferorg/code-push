import { common } from "@kit.AbilityKit"
import { BatchUpdateCheckItems, BatchUpdateCheckRequest } from './http/entity/BatchUpdateCheckRequest'
import { BatchUpdateCheckResponse, UpdateInfo } from './http/entity/BatchUpdateCheckResponse'
import { UpdateCheckResponse } from '../nativeCodePush/http/entity/UpdateCheckResponse'
import { request, HttpTimeoutOption } from '../nativeCodePush/http/HttpRequest'
import { http } from "@kit.NetworkKit";
import { CodePushUpdateManager } from '../CodePushUpdateManager'
import { CodePushUpdateUtils } from '../CodePushUpdateUtils'
import { BundleInfoManager } from '@xrnjs/multi-bundle/src/main/ets/bundle/BundleInfoManager'
import { BundleInfo } from '@xrnjs/multi-bundle/src/main/ets/bundle/BundleInfo'
import { BatchUpdateCacheDataType } from './BatchUpdateCacheDataType'
import { getClientUniqueId } from '../Utils'

const TAG = "[BatchUpdateCheckManager]"

export class BatchUpdateCheckManager {

  static INSTANCE: BatchUpdateCheckManager = new BatchUpdateCheckManager()

  private context?: common.UIAbilityContext
  private serverUrl: string = ''
  private commonHash: string = ''
  private clientUniqueId: string = ''
  private appVersion: string = ''
  private codePushPackages: Record<string, Object>[] = []

  private batchCheckCacheData: BatchUpdateCacheDataType = {}

  private constructor() {
  }

  batchUpdateCheck(context: common.UIAbilityContext, serverUrl: string, commonHash: string, appVersion: string): void {
    this.context = context
    this.serverUrl = serverUrl
    this.commonHash = commonHash
    this.clientUniqueId = getClientUniqueId(context)
    this.appVersion = appVersion
    this.codePushPackages = this.handleCodePushInfo()

    this.fetchBatchUpdateCheck(this.codePushPackages)
  }

  private fetchBatchUpdateCheck(packages:  Record<string, Object>[]) {
    try {
      const params: BatchUpdateCheckRequest = {
        appVersion: this.appVersion,
        clientUniqueId: this.clientUniqueId,
        items: this.handleBatchCheckParams(packages)
      };

      console.log(TAG, `fetchBatchUpdateCheck:start, params=${JSON.stringify(params)}`)
      request({
        url: `${this.serverUrl}/batchUpdateCheck`,
        method: http.RequestMethod.POST,
        header: {
          'Content-Type': 'application/json'
        },
        body: params,
        ...HttpTimeoutOption
      }).then((responseStr: string) => {
        console.log(TAG, `fetchBatchUpdateCheck:start, responseStr=${JSON.stringify(responseStr)}`)
        const responseObj = JSON.parse(responseStr) as BatchUpdateCheckResponse
        console.log(TAG, `fetchBatchUpdateCheck:start, responseObj=${JSON.stringify(responseObj)}`)

        const batchUpdateCacheData: BatchUpdateCacheDataType = {}
        const cachedAt = Date.now()
        const updateInfos = responseObj.updateInfos as UpdateInfo[]
        for (let i = 0; i < updateInfos.length; i++) {
          const info = updateInfos[i] as UpdateInfo
          const deploymentKey = info.deploymentKey
          const updateInfo = info.updateInfo as UpdateCheckResponse

          updateInfo.deploymentKey = deploymentKey
          batchUpdateCacheData[deploymentKey] = {
            updateInfo,
            cachedAt,
          }
        }

        this.batchCheckCacheData = batchUpdateCacheData
        console.log(TAG, `fetchBatchUpdateCheck:start, batchUpdateCacheData=${JSON.stringify(batchUpdateCacheData)}`)
      }).catch((err) => {
        console.log(TAG, `batchUpdateCheck:err=${JSON.stringify(err)}`);
      });
    } catch (err) {
      console.log(TAG, `batchUpdateCheck:err=${JSON.stringify(err)}`);
    }
  }

  private handleBatchCheckParams(packages: Record<string, Object>[]): BatchUpdateCheckItems[] {
    const items: BatchUpdateCheckItems[] = []
    console.log(TAG, `handleBatchCheckParams:packages=${JSON.stringify(packages)}`);

    for (let i = 0; i < packages.length; i++) {
      const packageInfo = packages[i]

      const deploymentKey = packageInfo['deploymentKey'] as string
      const basePackageHash = packageInfo['basePackageHash'] as string
      const label = packageInfo['label'] as string
      const packageHash = packageInfo['packageHash'] as string

      const params: BatchUpdateCheckItems = {
        deploymentKey,
        label,
        packageHash,
        basePackageHash,
        commonHash: this.commonHash,
      }
      items.push(params)
    }

    console.log(TAG, `handleBatchCheckParams:items=${JSON.stringify(items)}`)
    return items
  }

  handleCodePushInfo() {
    const packages: Record<string, Object>[] = BundleInfoManager.INSTANCE.BUNDLE_INFOS
      .map((bundleInfo: BundleInfo) => this.getBundleCodePushInfo(this.context, bundleInfo))
      .filter((item: Record<string, Object>) => Object.keys(item).length > 0)
    return packages
  }

  // 获取codepush package信息
  private getBundleCodePushInfo(context: common.UIAbilityContext, bundleInfo: BundleInfo): Record<string, Object> {
    let result: Record<string, Object> = {}
    if (!bundleInfo) {
      return result
    }

    console.log(TAG, `getBundleCodePushInfo：bundleInfo=${JSON.stringify(bundleInfo)}`)

    const deploymentKey = bundleInfo.getCodePushKey()
    console.log(TAG, `getBundleCodePushInfo：deploymentKey=${deploymentKey}`)

    if (!deploymentKey) {
      return result
    }

    const basePackageHash = CodePushUpdateUtils.getBasePackageHashFromRawfile(context, deploymentKey) ?? ''
    console.log(TAG, `getBundleCodePushInfo：basePackageHash=${basePackageHash}`)

    const updateManager = new CodePushUpdateManager(context, context.filesDir, bundleInfo.bundleName, deploymentKey)
    const curPackage = updateManager.getCurrentPackage() as Record<string, Object>
    console.log(TAG, `getBundleCodePushInfo：curPackage=${JSON.stringify(curPackage)}`)
    if (!curPackage) {
      return {
        basePackageHash,
        deploymentKey,
        label: '',
        packageHash: ''
      }
    }

    curPackage['basePackageHash'] = basePackageHash
    curPackage['deploymentKey'] = deploymentKey

    result = curPackage

    console.log(TAG, `getBundleCodePushInfo：result=${JSON.stringify(result)}`)
    return result
  }

  getBatchUpdateCacheData() {
    return this.batchCheckCacheData
  }
}
