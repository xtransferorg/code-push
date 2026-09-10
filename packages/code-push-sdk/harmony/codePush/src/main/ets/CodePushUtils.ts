/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import fileio from '@ohos.fileio'
import buffer from '@ohos.buffer'
import { BusinessError } from '@ohos.base'
import { CodePushConstants } from './CodePushConstants'
import FileUtils from './FileUtils'
import { CodePushMalformedDataException } from './CodePushMalformedDataException'
import fs from '@ohos.file.fs'
import Logger from './Logger'
import { common } from '@kit.AbilityKit'
import { util } from '@kit.ArkTS'
import { CodePush } from './CodePush'
import { Configuration } from './nativeCodePush/NativeCodePushConfig'

const TAG = 'CodePushNativeModule-CodePushUtils: '

interface WritableMap {
  [key: string]: string | number | boolean | null | WritableMap | WritableMap[]
}

type File = fs.File

export class CodePushUtils {

  static getConfiguration(codePush: CodePush, clientUniqueId: string): Configuration {
    return {
      appVersion: codePush.getAppVersion(),
      clientUniqueId: clientUniqueId,
      deploymentKey: codePush.getDeploymentKey(),
      serverUrl: codePush?.getServerUrl(),
      commonHash: codePush?.getCommonHash()
    }
  }

  static writeJsonToFile(json: object, filePath: string, entry: string) {
    Logger.info(TAG, 'writeJsonToFile ' + entry + filePath)
    let jsonString = JSON.stringify(json)
    Logger.info(TAG, 'writeJsonToFile ' + entry + jsonString)
    FileUtils.writeStringToFile(jsonString, filePath)
  }

  static getJsonObjectFromFile(packageFilePath: string): Record<string, any> {
    let content = FileUtils.readFileToString(packageFilePath)
    Logger.info(
      TAG,
      'installPackage--getJsonObjectFromFile' + JSON.parse(content),
    )
    try {
      return JSON.parse(content)
    } catch (err) {
      Logger.error(TAG, `getJsonObjectFromFile--error=${JSON.stringify(err)}`)
      // Should not happen
      throw new CodePushMalformedDataException(packageFilePath, err)
    }
  }

  static appendPathComponent(
    folderPath: string,
    PACKAGE_FILE_NAME: string,
  ): string {
    if (folderPath.endsWith('/')) {
      return folderPath + PACKAGE_FILE_NAME
    } else {
      return folderPath + '/' + PACKAGE_FILE_NAME
    }
  }

  static join(...paths: string[]) {
    return paths.join('/').replace(/\/+/g, '/')
  }

  static getStringFromInputStream(file: File): string {
    let context
    Logger.info(TAG, `getStringFromInputStream file path:${file.path}`)
    try {
      context = fs.readTextSync(file.path)
      Logger.info(TAG, `getStringFromInputStream context:${context}`)
    } catch (error) {
      Logger.error(
        TAG,
        `getStringFromInputStream error:${JSON.stringify(error)}`,
      )
    }
    return context
  }

  static log(message: string): void {
    Logger.info(
      TAG,
      CodePushConstants.REACT_NATIVE_LOG_TAG + ' [CodePush] ' + message,
    )
  }

  static logBundleUrl(path: String): void {
    Logger.info(TAG, 'Loading JS bundle from "' + path + '"')
  }

  getStringFromInputStream(inputStream) {
    let fd = fileio.openSync(inputStream, 0o102, 0o640)
    let arrayBuffer = new ArrayBuffer(4096)
    fileio
      .read(fd, arrayBuffer)
      .then((readResult: fileio.ReadOut) => {
        Logger.info(TAG, 'read file data succeed')
        let buf = buffer.from(arrayBuffer, 0, readResult.bytesRead)
        Logger.info(TAG, `buf: ---${buf.toString()}`)
        fileio.closeSync(fd)
      })
      .catch((err: BusinessError) => {
        Logger.info(TAG, 'read file data failed with error:' + err)
      })
  }

  static rawfileExists(context: common.Context, name: string): boolean {
    try {
      const fd = context.resourceManager.getRawFdSync(name)
      if (fd) {
        try { context.resourceManager.closeRawFdSync(name) } catch (_) {}
        return true
      }
      return false
    } catch (_) {
      return false
    }
  }

  static readRawfileJson<T = Record<string, any>>(
    context: common.Context,
    name: string,
  ): T | null {
    if (!CodePushUtils.rawfileExists(context, name)) {
      return null
    }

    try {
      const bytes: Uint8Array = context.resourceManager.getRawFileContentSync(name)
      const text = util.TextDecoder.create('utf-8', { ignoreBOM: true }).decodeToString(bytes)
      return JSON.parse(text) as T
    } catch (e) {
      Logger.error(TAG, `readRawfileJson error, name=${name}, err=${JSON.stringify(e)}`)
      return null
    }
  }

  /*
   * 将App 内置文件拷贝到沙盒目录下
   * */
  static async copyRawfileToSandbox(
    context: common.Context,
    rawfileName: string,
    destPath: string,
  ): Promise<void> {

    // 1. 确保目标目录存在
    const dirEnd = destPath.lastIndexOf('/')
    if (dirEnd > 0) {
      const dir = destPath.substring(0, dirEnd)
      if (!fs.accessSync(dir)) {
        fs.mkdirSync(dir, true)   // 第二个参数 true = 递归创建
      }
    }

    // 2. 读出 rawfile 全部字节
    const bytes: Uint8Array = await context.resourceManager.getRawFileContent(rawfileName)
    // 3. 写到沙箱
    let file: fs.File | null = null

    try {
      file = fs.openSync(
        destPath,
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC,
      )
      const writeLen = fs.writeSync(file.fd, bytes.buffer)
      if (writeLen !== bytes.byteLength) {
        throw new Error(`partial write: expected=${bytes.byteLength}, actual=${writeLen}`)
      }
    } finally {
      if (file) {
        Logger.info(TAG, 'read file data succeed')
        try { fs.closeSync(file) } catch (_) {}
      }
    }

  }

  static convertString2NumberSafe(str: string, defaultValue: number): number {
    const n = Number(str)
    return Number.isFinite(n) ? n : defaultValue
  }

  appendPathComponent() {}
}
