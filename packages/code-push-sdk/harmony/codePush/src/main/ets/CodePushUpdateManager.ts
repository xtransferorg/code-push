/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import { CodePush } from './CodePush'
import { CodePushConstants } from './CodePushConstants'
import FileUtils from './FileUtils'
import fs from '@ohos.file.fs'
import zlib from '@ohos.zlib'
import { CodePushUtils } from './CodePushUtils'
import { CodePushUpdateUtils } from './CodePushUpdateUtils'
import http from '@ohos.net.http'

import common from '@ohos.app.ability.common'
import Logger from './Logger'
import { HttpClient } from '@rnoh/react-native-openharmony/src/main/ets/HttpClient/HttpClient'
import { ReceivingProgress } from '@rnoh/react-native-openharmony/src/main/ets/HttpClient/types'
import { getCurrentAppVersionName } from './Utils'

const TAG = 'CodePushNativeModule-CodePushUpdateManager: '

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
    private deploymentKey: string,
  ) {}

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
    let newUpdateHash = updatePackage[CodePushConstants.PACKAGE_HASH_KEY]
    let newUpdateFolderPath = this.getPackageFolderPath(newUpdateHash)
    Logger.info(
      TAG,
      'downloadPackage--newUpdateFolderPath=' + newUpdateFolderPath,
    )
    let newUpdateMetadataPath = CodePushUtils.appendPathComponent(
      newUpdateFolderPath,
      CodePushConstants.PACKAGE_FILE_NAME,
    )
    Logger.info(
      TAG,
      'downloadPackage--newUpdateMetadataPath=' + newUpdateMetadataPath,
    )
    if (FileUtils.fileAtPathExists(newUpdateFolderPath)) {
      FileUtils.deleteDirectoryAtPath(newUpdateFolderPath)
    }
    let downloadUrlString = updatePackage[CodePushConstants.DOWNLOAD_URL_KEY]
    let isZip: boolean = false
    let downloadFile: string = ''
    Logger.info(TAG, 'downloadPackage--downloadUrlString=' + downloadUrlString)
    // Download the file while checking if it is a zip and notifying client of progress.
    let onReceiveProgress = (receiveProgress: ReceivingProgress) => {
      progressCallback(
        Number(receiveProgress.totalLength),
        Number(receiveProgress.lengthReceived),
      )
    }
    const httpResponse = await httpClient.sendRequest(downloadUrlString, {
      method: http.RequestMethod.GET,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      connectTimeout: http.HttpProtocol.HTTP1_1,
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
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE,
      )
      let writeLen = fs.writeSync(file.fd, data)
      Logger.info(TAG, 'write data to file succeed and size is:' + writeLen)
      fs.closeSync(file)

      isZip = isArrayBufferZip(data)
      if (isZip) {
        Logger.info(TAG, 'downloadPackage--isZip entry')

        try {
          if (!fs.accessSync(newUpdateFolderPath)) {
            Logger.info(TAG, 'mkdirSync unzippedFolderPath not exist.')
            fs.mkdirSync(newUpdateFolderPath, true)
            Logger.info(TAG, 'mkdirSync unzippedFolderPath success. ')
          }
        } catch (error) {
          Logger.info(
            TAG,
            `mkdirSync unzippedFolderPath error,${JSON.stringify(error)}`,
          )
        }
        let options2: zlib.Options = {
          level: zlib.CompressLevel.COMPRESS_LEVEL_DEFAULT_COMPRESSION,
        }
        try {
          await zlib.decompressFile(downloadFile, newUpdateFolderPath, options2)
          Logger.info(TAG, 'decompressFile download success2. data')
          FileUtils.deleteDirectoryAtPath(downloadFile)
        } catch (error) {
          Logger.error(TAG, `errData is errCode:${JSON.stringify(error)}`)
        }
        const bundlePath =
          await CodePushUpdateUtils.findJSBundleInUpdateContents(
            newUpdateFolderPath,
            expectedBundleFileName,
          )
        Logger.info(TAG, 'bundlePath=' + bundlePath)
        updatePackage[CodePushConstants.RELATIVE_BUNDLE_PATH_KEY] = bundlePath
      } else {
        Logger.info(TAG, 'downloadPackage--isZip moveFile=')
        FileUtils.moveFile(
          downloadFile,
          newUpdateFolderPath,
          expectedBundleFileName,
        )
      }
      CodePushUtils.writeJsonToFile(
        updatePackage,
        newUpdateMetadataPath,
        'down',
      )
    } else {
      Logger.info(TAG, '>>> data is empty or http request failed')
    }
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
      Logger.info(
        TAG,
        'installPackage--removePendingUpdate-false=' + previousPackageHash,
      )
      if (
        previousPackageHash != null &&
        !(previousPackageHash === packageHash)
      ) {
        FileUtils.deleteDirectoryAtPath(
          this.getPackageFolderPath(previousPackageHash),
        )
      }
      info[CodePushConstants.PREVIOUS_PACKAGE_KEY] = currentPackageHash || null
    }
    info['currentPackage'] = packageHash
    Logger.info(TAG, 'installPackage--newInfo=' + JSON.stringify(info))
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
}
