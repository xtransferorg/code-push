// @ts-nocheck
import * as fs from 'fs'
import * as path from 'path'
import * as recursiveFs from 'recursive-fs'
import * as yazl from 'yazl'
import slash = require('slash')
import superagent = require('superagent')
import BaseSdk = require('./base-sdk')
import {
  BaseLineFileType,
  BaselineMeta,
  BaselineDownloadModel,
  BaselineUploadedResponse,
  NativeAppType,
  DynamicBaselineMeta,
} from './types'

const BASELINE_DIR_NAME = 'baselineTemp'

interface PackageFile {
  isTemporary: boolean
  path: string
}

class BaselineSdk extends BaseSdk {
  constructor(serverUrl: string, accessKey: string) {
    super(serverUrl, accessKey)
  }

  /**
   * 上传基线包：读取指定文件夹，打包成zip，发送到服务器
   * @param folderPath 文件夹路径
   * @param uploadProgressCallback 上传进度回调
   * @returns Promise
   */
  public uploadBaseline(
    folderPath: string,
    meta: BaselineMeta,
    replaceDirName: boolean = true,
    uploadProgressCallback?: (progress: number) => void,
  ): Promise<BaselineDownloadModel> {
    return new Promise<BaselineDownloadModel>((resolve, reject) => {
      // 检查路径是否存在且为文件夹
      if (!fs.existsSync(folderPath)) {
        reject(new Error(`文件夹路径不存在: ${folderPath}`))
        return
      }

      if (!fs.lstatSync(folderPath).isDirectory()) {
        reject(new Error(`指定路径不是文件夹: ${folderPath}`))
        return
      }

      // 打包文件夹
      this.packageFolderToZip(folderPath, replaceDirName)
        .then((packageFile: PackageFile) => {
          // 上传到服务器
          this.uploadPackageToServer(packageFile, meta, uploadProgressCallback)
            .then((result) => {
              resolve(result)
            })
            .catch((error) => {
              reject(error)
            })
        })
        .catch((error) => {
          reject(error)
        })
    })
  }

  public getBundleInfo({
    bundleName,
    platform,
    env,
    buildType,
  }: {
    bundleName: string
    platform: string
    env: string
    buildType: NativeAppType
  }): Promise<{
    bundleName: string
    codePushName: string
    deploymentKey: string
    isAvailable: boolean
    deliveryType: string
  }> {
    return this._post('/apps/getBundleInfo', {
      bundleName,
      platform,
      env,
      buildType,
    })
  }

  /**
   * 将文件夹打包成zip文件
   * @param folderPath 文件夹路径
   * @returns Promise<PackageFile>
   */
  private packageFolderToZip(
    folderPath: string,
    replaceDirName = true,
  ): Promise<PackageFile> {
    return new Promise<PackageFile>((resolve, reject) => {
      recursiveFs.readdirr(
        folderPath,
        (error?: any, directories?: string[], files?: string[]): void => {
          if (error) {
            reject(error)
            return
          }

          const baseDirectoryPath = path.dirname(folderPath)
          const fileName = this.generateRandomFilename(15) + '.zip'
          const zipFile = new yazl.ZipFile()
          const writeStream = fs.createWriteStream(fileName)

          zipFile.outputStream
            .pipe(writeStream)
            .on('error', (error: Error): void => {
              reject(error)
            })
            .on('close', (): void => {
              const zipFilePath = path.join(process.cwd(), fileName)
              resolve({ isTemporary: true, path: zipFilePath })
            })

          // 添加所有文件到zip
          for (let i = 0; i < files.length; ++i) {
            const file = files[i]
            let relativePath = path.relative(baseDirectoryPath, file)

            // 替换文件夹名，传入的文件夹不固定，可能是3.6.12，全部改成 BASELINE_DIR_NAME
            if (replaceDirName) {
              const folderName = path.basename(folderPath)
              if (relativePath.startsWith(folderName)) {
                relativePath = relativePath.replace(
                  folderName,
                  BASELINE_DIR_NAME,
                )
              }
            }

            console.log(replaceDirName, relativePath)

            // yazl不支持反斜杠，需要转换为正斜杠
            relativePath = slash(relativePath)

            zipFile.addFile(file, relativePath)
          }

          zipFile.end()
        },
      )
    })
  }

  /**
   * 上传包文件到服务器
   * @param packageFile 包文件信息
   * @param uploadProgressCallback 上传进度回调
   * @returns Promise
   */
  private uploadPackageToServer(
    packageFile: PackageFile,
    meta: BaselineMeta,
    uploadProgressCallback?: (progress: number) => void,
  ): Promise<BaselineUploadedResponse> {
    return new Promise<BaselineUploadedResponse>((resolve, reject) => {
      // 使用URL构造函数来确保URL正确构造
      const url = new URL('/xrn/baseline/create', this._serverUrl).toString()
      const request = superagent.post(url)

      // 设置认证头
      request.set('Authorization', `Bearer ${this._accessKey}`)

      const file = fs.createReadStream(packageFile.path)

      request
        .attach('package', file)
        .field('meta', JSON.stringify(meta))
        .on('progress', (event: any) => {
          if (uploadProgressCallback && event && event.total > 0) {
            const currentProgress = (event.loaded / event.total) * 100
            uploadProgressCallback(currentProgress)
          }
        })
        .end((err: any, res: superagent.Response) => {
          if (err) {
            reject(this._handleError(err))
            return
          }
          if (res.ok) {
            resolve(res.body?.data || [])
          } else {
            reject(
              this._handleError(err || { response: res, status: res.status }),
            )
          }
        })
    })
  }

  /**
   * 获取基线下载信息
   * @param params 查询参数
   * @returns Promise
   */
  getBaselineDownloadInfo(params: {
    platform: string
    version_name: string
    app_type: NativeAppType
    file_type?: BaseLineFileType
  }): Promise<BaselineDownloadModel> {
    const { platform, version_name, app_type, file_type } = params

    // 构建查询参数
    const queryParams: Record<string, string> = {
      platform,
      version_name,
      app_type,
    }

    if (file_type) {
      queryParams.file_type = file_type
    }

    return this._get<BaselineDownloadModel>('/xrn/baseline/find', queryParams)
  }

  public async checkFirstCodepush(
    bundleName: string,
    appVersion: string,
    buildType: string = 'release',
  ): Promise<boolean> {
    return this._post<boolean>('/apps/check_first_codepush', {
      bundleName,
      appVersion,
      buildType,
    })
  }

  /**
   * 生成随机文件名
   * @param length 文件名长度
   * @returns 随机文件名
   */
  private generateRandomFilename(length: number): string {
    let filename = ''
    const validChar =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

    for (let i = 0; i < length; i++) {
      filename += validChar.charAt(Math.floor(Math.random() * validChar.length))
    }

    return filename
  }
}

export = BaselineSdk
