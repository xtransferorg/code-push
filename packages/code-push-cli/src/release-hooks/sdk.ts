import {
  AccountManager,
  type AccountManager as AccountManagerType,
  type Package,
  type PackageInfo,
} from '@xrnjs/code-push-core'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as recursiveFs from 'recursive-fs'
import * as yazl from 'yazl'
import slash = require('slash')
import signForSdk = require('./signForSdk')
import { keysToCamelCase } from '../lib/object-utils'
import chalk = require('chalk')

class CodePushSdk {
  constructor(private readonly accountSdk: AccountManagerType) {}

  public async releasePackage(
    packagePath: string,
    privateKeyPath: string,
    appName: string,
    deploymentName: string,
    targetBinaryVersion: string,
    updateMetadata: PackageInfo,
    noDuplicateReleaseError?: boolean,
  ): Promise<Package> {
    try {
      // 1. 先对包进行签名
      console.log('正在对包进行签名...')
      const signedPackagePath = await signForSdk(privateKeyPath, packagePath)
      console.log(`签名完成，签名后的包路径: ${signedPackagePath}`)

      // 2. 准备发布文件列表
      const releaseFiles: { sourceLocation: string; targetLocation: string }[] =
        []

      if (!fs.lstatSync(signedPackagePath).isDirectory()) {
        releaseFiles.push({
          sourceLocation: signedPackagePath,
          targetLocation: path.basename(signedPackagePath),
        })
      } else {
        const directoryPath = signedPackagePath
        const baseDirectoryPath = path.join(directoryPath, '..')

        const { files } = await recursiveFs.read(signedPackagePath)
        files.forEach((filePath: string) => {
          const relativePath = slash(path.relative(baseDirectoryPath, filePath))
          releaseFiles.push({
            sourceLocation: filePath,
            targetLocation: relativePath,
          })
        })
      }

      // 3. 创建压缩包
      console.log('正在创建压缩包...')
      const zipPath = await this.createZipPackage(releaseFiles)
      console.log(`压缩包创建完成: ${zipPath}`)

      // 4. 调用 SDK 的 release 方法进行发布
      console.log('正在发布包...')
      const result = await this.accountSdk
        .release(
          appName,
          deploymentName,
          zipPath,
          targetBinaryVersion,
          updateMetadata,
        )
        .catch((e) => {
          if (
            noDuplicateReleaseError &&
            e.statusCode === AccountManager.ERROR_CONFLICT
          ) {
            console.warn(chalk.yellow('[Warning] ' + e.message))
            return
          }

          throw e
        })

      console.log('发布完成!')
      // 将服务端返回的字段转换为小驼峰形式
      return keysToCamelCase<Package>({ ...result, packagePath: zipPath })
    } catch (error) {
      console.error('发布过程中出现错误:', error)
      throw error
    }
  }

  private async createZipPackage(
    releaseFiles: { sourceLocation: string; targetLocation: string }[],
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const zipPath = path.join(
        os.tmpdir(),
        this.generateRandomFilename(15) + '.zip',
      )

      const zipFile = new yazl.ZipFile()
      const writeStream: fs.WriteStream = fs.createWriteStream(zipPath)

      zipFile.outputStream
        .pipe(writeStream)
        .on('error', (error: Error): void => {
          reject(error)
        })
        .on('close', (): void => {
          resolve(zipPath)
        })

      releaseFiles.forEach((releaseFile) => {
        zipFile.addFile(releaseFile.sourceLocation, releaseFile.targetLocation)
      })

      zipFile.end()
    })
  }

  private generateRandomFilename(length: number): string {
    let filename: string = ''
    const validChar: string =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

    for (let i = 0; i < length; i++) {
      filename += validChar.charAt(Math.floor(Math.random() * validChar.length))
    }

    return filename
  }
}

export default CodePushSdk
