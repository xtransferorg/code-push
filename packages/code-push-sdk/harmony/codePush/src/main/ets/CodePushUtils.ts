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

const TAG = 'CodePushNativeModule-CodePushUtils: '

interface WritableMap {
  [key: string]: string | number | boolean | null | WritableMap | WritableMap[]
}

type File = fs.File

export class CodePushUtils {
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

  appendPathComponent() {}
}
