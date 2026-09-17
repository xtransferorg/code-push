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

export enum CopyConflictMode {
  FAIL = 0,        // 冲突就报错
  OVERWRITE = 1,   // 冲突时覆盖（推荐）
  SKIP = 2,        // 冲突时跳过
}
/**
 * 把 srcDir 下的所有内容（文件 + 子目录，递归）复制到 destDir 下。
 *
 * 例：
 *   srcDir  = /data/.../unzipped
 *   destDir = /data/.../3a0b9b626...
 *   结果：destDir 下出现 release_harmony/oh.xt-app-main.bundle 等
 *
 * 健壮性保证：
 *  - srcDir 不存在 / 不是目录 → 抛错（明确报）
 *  - destDir 不存在 → 自动递归创建
 *  - srcDir === destDir 或 destDir 是 srcDir 的子目录 → 拒绝执行，避免无限递归
 *  - 单个文件复制失败默认不会中断整体（除非 stopOnError=true）
 *  - 全过程不静默吞异常，每个失败都会 Logger 记录
 */
export interface CopyDirContentsOptions {
  conflict?: CopyConflictMode    // 默认 OVERWRITE
  stopOnError?: boolean          // 单文件失败是否立刻终止，默认 false（尽量复制完）
}
export interface CopyDirContentsResult {
  totalFiles: number
  copiedFiles: number
  totalDirs: number
  createdDirs: number
  failed: Array<{ src: string; dest: string; err: string }>
}

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
    console.log(`[Preload]-FileUtils.deleteDirectoryAtPath:directoryPath=${directoryPath}`)
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

  static copyEntriesInFolder(
    srcDir: string,
    destDir: string,
    options: CopyDirContentsOptions = {},
  ): CopyDirContentsResult {
    const conflict = options.conflict ?? CopyConflictMode.OVERWRITE
    const stopOnError = options.stopOnError ?? false
    const result: CopyDirContentsResult = {
      totalFiles: 0, copiedFiles: 0,
      totalDirs: 0,  createdDirs: 0,
      failed: [],
    }
    // 1. 入参校验
    if (!srcDir || !destDir) {
      throw new Error(`copyDirContents: invalid args, srcDir=${srcDir}, destDir=${destDir}`)
    }
    // 规范化路径，去掉尾部 '/'，方便后续比较
    const src = srcDir.endsWith('/') ? srcDir.slice(0, -1) : srcDir
    const dest = destDir.endsWith('/') ? destDir.slice(0, -1) : destDir
    if (!fs.accessSync(src)) {
      throw new Error(`copyDirContents: srcDir not exist: ${src}`)
    }
    const srcStat = fs.statSync(src)
    if (!srcStat.isDirectory()) {
      throw new Error(`copyDirContents: srcDir is not a directory: ${src}`)
    }
    // 自拷贝 / 父拷到子目录会造成无限递归，拒绝执行
    if (src === dest || dest.startsWith(src + '/')) {
      throw new Error(`copyDirContents: dest is same as or inside src: src=${src}, dest=${dest}`)
    }
    // 2. 目标目录不存在就建
    if (!fs.accessSync(dest)) {
      try {
        fs.mkdirSync(dest, true)
        result.createdDirs++
      } catch (e) {
        throw new Error(`copyDirContents: mkdir dest failed: ${dest}, err=${JSON.stringify(e)}`)
      }
    } else {
      if (!fs.statSync(dest).isDirectory()) {
        throw new Error(`copyDirContents: dest exists but is not a directory: ${dest}`)
      }
    }
    // 3. 递归内部函数
    const walk = (curSrc: string, curDest: string): boolean => {
      let entries: string[]
      try {
        entries = fs.listFileSync(curSrc, { recursion: false, listNum: 0 })
      } catch (e) {
        result.failed.push({ src: curSrc, dest: curDest, err: `listFile: ${JSON.stringify(e)}` })
        Logger.error(TAG, `copyDirContents listFile failed: ${curSrc}, ${JSON.stringify(e)}`)
        return !stopOnError
      }
      for (const name of entries) {
        const s = `${curSrc}/${name}`
        const d = `${curDest}/${name}`
        let st: fs.Stat
        try {
          st = fs.statSync(s)
        } catch (e) {
          result.failed.push({ src: s, dest: d, err: `stat: ${JSON.stringify(e)}` })
          Logger.error(TAG, `copyDirContents stat failed: ${s}, ${JSON.stringify(e)}`)
          if (stopOnError) return false
          continue
        }
        if (st.isDirectory()) {
          result.totalDirs++
          try {
            if (!fs.accessSync(d)) {
              fs.mkdirSync(d, true)
              result.createdDirs++
            } else if (!fs.statSync(d).isDirectory()) {
              throw new Error(`dest exists but not a dir: ${d}`)
            }
          } catch (e) {
            result.failed.push({ src: s, dest: d, err: `mkdir: ${JSON.stringify(e)}` })
            Logger.error(TAG, `copyDirContents mkdir failed: ${d}, ${JSON.stringify(e)}`)
            if (stopOnError) return false
            continue
          }
          if (!walk(s, d) && stopOnError) return false
        } else if (st.isFile()) {
          result.totalFiles++
          try {
            if (fs.accessSync(d)) {
              if (conflict === CopyConflictMode.SKIP) {
                Logger.info(TAG, `copyDirContents skip existing: ${d}`)
                continue
              }
              if (conflict === CopyConflictMode.FAIL) {
                throw new Error(`dest file already exists: ${d}`)
              }
              // OVERWRITE: copyFileSync 默认会覆盖
            }
            fs.copyFileSync(s, d, 0)
            result.copiedFiles++
          } catch (e) {
            result.failed.push({ src: s, dest: d, err: `copyFile: ${JSON.stringify(e)}` })
            Logger.error(TAG, `copyDirContents copyFile failed: ${s} -> ${d}, ${JSON.stringify(e)}`)
            if (stopOnError) return false
          }
        } else {
          Logger.info(TAG, `copyDirContents skip non-regular entry: ${s}`)
        }
      }
      return true
    }
    walk(src, dest)
    Logger.info(
      TAG,
      `copyDirContents done: dirs=${result.createdDirs}/${result.totalDirs}, ` +
        `files=${result.copiedFiles}/${result.totalFiles}, failed=${result.failed.length}`,
    )
    return result
  }
}
