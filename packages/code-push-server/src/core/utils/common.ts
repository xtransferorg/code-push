/* eslint-disable no-cond-assign */
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream'
import util from 'util'
import extract from 'extract-zip'
import fsextra, { readdir, rename, rmdir, stat } from 'fs-extra'
import { Logger } from '../logger'
import _ from 'lodash'
import fetch from 'node-fetch'
import validator from 'validator'
import { AppError, ErrorCode } from '../app-error'
import { config } from '../config'
import recursiveReadDir from 'recursive-readdir'
import archiver from 'archiver'
import { BundlePlatformMapType, SystemType } from '@xrnjs/code-push-core'

const streamPipeline = util.promisify(pipeline)

export function parseVersion(versionNo: string) {
  let version = '0'
  let data = null
  if ((data = versionNo.match(/^([0-9]{1,3}).([0-9]{1,5}).([0-9]{1,10})$/))) {
    // "1.2.3"
    version =
      data[1] + _.padStart(data[2], 5, '0') + _.padStart(data[3], 10, '0')
  } else if ((data = versionNo.match(/^([0-9]{1,3}).([0-9]{1,5})$/))) {
    // "1.2"
    version = data[1] + _.padStart(data[2], 5, '0') + _.padStart('0', 10, '0')
  }
  return version
}

export function validatorVersion(versionNo: string) {
  let flag = false
  let min = '0'
  let max = '9999999999999999999'
  let data = null
  if (versionNo === '*') {
    // "*"
    flag = true
  } else if (
    (data = versionNo.match(/^([0-9]{1,3}).([0-9]{1,5}).([0-9]{1,10})$/))
  ) {
    // "1.2.3"
    flag = true
    min = data[1] + _.padStart(data[2], 5, '0') + _.padStart(data[3], 10, '0')
    max =
      data[1] +
      _.padStart(data[2], 5, '0') +
      _.padStart(`${parseInt(data[3], 10) + 1}`, 10, '0')
  } else if (
    (data = versionNo.match(/^([0-9]{1,3}).([0-9]{1,5})(\.\*){0,1}$/))
  ) {
    // "1.2" "1.2.*"
    flag = true
    min = data[1] + _.padStart(data[2], 5, '0') + _.padStart('0', 10, '0')
    max =
      data[1] +
      _.padStart(`${parseInt(data[2], 10) + 1}`, 5, '0') +
      _.padStart('0', 10, '0')
  } else if (
    (data = versionNo.match(/^~([0-9]{1,3}).([0-9]{1,5}).([0-9]{1,10})$/))
  ) {
    // "~1.2.3"
    flag = true
    min = data[1] + _.padStart(data[2], 5, '0') + _.padStart(data[3], 10, '0')
    max =
      data[1] +
      _.padStart(`${parseInt(data[2], 10) + 1}`, 5, '0') +
      _.padStart('0', 10, '0')
  } else if (
    (data = versionNo.match(/^\^([0-9]{1,3}).([0-9]{1,5}).([0-9]{1,10})$/))
  ) {
    // "^1.2.3"
    flag = true
    min = data[1] + _.padStart(data[2], 5, '0') + _.padStart(data[3], 10, '0')
    max =
      _.toString(parseInt(data[1], 10) + 1) +
      _.padStart('0', 5, '0') +
      _.padStart('0', 10, '0')
  } else if (
    (data = versionNo.match(
      /^([0-9]{1,3}).([0-9]{1,5}).([0-9]{1,10})\s?-\s?([0-9]{1,3}).([0-9]{1,5}).([0-9]{1,10})$/,
    ))
  ) {
    // "1.2.3 - 1.2.7"
    flag = true
    min = data[1] + _.padStart(data[2], 5, '0') + _.padStart(data[3], 10, '0')
    max =
      data[4] +
      _.padStart(data[5], 5, '0') +
      _.padStart(`${parseInt(data[6], 10) + 1}`, 10, '0')
  } else if (
    (data = versionNo.match(
      /^>=([0-9]{1,3}).([0-9]{1,5}).([0-9]{1,10})\s?<([0-9]{1,3}).([0-9]{1,5}).([0-9]{1,10})$/,
    ))
  ) {
    // ">=1.2.3 <1.2.7"
    flag = true
    min = data[1] + _.padStart(data[2], 5, '0') + _.padStart(data[3], 10, '0')
    max = data[4] + _.padStart(data[5], 5, '0') + _.padStart(data[6], 10, '0')
  }
  return [flag, min, max] as const
}

export async function createFileFromRequest(
  url: string,
  filePath: string,
  logger: Logger,
) {
  try {
    await fs.promises.stat(filePath)
    return
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err
    }
  }

  logger.debug(`createFileFromRequest url:${url}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new AppError(`unexpected response ${response.statusText}`)
  }
  await streamPipeline(response.body, fs.createWriteStream(filePath))
}

export function copySync(sourceDst: string, targertDst: string) {
  return fsextra.copySync(sourceDst, targertDst, { overwrite: true })
}

export function copy(sourceDst: string, targertDst: string) {
  return fsextra.copy(sourceDst, targertDst, { overwrite: true })
}

function deleteFolder(folderPath: string) {
  return fsextra.remove(folderPath)
}

export function deleteFolderSync(folderPath: string) {
  return fsextra.removeSync(folderPath)
}

export async function createEmptyFolder(folderPath: string) {
  await deleteFolder(folderPath)
  await fsextra.mkdirs(folderPath)
}

export function createEmptyFolderSync(folderPath: string) {
  deleteFolderSync(folderPath)
  fsextra.mkdirsSync(folderPath)
}

export async function unzipFile(
  zipFile: string,
  outputPath: string,
  logger: Logger,
) {
  try {
    logger.debug(`unzipFile check zipFile ${zipFile} fs.R_OK`)
    fs.accessSync(zipFile, fs.constants.R_OK)
    logger.debug(`Pass unzipFile file ${zipFile}`)
  } catch (err) {
    throw new AppError(err.message)
  }

  try {
    await extract(zipFile, { dir: outputPath })
    logger.debug(`unzipFile success`)
  } catch (err) {
    throw new AppError(`it's not a zipFile`)
  }
  return outputPath
}

export function getBlobDownloadUrl(blobUrl: string): string {
  let fileName = blobUrl
  const { storageType } = config.common
  const { downloadUrl } = config[storageType]
  if (storageType === 'local') {
    fileName = `${blobUrl.substring(0, 2).toLowerCase()}/${blobUrl}`
  }
  if (!validator.isURL(downloadUrl)) {
    throw new AppError(`Please config ${storageType}.downloadUrl in config.js`)
  }
  return `${downloadUrl}/${fileName}`
}

export function getInnerBlobDownloadUrl(blobUrl: string): string {
  let fileName = blobUrl
  const { storageType } = config.common
  const { innerDownloadUrl } = config[storageType]
  if (storageType === 'local') {
    fileName = `${blobUrl.substring(0, 2).toLowerCase()}/${blobUrl}`
  }
  if (!validator.isURL(innerDownloadUrl)) {
    throw new AppError(
      `Please config ${storageType}.innerDownloadUrl in config.js`,
    )
  }
  return `${innerDownloadUrl}/${fileName}`
}

export function diffCollectionsSync(
  collection1: Record<string, string>,
  collection2: Record<string, string>,
) {
  const diff: string[] = []
  const collection1Only: string[] = []
  const collection2Keys = new Set(Object.keys(collection2))
  if (collection1 instanceof Object) {
    const keys = Object.keys(collection1)
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]
      if (!collection2Keys.has(key)) {
        collection1Only.push(key)
      } else {
        collection2Keys.delete(key)
        if (!_.eq(collection1[key], collection2[key])) {
          diff.push(key)
        }
      }
    }
  }
  return {
    diff,
    collection1Only,
    collection2Only: Array.from(collection2Keys),
  }
}

export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function isFileExit(filePath: string) {
  try {
    return await fsextra.pathExists(filePath)
  } catch (err) {
    return false
  }
}

export async function findTargetPath(dirPath: string, target: string) {
  try {
    const files = await recursiveReadDir(dirPath)
    const filePath = files.find((file) => file.includes(target))
    return filePath
  } catch (e) {
    throw new AppError(`${target} is not exit. ${e.message}`)
  }
}

export function zipFolder(
  sourceDir: string,
  outputPath: string,
  options?: {
    compressionLevel?: number
    includeRoot?: boolean
  },
) {
  return new Promise((resolve, reject) => {
    // 参数校验（增强健壮性）
    if (!fs.existsSync(sourceDir)) {
      reject(new Error(`源文件夹不存在: ${sourceDir}`))
      return
    }
    if (path.extname(outputPath) !== '.zip') {
      reject(new Error('输出路径必须以 .zip 结尾'))
      return
    }

    // 配置合并
    const { compressionLevel = 9, includeRoot = false } = options || {}

    // 创建输出流
    const output = fs.createWriteStream(outputPath)
    const archive = archiver('zip', {
      zlib: { level: compressionLevel }, // 压缩级别
    })

    // 事件监听（完整错误处理链）
    output.on('close', () => resolve(outputPath))
    output.on('error', (err) => reject(new Error(`输出流错误: ${err.message}`)))
    archive.on('warning', (err) => console.warn('压缩警告:', err))
    archive.on('error', (err) => reject(new Error(`压缩失败: ${err.message}`)))

    // 管道连接
    archive.pipe(output)

    // 动态处理根目录
    const dirName = includeRoot ? path.basename(sourceDir) : ''
    archive.directory(sourceDir, dirName)

    // 执行压缩
    archive.finalize().catch(reject) // 捕获异步错误
  })
}

export async function removeParentFolder(folder: string, logger: Logger) {
  try {
    const items = await readdir(folder)
    if (items.length === 1) {
      const singleItemPath = path.join(folder, items[0])
      const singleItemStat = await stat(singleItemPath)
      if (singleItemStat.isDirectory()) {
        const subItems = await readdir(singleItemPath)
        for (const subItem of subItems) {
          const subPath = path.join(singleItemPath, subItem)
          const sub = await stat(subPath)
          if (sub.isDirectory()) {
            await rmdir(subPath, { recursive: true })
          } else {
            await rename(subPath, path.join(folder, subItem))
          }
        }
        await rmdir(singleItemPath, { recursive: true })
      }
    }
  } catch (err) {
    logger.error(`处理目录失败: ${err.message}`)
  }
}

export const BUNDLE_OS_TYPE_MAP = {
  [SystemType.IOS]: BundlePlatformMapType.IOS,
  [SystemType.ANDROID]: BundlePlatformMapType.ANDROID,
  [SystemType.HARMONY]: BundlePlatformMapType.HARMONY,
}

// 反向映射：从数字获取字符串
export const BUNDLE_OS_TYPE_REVERSE_MAP = {
  [BundlePlatformMapType.IOS]: SystemType.IOS,
  [BundlePlatformMapType.ANDROID]: SystemType.ANDROID,
  [BundlePlatformMapType.HARMONY]: SystemType.HARMONY,
}

export function getBundleOsType(os: SystemType) {
  const osType = BUNDLE_OS_TYPE_MAP[os as SystemType]
  if (!osType) {
    throw new AppError(`Invalid os type: ${os}`, ErrorCode.PARAMS_INVALID, 400)
  }
  return osType
}

export function getBundleOsTypeString(osType: BundlePlatformMapType) {
  const os = BUNDLE_OS_TYPE_REVERSE_MAP[osType as BundlePlatformMapType]
  if (!os) {
    throw new AppError(
      `Invalid os type number: ${osType}`,
      ErrorCode.PARAMS_INVALID,
      400,
    )
  }
  return os
}
