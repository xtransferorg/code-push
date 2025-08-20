/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import fs, { ListFileOptions } from '@ohos.file.fs'
import fileUri from '@ohos.file.fileuri'
import { BusinessError } from '@ohos.base'
import ArrayList from '@ohos.util.ArrayList'
import util from '@ohos.util'
import certFramework from '@ohos.security.cert'
import { CodePushUtils } from './CodePushUtils'
import { CodePushConstants } from './CodePushConstants'
import { CodePushUnknownException } from './CodePushUnknownException'
import { CodePushInvalidUpdateException } from './CodePushInvalidUpdateException'
import FileUtils from './FileUtils'
import Logger from './Logger'

const TAG = 'CodePushNativeModule-CodePushUpdateUtils: '

let listFileOption: ListFileOptions = {
  recursion: false,
  listNum: 0,
  filter: {
    suffix: ['.png', '.jpg', '.jpeg'],
    displayName: ['*abc', 'efg*'],
    fileSizeOver: 1024,
  },
}

export class CodePushUpdateUtils {
  // public static final String NEW_LINE = System.getProperty("line.separator");
  public static isHashIgnored(relativeFilePath: string) {
    const __MACOSX: string = '__MACOSX/'
    const DS_STORE: string = '.DS_Store'
    const CODEPUSH_METADATA: string = '.codepushrelease'

    return (
      relativeFilePath.startsWith(__MACOSX) ||
      this.equals(relativeFilePath, DS_STORE) ||
      relativeFilePath.endsWith('/' + DS_STORE) ||
      this.equals(relativeFilePath, CODEPUSH_METADATA) ||
      relativeFilePath.endsWith('/' + CODEPUSH_METADATA)
    )
  }

  public static getHashForBinaryContents(
    context,
    isDebugMode: boolean,
  ): string {
    Logger.info(
      TAG,
      `getHashForBinaryContents isDebugMode:${isDebugMode.toString()}`,
    )
    let filesDir = context.filesDir + '/'
    try {
      let file = fs.openSync(
        filesDir + CodePushConstants.CODE_PUSH_HASH_FILE_NAME,
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE,
      )
      Logger.info(TAG, `getHashForBinaryContents file1 path:${file.path}`)
      return CodePushUtils.getStringFromInputStream(file)
    } catch (e) {
      Logger.error(
        TAG,
        `getHashForBinaryContents file1 error:${JSON.stringify(e)}`,
      )
      try {
        let file = fs.openSync(
          filesDir + CodePushConstants.CODE_PUSH_OLD_HASH_FILE_NAME,
          fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE,
        )
        Logger.info(TAG, `getHashForBinaryContents file2 path:${file.path}`)
        return CodePushUtils.getStringFromInputStream(file)
      } catch (ex) {
        Logger.error(
          TAG,
          `getHashForBinaryContents file2 error:${JSON.stringify(ex)}`,
        )
        if (!isDebugMode) {
          // Only print this message in "Release" mode. In "Debug", we may not have the
          // hash if the build skips bundling the files.
          Logger.info(
            TAG,
            'Unable to get the hash of the binary\'s bundled resources - "codepush.gradle" may have not been added to the build definition.',
          )
        }
      }
      return ''
    }
  }

  private static addContentsOfFolderToManifest(
    folderPath: string,
    pathPrefix: string,
    manifest: ArrayList<string>,
  ) {
    fs.mkdir(folderPath)
      .then(() => {
        console.info('mkdir succeed')
        fs.listFile(
          folderPath,
          listFileOption,
          (err: BusinessError, filenames: Array<string>) => {
            if (err) {
              console.error(
                'list file failed with error message: ' +
                  err.message +
                  ', error code: ' +
                  err.code,
              )
            } else {
              console.info('listFile succeed')
              for (let i = 0; i < filenames.length; i++) {
                console.info('filename: %s', filenames[i])
                let fileName = filenames[i]
                // String fullFilePath = file.getAbsolutePath();
                let fullFilePath = new fileUri.FileUri(
                  '/' + filenames[i],
                ).getFullDirectoryUri()
                let relativePath =
                  (pathPrefix != '' ? '' : pathPrefix + '/') + fileName
                if (CodePushUpdateUtils.isHashIgnored(relativePath)) {
                  continue
                }
                if (fs.statSync(filenames[i]).isDirectory()) {
                  this.addContentsOfFolderToManifest(
                    fullFilePath,
                    relativePath,
                    manifest,
                  )
                } else {
                  try {
                    let inputStream: fs.Stream = fs.createStreamSync(
                      filenames[i],
                      'r+',
                    )
                    manifest.add(
                      relativePath + ':' + this.computeHash(inputStream),
                    )
                  } catch (e) {
                    // Should not happen.
                    throw new CodePushUnknownException(
                      'Unable to compute hash of update contents.',
                      e,
                    )
                  }
                }
              }
            }
          },
        )
      })
      .catch((err: BusinessError) => {
        console.error(
          'mkdir failed with error message: ' +
            err.message +
            ', error code: ' +
            err.code,
        )
      })
  }

  private static computeHash(dataStream: fs.Stream) {
    return ''
  }

  public static copyNecessaryFilesFromCurrentPackage(
    diffManifestFilePath: string,
    currentPackageFolderPath: string,
    newPackageFolderPath: string,
  ) {
    FileUtils.copyDirectoryContents(
      currentPackageFolderPath,
      newPackageFolderPath,
    )
    let diffManifest: Object =
      CodePushUtils.getJsonObjectFromFile(diffManifestFilePath)
    try {
      let deletedFiles: [] = diffManifest['deletedFiles']
      for (let i = 0; i < deletedFiles.length; i++) {
        let fileNameToDelete: string = deletedFiles[i]
        let filePath = newPackageFolderPath + fileNameToDelete
        fs.access(filePath)
          .then((res: boolean) => {
            if (res) {
              console.info('file exists')
              fs.unlink(filePath)
                .then(() => {
                  console.info('remove file succeed')
                })
                .catch((err: BusinessError) => {
                  console.error(
                    'remove file failed with error message: ' +
                      err.message +
                      ', error code: ' +
                      err.code,
                  )
                })
            } else {
              console.info('file not exists')
            }
          })
          .catch((err: BusinessError) => {
            console.error(
              'access failed with error message: ' +
                err.message +
                ', error code: ' +
                err.code,
            )
          })
      }
    } catch (e) {
      throw new CodePushUnknownException(
        'Unable to copy files from current package during diff update',
        e,
      )
    }
  }

  public static async findJSBundleInUpdateContents(
    folderPath: string,
    expectedFileName: string,
  ) {
    console.log('findJSBundleInUpdateContents-folderPath=' + folderPath)
    console.log(
      'findJSBundleInUpdateContents-expectedFileName=' + expectedFileName,
    )
    let filenames = fs.listFileSync(folderPath, {
      recursion: false,
    })
    console.log('findJSBundleInUpdateContents-filenames=' + filenames)
    for (let i = 0; i < filenames.length; i++) {
      const fullFilePath = CodePushUtils.join(folderPath, filenames[i])
      console.log('findJSBundleInUpdateContents-fullFilePath=' + fullFilePath)
      if (fs.statSync(fullFilePath).isDirectory()) {
        console.log(
          'findJSBundleInUpdateContents-fs.statSync(filenames[i]).isDirectory()',
        )
        let mainBundlePathInSubFolder = await this.findJSBundleInUpdateContents(
          fullFilePath,
          expectedFileName,
        )
        if (mainBundlePathInSubFolder) {
          let res = await CodePushUtils.appendPathComponent(
            filenames[i],
            mainBundlePathInSubFolder,
          )
          console.log('findJSBundleInUpdateContents-res=' + res)
          return res
        }
      } else {
        let fileName: string = filenames[i]
        if (this.equals(fileName, expectedFileName)) {
          return fileName
        }
      }
    }
    return ''
  }

  public static verifyFolderHash(folderPath: string, expectedHash: string) {
    CodePushUtils.log('Verifying hash for folder path: ' + folderPath)
    let updateContentsManifest: ArrayList<string> = new ArrayList()
    this.addContentsOfFolderToManifest(folderPath, '', updateContentsManifest)
    updateContentsManifest.sort()
    let updateContentsJSONArray: Object[] = []
    for (let manifestEntry in updateContentsManifest) {
      updateContentsJSONArray.push(manifestEntry)
    }
    // The JSON serialization turns path separators into "\/", e.g. "CodePush\/assets\/image.png"
    let updateContentsManifestString: string = updateContentsJSONArray
      .toString()
      .replace('\\/', '/')
    CodePushUtils.log('Manifest string: ' + updateContentsManifestString)

    let updateContentsManifestHash = ''
    CodePushUtils.log(
      'Expected hash: ' +
        expectedHash +
        ', actual hash: ' +
        updateContentsManifestHash,
    )
    if (!this.equals(expectedHash, updateContentsManifestHash)) {
      throw new CodePushInvalidUpdateException(
        'The update contents failed the data integrity check.',
      )
    }
    CodePushUtils.log('The update contents succeeded the data integrity check.')
  }

  public static verifyAndDecodeJWT(
    jwt: string,
    publicKey,
  ): Map<String, Object> {
    return null
  }

  public static async parsePublicKey(stringPublicKey: string): Promise<string> {
    try {
      let textEncoder = new util.TextEncoder()
      let that = new util.Base64Helper()
      //remove unnecessary "begin/end public key" entries from string
      stringPublicKey = stringPublicKey
        .replace('-----BEGIN PUBLIC KEY-----', '')
        .replace('-----END PUBLIC KEY-----', '')
        .replace('\n', '')
      let res = await that.encode(textEncoder.encodeInto(stringPublicKey))
      let encodingBlob: certFramework.EncodingBlob = {
        data: res,
        // 根据encodingData的格式进行赋值，支持FORMAT_PEM和FORMAT_DER
        encodingFormat: certFramework.EncodingFormat.FORMAT_PEM,
      }

      certFramework.createX509Cert(encodingBlob, (error, x509Cert) => {
        if (error != null) {
          console.error(
            'createX509Cert failed, errCode: ' +
              error.code +
              ', errMsg: ' +
              error.message,
          )
        } else {
          console.log('createX509Cert success')
          try {
            let pubKey = x509Cert.getPublicKey()
            return pubKey
          } catch (error) {
            let e: BusinessError = error as BusinessError
            console.error(
              'getPublicKey failed, errCode: ' +
                e.code +
                ', errMsg: ' +
                e.message,
            )
          }
        }
      })
    } catch (e) {
      CodePushUtils.log(e.message)
      return null
    }
  }

  public static getSignatureFilePath(updateFolderPath: string) {
    let res: string = CodePushUtils.appendPathComponent(
      updateFolderPath,
      CodePushConstants.CODE_PUSH_FOLDER_PREFIX,
    )
    return CodePushUtils.appendPathComponent(
      res,
      CodePushConstants.BUNDLE_JWT_FILE,
    )
  }

  public static getSignature(folderPath: string) {
    const signatureFilePath: string = this.getSignatureFilePath(folderPath)
    try {
      return FileUtils.readFileToString(signatureFilePath)
    } catch (e) {
      CodePushUtils.log(e.message)
      return null
    }
  }

  public static async verifyUpdateSignature(
    folderPath: string,
    packageHash: string,
    stringPublicKey: string,
  ) {
    CodePushUtils.log('Verifying signature for folder path: ' + folderPath)
    const publicKey: string = await this.parsePublicKey(stringPublicKey)
    if (publicKey == null) {
      throw new CodePushInvalidUpdateException(
        'The update could not be verified because no public key was found.',
      )
    }
    const signature: string = this.getSignature(folderPath)
    if (signature == null) {
      throw new CodePushInvalidUpdateException(
        'The update could not be verified because no signature was found.',
      )
    }
    const claims: Map<String, Object> = this.verifyAndDecodeJWT(
      signature,
      publicKey,
    )
    if (claims == null) {
      throw new CodePushInvalidUpdateException(
        'The update could not be verified because it was not signed by a trusted party.',
      )
    }
    const contentHash: string = claims['contentHash']
    if (contentHash == null) {
      throw new CodePushInvalidUpdateException(
        'The update could not be verified because the signature did not specify a content hash.',
      )
    }
    if (!this.equals(contentHash, packageHash)) {
      throw new CodePushInvalidUpdateException(
        'The update contents failed the code signing check.',
      )
    }

    CodePushUtils.log('The update contents succeeded the code signing check.')
  }

  private static equals(str1: string, str2: string) {
    return str1 === str2
  }

  private static stringToUint8Array(str: string): Uint8Array {
    let arr: Array<number> = []
    for (let i = 0, j = str.length; i < j; i++) {
      arr.push(str.charCodeAt(i))
    }
    return new Uint8Array(arr)
  }
}
