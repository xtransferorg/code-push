/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import fs, { Options, Filter, ListFileOptions } from '@ohos.file.fs'
import { BusinessError } from '@ohos.base'
import zlib from '@ohos.zlib'
import { CodePushUtils } from './CodePushUtils'
import { CodePushUnknownException } from './CodePushUnknownException'
import Logger from './Logger'

const TAG = 'CodePushNativeModule-FileUtils: '

export default class FileUtils {
  // 将源路径下的目录内容复制到目标路径
  static copyDirectoryContents(
    currentPackageFolderPath: string,
    newPackageFolderPath: string,
  ) {
    if (!fs.accessSync(currentPackageFolderPath)) {
      return
    }
    if (!fs.accessSync(newPackageFolderPath)) {
      fs.mkdirSync(newPackageFolderPath, true)
    }
    let isDirectory = fs.statSync(currentPackageFolderPath).isDirectory()
    Logger.info(
      TAG,
      `copyDirectoryContents isDirectory=${isDirectory.toString()}`,
    )
    let listFileOption: ListFileOptions = {
      recursion: false,
      listNum: 0,
      filter: {
        suffix: ['.png', '.jpg', '.jpeg'],
        displayName: ['*abc', 'efg*'],
        fileSizeOver: 1024,
      },
    }
    // 如果是目录
    if (isDirectory) {
      let filenames = fs.listFileSync(currentPackageFolderPath, listFileOption)
      Logger.info(
        TAG,
        `copyDirectoryContents filenames=${JSON.stringify(filenames)}`,
      )
      for (let i = 0; i < filenames.length; i++) {
        Logger.info(TAG, `copyDirectoryContents filename: ${filenames[i]}`)
        fs.copyFileSync(
          CodePushUtils.appendPathComponent(
            currentPackageFolderPath,
            filenames[i],
          ),
          CodePushUtils.appendPathComponent(newPackageFolderPath, filenames[i]),
        )
      }
    } else {
      //是文件
      Logger.info(TAG, `Down copyDirectoryContents entry2`)
      fs.copyFileSync(currentPackageFolderPath, newPackageFolderPath)
    }
  }
  //将原路径下的所有文件夹复制到另一个文件夹下
  static copyDirectoryAll(currentPath: string, newPath: string) {
    let listFileOption: ListFileOptions = {
      recursion: false,
      listNum: 0,
    }
    try {
      let filenames = fs.listFileSync(currentPath, listFileOption)
      Logger.info(
        TAG,
        `copyDirectoryAll--filenames:${JSON.stringify(filenames)}`,
      )
      for (let i = 0; i < filenames.length; i++) {
        const srcEntryPath = `${currentPath}/${filenames[i]}`
        fs.copyDirSync(srcEntryPath, newPath, 1)
      }
    } catch (error) {
      Logger.info(TAG, `copyDirectoryAll--error:${error}`)
    }
  }
  //删除指定路径下的目录。
  static deleteDirectoryAtPath(directoryPath: string): void {
    if (directoryPath == null) {
      Logger.info(
        TAG,
        'deleteDirectoryAtPath attempted with null directoryPath',
      )
      return
    }
    if (fs.accessSync(directoryPath)) {
      // 删除整个目录
      if (fs.statSync(directoryPath).isDirectory()) {
        fs.rmdirSync(directoryPath)
      } else {
        //  删除单个文件
        fs.unlinkSync(directoryPath)
      }
    } else {
      return
    }
  }

  //检查指定路径下是否存在文件
  public static fileAtPathExists(pathfile: string): boolean {
    try {
      let res = fs.accessSync(pathfile)
      if (res) {
        Logger.info(TAG, 'file exists')
        return true
      } else {
        Logger.info(TAG, 'file not exists')
        return false
      }
    } catch (error) {
      let err: BusinessError = error as BusinessError
      Logger.error(
        TAG,
        'accessSync failed with error message: ' +
          err.message +
          ', error code: ' +
          err.code,
      )
    }
  }

  // 读取文件内容并以字符串形式返回。
  public static readFileToString(packageFilePath: string): string {
    let filePath = packageFilePath
    let str = fs.readTextSync(filePath)
    Logger.info(TAG, 'installPackage--readFileToString' + str)
    let options: Options = {
      encoding: 'utf-8',
    }
    let readerIterator = fs.readLinesSync(filePath, options)
    let str_file = ''
    for (let it = readerIterator.next(); !it.done; it = readerIterator.next()) {
      Logger.info(TAG, 'content: ' + it.value)
      str_file += it.value
    }
    Logger.info(TAG, 'content: str_file=' + str_file)
    return str_file
  }

  //将zip文件解压到指定目标文件夹。 备注：原方法直接传入的是文件，此处传入文件路径
  public static unzipFile(inFile: string, outFileDir: string): void {
    try {
      zlib.decompressFile(inFile, outFileDir, (errData: BusinessError) => {
        if (errData !== null) {
          Logger.error(
            TAG,
            `decompressFile failed. code is ${errData.code}, message is ${errData.message}`,
          )
        }
      })
    } catch (errData) {
      let code = (errData as BusinessError).code
      let message = (errData as BusinessError).message
      Logger.error(
        TAG,
        `decompressFile failed. code is ${code}, message is ${message}`,
      )
    }
  }

  //将字符串写入到指定路径的文件中。
  public static writeStringToFile(content: string, filePath: string): void {
    let file = fs.openSync(
      filePath,
      fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE,
    )
    let writeLen = fs.writeSync(file.fd, content)
    Logger.info(TAG, 'write data to file succeed and size is:' + writeLen)
    fs.closeSync(file)
  }

  //将文件移动到新文件夹并指定新文件名。
  static moveFile(
    fileToMove: string,
    newFolderPath: string,
    newFileName: string,
  ): void {
    Logger.info(TAG, 'downloadPackage---entry moveFile-fileToMove' + fileToMove)
    Logger.info(
      TAG,
      'downloadPackage---entry moveFile-newFolderPath' + newFolderPath,
    )
    Logger.info(
      TAG,
      'downloadPackage---entry moveFile-newFileName' + newFileName,
    )
    let filePath = fileToMove
    try {
      let res = fs.accessSync(filePath)
      if (!res) {
        Logger.info(TAG, 'downloadPackage-file not exists')
      }
    } catch (error) {
      let err: BusinessError = error as BusinessError
      Logger.error(
        TAG,
        'downloadPackage-accessSync failed with error message: ' +
          err.message +
          ', error code: ' +
          err.code,
      )
    }
    fs.mkdirSync(newFolderPath, true)
    let newDownloadFile = fs.openSync(
      newFolderPath + newFileName,
      fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE,
    )
    fs.closeSync(newDownloadFile)
    if (!fs.accessSync(filePath)) {
      Logger.info(TAG, 'downloadPackage-文件不存在')
    }
  }
}
