/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import { CodePush, getGlobalErrorCallback } from './CodePush'
import { CodePushConstants } from './CodePushConstants'
import FileUtils, { CopyConflictMode } from './FileUtils'
import fs from '@ohos.file.fs'
import zlib from '@ohos.zlib'
import { CodePushUtils } from './CodePushUtils'
import { CodePushUpdateUtils } from './CodePushUpdateUtils'
import { CodePushUpdateVerifyHash } from './CodePushUpdateVerifyHash'
import http from '@ohos.net.http'

import common from '@ohos.app.ability.common'
import Logger from './Logger'
import { HttpClient } from '@rnoh/react-native-openharmony/src/main/ets/HttpClient/HttpClient'
import { ReceivingProgress } from '@rnoh/react-native-openharmony/src/main/ets/HttpClient/types'
import { getCurrentAppVersionName } from './Utils'
import { log } from './nativeCodePush/Logging'
import { RemotePackage } from './nativeCodePush/core/RemotePackage'
import { JSON } from '@kit.ArkTS'
import { fileUri } from '@kit.CoreFileKit'
import hpatchz from 'libhpatchz.so';

const TAG = 'CodePushNativeModule-CodePushUpdateManager: '

// 自定义一个 Promise的 互斥锁
class HpatchMutex {
  private tail: Promise<void> = Promise.resolve()
  async runExclusive<T>(task: () => T | Promise<T>): Promise<T> {
    let release: () => void = () => {}
    const wait = new Promise<void>((resolve) => { release = resolve })
    const prev = this.tail
    this.tail = wait
    try {
      await prev
    } catch(err) {
      Logger.info(TAG, `runExclusive, error：${err}`)
    }
    try {
      return await task()
    } finally {
      release()
    }
  }
}

const HPATCH_GLOBAL_LOCK = new HpatchMutex()
const HPATCH_FAIL_CODE = -1000

type Callback = (arg1: number | string, arg2: number | string) => void

function isArrayBufferZip(arrayBuffer) {
  // 读取前四个字节
  var bytes = new Uint8Array(arrayBuffer, 0, 4)
  // 检查是否匹配 ZIP 文件的魔术数字
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}

export class CodePushUpdateManager {
  constructor(
    private context: common.UIAbilityContext,
    private documentsDirectory: string,
    private bundleName: string,
    private deploymentKey: string,
  ) {}

  public setBundleInfo(bundleName: string, deploymentKey: string) {
    this.bundleName = bundleName;
    this.deploymentKey = deploymentKey
  }

  public getCodePushPath(): string {
    let codePushPath: string = CodePushUtils.appendPathComponent(
      this.context.filesDir,
      getCurrentAppVersionName() +
        '/' +
        this.deploymentKey +
        CodePushConstants.CODE_PUSH_FOLDER_PREFIX,
    )
    if (CodePush.isUsingTestConfiguration()) {
      codePushPath = CodePushUtils.appendPathComponent(
        codePushPath,
        '/TestPackages',
      )
    }

    return codePushPath
  }

  public getUnzippedFolderPath(): string {
    const unzippedFolderPath = CodePushUtils.appendPathComponent(
      this.getCodePushPath(),
      CodePushConstants.UNZIPPED_FOLDER_NAME,
    )
    return unzippedFolderPath
  }

  public getCopyInnerBundlePath(bundleName: string): string {
    const copyInnerBundlePath: string = CodePushUtils.appendPathComponent(
      this.context.filesDir,
      `${getCurrentAppVersionName()}_${bundleName}`
    )
    return copyInnerBundlePath
  }

  public getStatusFilePath(): string {
    return CodePushUtils.appendPathComponent(
      this.getCodePushPath(),
      CodePushConstants.STATUS_FILE,
    )
  }

  public getCurrentPackageInfo(): object {
    let statusFilePath: string = this.getStatusFilePath()
    Logger.info(TAG, `getCurrentPackageInfo, statusFilePath=${statusFilePath}`)
    if (!FileUtils.fileAtPathExists(statusFilePath)) {
      Logger.info(TAG, `getCurrentPackageInfo statusFilePath not exists`)
      return {}
    }
    //读文件 并转化成JSON 返回
    try {
      return CodePushUtils.getJsonObjectFromFile(statusFilePath)
    } catch (e) {
      // Should not happen.
      Logger.error(TAG, `getJsonObjectFromFile,error:${JSON.stringify(e)}`)
    }
  }

  public updateCurrentPackageInfo(packageInfo: object): void {
    log(`updateCurrentPackageInfo:packageInfo=${JSON.stringify(packageInfo)}`)
    try {
      CodePushUtils.writeJsonToFile(
        packageInfo,
        this.getStatusFilePath(),
        'updateCurrentPackageInfo',
      )
    } catch (e) {
      // Should not happen.
      Logger.error(TAG, 'Error updating current package info', e)
    }
  }

  public getCurrentPackageFolderPath(): string {
    let info: object = this.getCurrentPackageInfo()
    let packageHash: string = info[CodePushConstants.CURRENT_PACKAGE_KEY]
    if (!packageHash) {
      return null
    }

    return this.getPackageFolderPath(packageHash)
  }

  public bundleFileExists(packageHash: string, expectedBundleName: string): boolean {
    const newUpdateFolderPath = this.getPackageFolderPath(packageHash)
    const releaseHaromonyFolder = CodePushUtils.appendPathComponent(newUpdateFolderPath, CodePushConstants.RELATIVE_BUNDLE_FOLDER_NAME)
    const bundleFilePath = CodePushUtils.appendPathComponent(releaseHaromonyFolder, expectedBundleName)
    const isExist = fs.accessSync(bundleFilePath)
    return isExist
  }

  public getCurrentPackageBundlePath(bundleFileName: string): string {
    let packageFolder: string = this.getCurrentPackageFolderPath()
    if (packageFolder == null) {
      return null
    }

    let currentPackage = this.getCurrentPackage()
    if (!currentPackage) {
      return null
    }

    let relativeBundlePath: string =
      currentPackage[CodePushConstants.RELATIVE_BUNDLE_PATH_KEY].toString()
    if (relativeBundlePath == null) {
      return CodePushUtils.appendPathComponent(packageFolder, bundleFileName)
    } else {
      return CodePushUtils.appendPathComponent(
        packageFolder,
        relativeBundlePath,
      )
    }
  }

  public getPackageFolderPath(packageHash: string): string {
    return CodePushUtils.appendPathComponent(
      this.getCodePushPath(),
      packageHash,
    )
  }

  public getBasePackageHash(): string {
    let info: object = this.getCurrentPackageInfo()
    return info[CodePushConstants.PACKAGE_BASE_HASH_KEY]
  }

  public getCurrentPackageHash(): string {
    let info: object = this.getCurrentPackageInfo()
    return info[CodePushConstants.CURRENT_PACKAGE_KEY]
  }

  public getPreviousPackageHash(): string {
    let info: object = this.getCurrentPackageInfo()
    Logger.info(
      TAG,
      'installPackage--getPreviousPackageHash=' + JSON.stringify(info),
    )
    return info[CodePushConstants.PREVIOUS_PACKAGE_KEY]
  }

  public getBasePackage(): Record<string, any> {
    let basePackageHash: string = this.getBasePackageHash()
    Logger.info(TAG, `updateManager, basePackageHash:${basePackageHash}`)
    if (!basePackageHash) {
      return null
    }
    return this.getPackage(basePackageHash)
  }

  public getCurrentPackage(): Record<string, any> {
    let packageHash: string = this.getCurrentPackageHash()
    Logger.info(TAG, `updateManager, packageHash:${packageHash}`)
    if (!packageHash) {
      return
    }

    return this.getPackage(packageHash)
  }

  public getPreviousPackage(): Record<string, any> {
    let packageHash: string = this.getPreviousPackageHash()
    if (packageHash == null) {
      return null
    }
    return this.getPackage(packageHash)
  }

  public getPackage(packageHash: string): Record<string, any> {
    let folderPath: string = this.getPackageFolderPath(packageHash)
    let packageFilePath: string = CodePushUtils.appendPathComponent(
      folderPath,
      CodePushConstants.PACKAGE_FILE_NAME,
    )
    Logger.info(TAG, `packageHash--folderPath=${folderPath}`)
    Logger.info(TAG, `packageHash--packageFilePath=${packageFilePath}`)
    try {
      return CodePushUtils.getJsonObjectFromFile(packageFilePath)
    } catch (e) {
      Logger.error(TAG, `packageHash--getPackage,error=${JSON.stringify(e)}`)
      return null
    }
  }

  async downloadPackage(
    updatePackage: Record<string, any>,
    expectedBundleFileName: string,
    httpClient: HttpClient,
    progressCallback: Callback,
    stringPublicKey: string,
  ) {
    Logger.info(
      TAG,
      `downloadPackage updatePackage:${JSON.stringify(updatePackage)}`,
    )
    //下载基础包
    let needDownloadBasePackage = false
    if (!CodePushUtils.rawfileExists(this.context, expectedBundleFileName) && updatePackage.basePackageHash && updatePackage.baseDownloadUrl) { //动态 Bundle
      const basePackageHash = this.getCurrentPackageInfo()[CodePushConstants.PACKAGE_BASE_HASH_KEY]
      Logger.info(TAG, `downloadPackage basePackageHash:${basePackageHash}`)

      Logger.info(TAG, `downloadPackage updatePackage.basePackageHash:${updatePackage.basePackageHash}`)
      Logger.info(TAG, `downloadPackage updatePackage.packageHash:${updatePackage.packageHash}`)
      if ((!basePackageHash || basePackageHash !== updatePackage.basePackageHash) && (updatePackage.basePackageHash !== updatePackage.packageHash)) { // 先下载基础包
        needDownloadBasePackage = true
        const basePackage: any = {...updatePackage, downloadUrl: updatePackage.baseDownloadUrl, packageHash: updatePackage.basePackageHash, packageSize: updatePackage.basePackageSize}
        const baseResult: any = await this.downloadAndUnzip("downloadBasePackage", httpClient, basePackage, expectedBundleFileName, CodePushUtils.convertString2NumberSafe(updatePackage.packageSize, 0), 0, progressCallback)
        this.saveBasePackageHash(updatePackage.basePackageHash)
      }
    }

    Logger.info(TAG, `downloadPackage needDownloadBasePackage:${needDownloadBasePackage}`)
    //下载热更包
    const basePackageSize = needDownloadBasePackage ? CodePushUtils.convertString2NumberSafe(updatePackage.basePackageSize, 0) : 0
    const updateResult: any = await this.downloadAndUnzip("downloadUpdatePackage", httpClient, updatePackage as any, expectedBundleFileName, basePackageSize, basePackageSize, progressCallback)
    if (updatePackage.basePackageHash && updatePackage.basePackageHash === updatePackage.packageHash) {
      this.saveBasePackageHash(updatePackage.basePackageHash)
    }

    //拷贝 基础包中的图片到热更新包目录中
    if (!CodePushUtils.rawfileExists(this.context, expectedBundleFileName) && updatePackage.basePackageHash && updatePackage.basePackageHash !== updatePackage.packageHash) {
      const baseBundleFolderPath = await this.getJSBundleFolderPath(updatePackage.basePackageHash, expectedBundleFileName)
      const bundleFolderPath = await this.getJSBundleFolderPath(updatePackage.packageHash, expectedBundleFileName)
      try {
        await this.copyDirNoOverwrite(CodePushUtils.appendPathComponent(baseBundleFolderPath, "assets"), CodePushUtils.appendPathComponent(bundleFolderPath, "assets"));
      } catch (e) {
        log(`copyDirNoOverwrite error=${JSON.stringify(e)}`)
        const params: Record<string, string | number> = {}
        params["error"] =  JSON.stringify(e)
        params["baseBundleFolderPath"] = baseBundleFolderPath
        params["bundleFolderPath"] = bundleFolderPath
        params["expectedBundleFileName"] = expectedBundleFileName
        getGlobalErrorCallback()?.callback("DownloadPackageAssetCopyError", params)
      }
    }
  }

  private saveBasePackageHash(basePackageHash: string) {
    let info: object = this.getCurrentPackageInfo()
    info[CodePushConstants.PACKAGE_BASE_HASH_KEY] = basePackageHash
    this.updateCurrentPackageInfo(info)
  }

  /**
   * download and unzip
   * @param tag
   * @param httpClient
   * @param remotePackage
   * @param expectedBundleFileName
   * @param baselineReceive
   * @param baselineTotal
   * @param progressCallback
   */
  private async downloadAndUnzip(tag: string, httpClient: HttpClient, remotePackage: RemotePackage, expectedBundleFileName: string, baselineTotal: number, baselineReceive: number, progressCallback: Callback): Promise<any> {
    let isZip: boolean = false
    let downloadFile: string = ''

    const unzippedFolderPath = this.getUnzippedFolderPath()
    let packageFolderPath = this.getPackageFolderPath(remotePackage.packageHash)
    let packageMetadataPath = CodePushUtils.appendPathComponent(packageFolderPath, CodePushConstants.PACKAGE_FILE_NAME)
    let jsBundlePath: string = ''

    Logger.info(TAG, `downloadAndUnzip:tag` + tag)
    Logger.info(TAG, `downloadAndUnzip:packageMetadataPath` + packageMetadataPath)
    Logger.info(TAG, `downloadAndUnzip:remotePackage` + JSON.stringify(remotePackage))
    const newUpdateHash = remotePackage['packageHash']
    Logger.info(TAG, `downloadAndUnzip:packageHash=` + newUpdateHash)

    Logger.info(TAG, `downloadAndUnzip:packageFolderPath=` + packageFolderPath)
    Logger.info(TAG, `downloadAndUnzip:expectedBundleFileName=` + expectedBundleFileName)

    if (FileUtils.fileAtPathExists(packageFolderPath)) {
      FileUtils.deleteDirectoryAtPath(packageFolderPath)
    }

    if (FileUtils.fileAtPathExists(unzippedFolderPath)) {
      FileUtils.deleteDirectoryAtPath(unzippedFolderPath)
    }

    let onReceiveProgress = (receiveProgress: ReceivingProgress) => {
      // log(`downloadAndUnzip:tag=${tag}, receiveProgress=${JSON.stringify(receiveProgress)}, baselineTotal=${baselineTotal}, baselineReceive=${baselineReceive}`)
      progressCallback(
        baselineTotal + Number(receiveProgress.totalLength),
        baselineReceive + Number(receiveProgress.lengthReceived),
      )
    }

    const downloadDiffUrl = remotePackage.downloadDiffUrl
    const downloadDiffSize = remotePackage.downloadDiffSize
    const isDiffAvailable = remotePackage.isDiffAvailable
    const needRollbackFullBundle = remotePackage[CodePushConstants.RollbackFullBundleUpdatePackage]

    const isDownloadDiff = !needRollbackFullBundle && downloadDiffUrl && downloadDiffSize > 0 && isDiffAvailable
    let downloadUrl = isDownloadDiff ? downloadDiffUrl : remotePackage.downloadUrl
    if (tag === 'downloadBasePackage') {
      // 动态bundle，存在多个热更新，先下载基础包
      downloadUrl = remotePackage.downloadUrl
    }

    Logger.info(TAG, `downloadAndUnzip:downloadUrl` + downloadUrl)
    const httpResponse = await httpClient.sendRequest(downloadUrl, {
      method: http.RequestMethod.GET,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      usingCache: false,
      onReceiveProgress: onReceiveProgress,
    }).promise

    let data = httpResponse.body
    if (data) {
      Logger.info(TAG, `downloadPackage,data`)
      let downloadFolder = this.getCodePushPath()
      Logger.info(TAG, 'downloadPackage--downloadFolder=' + downloadFolder)
      if (!fs.accessSync(downloadFolder)) {
        Logger.info(TAG, 'downloadPackage--downloadFolder not exist')
        fs.mkdirSync(downloadFolder, true)
        Logger.info(TAG, 'downloadPackage--downloadFolder mkdirSync success')
      } else {
        Logger.info(TAG, 'downloadPackage--downloadFolder exist')
      }
      downloadFile = downloadFolder + '/' + CodePushConstants.DOWNLOAD_FILE_NAME
      Logger.info(TAG, 'downloadPackage--downloadFile=' + downloadFile)
      let file = fs.openSync(
        downloadFile,
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC,
      )
      let writeLen = fs.writeSync(file.fd, data)
      Logger.info(TAG, 'write data to file succeed and size is:' + writeLen)
      fs.closeSync(file)

      isZip = isArrayBufferZip(data)
      if (isZip) {
        Logger.info(TAG, 'downloadPackage--isZip entry')

        try {
          if (!fs.accessSync(packageFolderPath)) {
            Logger.info(TAG, 'mkdirSync packageFolderPath not exist.')
            fs.mkdirSync(packageFolderPath, true)
            Logger.info(TAG, 'mkdirSync packageFolderPath success. ')
          }
        } catch (error) {
          Logger.info(
            TAG,
            `mkdirSync packageFolderPath error,${JSON.stringify(error)}`,
          )
        }

        let options2: zlib.Options = {
          level: zlib.CompressLevel.COMPRESS_LEVEL_DEFAULT_COMPRESSION,
        }

        try {
          Logger.info(TAG, `downloadFile:${downloadFile}`)
          Logger.info(TAG, `packageFolderPath:${packageFolderPath}`)
          Logger.info(TAG, `options2:${options2}`)
          await zlib.decompressFile(downloadFile, packageFolderPath, options2)
          Logger.info(TAG, 'decompressFile download success2. data')
          // FileUtils.deleteDirectoryAtPath(downloadFile)
        } catch (error) {
          Logger.error(TAG, `errData is errCode:${JSON.stringify(error)}`)
          FileUtils.deleteDirectoryAtPath(downloadFile)
          return {jsBundlePath}
        }

        // 校验全量包的hash一致性
        try {
          Logger.info(TAG, 'downloadPackage--newUpdateHash：' + newUpdateHash)
          const isOk = await CodePushUpdateVerifyHash.verifyFolderHash(packageFolderPath, newUpdateHash)
          if (!isOk) {
            Logger.info(TAG, 'downloadPackage--verifyFolderHash：' + 'The update contents failed the data integrity check.')
            FileUtils.deleteDirectoryAtPath(downloadFile)
            return {jsBundlePath}
          } else {
            Logger.info(TAG, 'downloadPackage--verifyFolderHash：' + 'The update contents succeeded the data integrity check..')
          }
        } catch (error) {
          Logger.info(TAG, 'downloadPackage--verifyFolderHash：' + 'The update contents failed the data integrity check.')
          FileUtils.deleteDirectoryAtPath(downloadFile)
          return {jsBundlePath}
        }

        // jsBundlePath =
        //   await CodePushUpdateUtils.findJSBundleInUpdateContents(
        //     packageFolderPath,
        //     expectedBundleFileName,
        //   )
        //
        // remotePackage[CodePushConstants.RELATIVE_BUNDLE_PATH_KEY] = jsBundlePath
        // Logger.info(TAG, 'bundlePath=' + jsBundlePath)
      } else {
        // 增量更新逻辑

        const hasCurrentPackageDiff = remotePackage.hasCurrentPackageDiff
        const previousPackageHash = remotePackage.previousPackageHash
        let useCurrentPackageDiff = false

        Logger.info(TAG, 'downloadPackage--remotePackage=' + hasCurrentPackageDiff)
        Logger.info(TAG, 'downloadPackage--remotePackage' + previousPackageHash)
        if (hasCurrentPackageDiff && previousPackageHash) {
          const previousPackagePath = this.getPackageFolderPath(previousPackageHash)
          Logger.info(TAG, 'downloadPackage--previousPackagePath' + previousPackagePath)
          const previousBundleDir = `${previousPackagePath}/${CodePushConstants.RELATIVE_BUNDLE_FOLDER_NAME}`
          const previousBundleFile = `${previousBundleDir}/${expectedBundleFileName}`
          useCurrentPackageDiff = fs.accessSync(previousBundleDir) && fs.accessSync(previousBundleFile)
          Logger.info(TAG, 'downloadPackage--useCurrentPackageDiff' + useCurrentPackageDiff)
        }

        let copyInnerBundlePath
        if (useCurrentPackageDiff) {
          // 基于当前包做增量更新
          copyInnerBundlePath = `${this.getPackageFolderPath(previousPackageHash)}/${CodePushConstants.RELATIVE_BUNDLE_FOLDER_NAME}`
        } else {
          copyInnerBundlePath = this.getCopyInnerBundlePath(expectedBundleFileName)
          if (!fs.accessSync(copyInnerBundlePath)) {
            Logger.info(TAG, 'downloadPackage--copyInnerBundlePath not exist')
            fs.mkdirSync(copyInnerBundlePath, true)
            Logger.info(TAG, 'downloadPackage--copyInnerBundlePath mkdirSync success')
          } else {
            Logger.info(TAG, 'downloadPackage--copyInnerBundlePath exist')
          }

          const destPath = `${copyInnerBundlePath}/${expectedBundleFileName}`
          Logger.info(TAG, 'downloadPackage--copyInnerBundlePath：' + copyInnerBundlePath)
          Logger.info(TAG, 'downloadPackage--destPath：' + destPath)

          if (!fs.accessSync(destPath)) {
            // 动态bundle，patch基础包，需要从沙盒中获取
            if (!CodePushUtils.rawfileExists(this.context, expectedBundleFileName)) {
              try {
                const basePackageHash = this.getCurrentPackageInfo()[CodePushConstants.PACKAGE_BASE_HASH_KEY]
                Logger.info(TAG, 'downloadPackage--basePackageHash：' + basePackageHash)
                const dynamicBundleSandboxPath = `${this.getPackageFolderPath(basePackageHash)}/${CodePushConstants.RELATIVE_BUNDLE_FOLDER_NAME}`
                Logger.info(TAG, 'downloadPackage--copyInnerBundlePath：' + copyInnerBundlePath)
                Logger.info(TAG, 'downloadPackage--dnnamicBundleSandboxPath：' + dynamicBundleSandboxPath)
                const r = FileUtils.copyEntriesInFolder(dynamicBundleSandboxPath, copyInnerBundlePath, {
                  conflict: CopyConflictMode.OVERWRITE,
                  stopOnError: false,
                })
                Logger.info(TAG, 'downloadPackage--copyEntriesInFolder：' + `copied ${r.copiedFiles}/${r.totalFiles} files, failed=${r.failed.length}`)
                if (r.failed.length > 0) {
                  Logger.info(TAG, 'downloadPackage--copyEntriesInFolder：' + 'failed entries:')
                  return {jsBundlePath}
                }
              } catch (e) {
                Logger.info(TAG, 'downloadPackage--copyEntriesInFolder：' + `copyEntriesInFolder fatal: ${JSON.stringify(e)}`)
                return {jsBundlePath}
              }
            } else {
              Logger.info(TAG, 'downloadPackage--copyRawfileToSandbox：' + '111')
              await CodePushUtils.copyRawfileToSandbox(this.context, expectedBundleFileName, destPath)
              Logger.info(TAG, 'downloadPackage--copyRawfileToSandbox：' + '222')
            }
          }
        }

        if (FileUtils.fileAtPathExists(unzippedFolderPath)) {
          FileUtils.deleteDirectoryAtPath(unzippedFolderPath)
        }

        if (!FileUtils.fileAtPathExists(unzippedFolderPath)) {
          fs.mkdirSync(unzippedFolderPath, true)
          Logger.info(TAG, 'downloadPackage--unzippedFolderPath：' + unzippedFolderPath)
        }

        Logger.info(TAG, 'downloadPackage--copyInnerBundlePath：' + copyInnerBundlePath)
        Logger.info(TAG, 'downloadPackage--downloadFile：' + downloadFile)
        Logger.info(TAG, 'downloadPackage--unzippedFolderPath：' + unzippedFolderPath)

        // hpatch处理多线程竞争问题，添加互斥锁
        const result = await this.runHpatchPatchExclusive(copyInnerBundlePath, downloadFile, unzippedFolderPath)
        Logger.info(TAG, 'downloadPackage--result：' + result)

        if (result === CodePushConstants.HPATCHZ_SUCCESS) {
          // patch后，需要做 hash校验
          Logger.info(TAG, 'downloadPackage--newUpdateHash：' + newUpdateHash)
          const isOk = await CodePushUpdateVerifyHash.verifyFolderHash(unzippedFolderPath, newUpdateHash)
          if (!isOk) {
            Logger.info(TAG, 'downloadPackage--verifyFolderHash：' + 'The update contents failed the data integrity check.')
            return {jsBundlePath}
          } else {
            Logger.info(TAG, 'downloadPackage--verifyFolderHash：' + 'The update contents succeeded the data integrity check..')
          }
        } else {
          // patch失败，走下载全量包逻辑
          remotePackage[CodePushConstants.RollbackFullBundleUpdatePackage] = true
          return await this.downloadAndUnzip(tag, httpClient, remotePackage as any, expectedBundleFileName, baselineTotal, baselineReceive, progressCallback)
        }

        // Logger.info(TAG, 'downloadPackage--isZip moveFile=')
        // FileUtils.moveFile(
        //   downloadFile,
        //   packageFolderPath,
        //   expectedBundleFileName,
        // )
      }

      FileUtils.deleteDirectoryAtPath(downloadFile)

      if (FileUtils.fileAtPathExists(unzippedFolderPath)) {
        try {
          const r = FileUtils.copyEntriesInFolder(unzippedFolderPath, packageFolderPath, {
            conflict: CopyConflictMode.OVERWRITE,
            stopOnError: false,
          })
          Logger.info(TAG, 'downloadPackage--copyEntriesInFolder：' + `copied ${r.copiedFiles}/${r.totalFiles} files, failed=${r.failed.length}`)
          if (r.failed.length > 0) {
            Logger.info(TAG, 'downloadPackage--copyEntriesInFolder：' + 'failed entries:')
            return {jsBundlePath}
          }
        } catch (e) {
          Logger.info(TAG, 'downloadPackage--copyEntriesInFolder：' + `copyEntriesInFolder fatal: ${JSON.stringify(e)}`)
          return {jsBundlePath}
        }

        FileUtils.deleteDirectoryAtPath(unzippedFolderPath)
      }

      jsBundlePath = await CodePushUpdateUtils.findJSBundleInUpdateContents(
        packageFolderPath,
        expectedBundleFileName,
      )

      if (jsBundlePath) {
        remotePackage[CodePushConstants.RELATIVE_BUNDLE_PATH_KEY] = jsBundlePath
        Logger.info(TAG, 'bundlePath=' + jsBundlePath)
      }

      if (FileUtils.fileAtPathExists(packageMetadataPath)) {
        FileUtils.deleteDirectoryAtPath(packageMetadataPath)
      }

      CodePushUtils.writeJsonToFile(remotePackage, packageMetadataPath, tag)
    } else {
      Logger.info(TAG, '>>> data is empty or http request failed')
    }

    return {jsBundlePath}
  }


  /**
   * 拷贝基础包中的图片到热更新包目录下
   * @param baseBundleAssetDir
   * @param bundleAssetDir
   */
  private async copyDirNoOverwrite(baseBundleAssetDir: string, bundleAssetDir: string): Promise<void> {
    const entries = fs.listFileSync(baseBundleAssetDir, {recursion: true});

    for (const path of entries) {
      const filePath = path.charAt(0) === "/" ? path.substring(1, path.length) : path
      const srcPath = CodePushUtils.appendPathComponent(baseBundleAssetDir, filePath);
      const destPath = CodePushUtils.appendPathComponent(bundleAssetDir, filePath);
      const stat = await fs.stat(srcPath);
      log(`copyDirNoOverwrite: filePath=${filePath}, srcPath=${srcPath}, destPath=${destPath}, isDirectory=${stat.isDirectory()}`)
      if (stat.isFile() && !fs.accessSync(destPath, fs.AccessModeType.EXIST)) {
        const dirIndex = destPath.lastIndexOf('/');
        const destDir = dirIndex > 0 ? destPath.substring(0, dirIndex) : '';
        if (destDir && !fs.accessSync(destDir, fs.AccessModeType.EXIST)) {
          fs.mkdirSync(destDir, true)
        }
        fs.copyFileSync(srcPath, destPath, 0)
      } else {
        log(`copyDirNoOverwrite:not copy file, filePath=${filePath}, srcPath=${srcPath}, destPath=${destPath}`)
      }
    }
  }

  /**
   * 获取 JS Bundle 文件所在的目录
   * @param packageHash
   * @param expectedBundleFileName
   * @returns
   */
  private async getJSBundleFolderPath(packageHash: string, expectedBundleFileName: string): Promise<string> {
    const packageFolderPath = this.getPackageFolderPath(packageHash)
    const jsBundleRelativePath = await CodePushUpdateUtils.findJSBundleInUpdateContents(packageFolderPath, expectedBundleFileName)
    const jsBundleFullPath = CodePushUtils.appendPathComponent(packageFolderPath, jsBundleRelativePath)
    const parentUri = new fileUri.FileUri(jsBundleFullPath).getFullDirectoryUri()
    const jsBundleDir = new fileUri.FileUri(parentUri).path
    log(`getJSBundleFolderPath:jsBundleDir-${jsBundleDir}, packageHash=${packageHash}, expectedBundleFileName=${expectedBundleFileName}`)
    return jsBundleDir
  }


  public installPackage(
    updatePackage: Record<string, any>,
    removePendingUpdate: boolean,
  ): void {
    Logger.info(
      TAG,
      'installPackage--installPackage-entry1' + JSON.stringify(updatePackage),
    )
    Logger.info(
      TAG,
      'installPackage--installPackage-entry2' +
        CodePushConstants.PACKAGE_HASH_KEY,
    )
    let packageHash: string = updatePackage[CodePushConstants.PACKAGE_HASH_KEY]
    Logger.info(TAG, 'installPackage--packageHash=' + packageHash)

    let info = this.getCurrentPackageInfo()
    let currentPackageHash: string = info[CodePushConstants.CURRENT_PACKAGE_KEY]
    Logger.info(TAG, 'installPackage--currentPackageHash=' + currentPackageHash)
    if (packageHash != null && packageHash === currentPackageHash) {
      // The current package is already the one being installed, so we should no-op.
      return
    }

    if (removePendingUpdate) {
      let currentPackageFolderPath: string = this.getCurrentPackageFolderPath()
      Logger.info(
        TAG,
        'installPackage--removePendingUpdate-true=' + currentPackageFolderPath,
      )
      if (currentPackageFolderPath != null) {
        FileUtils.deleteDirectoryAtPath(currentPackageFolderPath)
      }
    } else {
      let previousPackageHash: string = this.getPreviousPackageHash()
      let basePackageHash: string = this.getBasePackageHash()
      Logger.info(
        TAG,
        'installPackage--removePendingUpdate-false=' + previousPackageHash,
      )
      if (
        previousPackageHash != null &&
        !(previousPackageHash === packageHash) && (!basePackageHash || basePackageHash !== previousPackageHash)
      ) {
        //base包不删除
        FileUtils.deleteDirectoryAtPath(
          this.getPackageFolderPath(previousPackageHash),
        )
      }
      info[CodePushConstants.PREVIOUS_PACKAGE_KEY] = currentPackageHash || basePackageHash || null
    }
    info['currentPackage'] = packageHash
    Logger.info(TAG, 'installPackage--newInfo=' + JSON.stringify(info))
    this.updateCurrentPackageInfo(info)
  }

  public setBasePackageHashToPrevious(basePackageHash: string) {
    if (!basePackageHash) {
      return
    }
    let info: object = this.getCurrentPackageInfo()
    let previous = info[CodePushConstants.PREVIOUS_PACKAGE_KEY]
    if (previous) {
      return
    }
    log(`setBasePackageHashToPrevious:basePackageHash=${basePackageHash}`)
    info[CodePushConstants.PREVIOUS_PACKAGE_KEY] = basePackageHash
    this.updateCurrentPackageInfo(info)
  }

  public rollbackPackage(): void {
    let info: object = this.getCurrentPackageInfo()
    let currentPackageFolderPath: string = this.getCurrentPackageFolderPath()
    FileUtils.deleteDirectoryAtPath(currentPackageFolderPath)
    FileUtils.deleteDirectoryAtPath(this.getStatusFilePath())
    info[CodePushConstants.CURRENT_PACKAGE_KEY] =
      info[CodePushConstants.PREVIOUS_PACKAGE_KEY]
    info[CodePushConstants.PREVIOUS_PACKAGE_KEY] = null
    this.updateCurrentPackageInfo(info)
  }

  public clearUpdates(): void {
    FileUtils.deleteDirectoryAtPath(this.getCodePushPath())
  }

  private async runHpatchPatchExclusive(
    oldPath: string,
    diffPath: string,
    newPath: string,
  ): Promise<number> {
    const enqueueAt = Date.now()
    try {
      return await HPATCH_GLOBAL_LOCK.runExclusive<number>(() => {
        const startAt = Date.now()
        Logger.info(TAG, `runHpatchPatchExclusive enter, waited=${startAt - enqueueAt}ms`)
        try {
          const r: number = hpatchz.patch(oldPath, diffPath, newPath)
          Logger.info(TAG, `runHpatchPatchExclusive done, result=${r}, cost=${Date.now() - startAt}ms`)
          return r
        } catch (err) {
          Logger.error(TAG, `runHpatchPatchExclusive hpatchz.patch threw: ${JSON.stringify(err)}`)
          return HPATCH_FAIL_CODE
        }
      })
    } catch (err) {
      Logger.error(TAG, `runHpatchPatchExclusive runExclusive threw: ${JSON.stringify(err)}`)
      return HPATCH_FAIL_CODE
    }
  }
}
