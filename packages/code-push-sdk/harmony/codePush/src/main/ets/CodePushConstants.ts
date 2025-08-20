/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

export class CodePushConstants {
  public static readonly ASSETS_BUNDLE_PREFIX: string = 'assets://'
  public static readonly BINARY_MODIFIED_TIME_KEY: string = 'binaryModifiedTime'
  public static readonly CODE_PUSH_FOLDER_PREFIX: string = 'CodePush'
  public static readonly CODE_PUSH_HASH_FILE_NAME: string = 'CodePushHash'
  public static readonly CODE_PUSH_OLD_HASH_FILE_NAME: string =
    'CodePushHash.json'
  public static readonly CODE_PUSH_PREFERENCES: string = 'CodePush'
  public static readonly CURRENT_PACKAGE_KEY: string = 'currentPackage'
  public static readonly DEFAULT_JS_BUNDLE_NAME: string = 'index.android.bundle'
  public static readonly DIFF_MANIFEST_FILE_NAME: string = 'hotcodepush.json'
  public static readonly DOWNLOAD_BUFFER_SIZE: number = 1024 * 256
  public static readonly DOWNLOAD_FILE_NAME: string = 'download.zip'
  public static readonly DOWNLOAD_PROGRESS_EVENT_NAME: string =
    'CodePushDownloadProgress'
  public static readonly DOWNLOAD_URL_KEY: string = 'downloadUrl'
  public static readonly FAILED_UPDATES_KEY: string = 'CODE_PUSH_FAILED_UPDATES'
  public static readonly PACKAGE_FILE_NAME: string = 'app.json'
  public static readonly PACKAGE_HASH_KEY: string = 'packageHash'
  public static readonly PENDING_UPDATE_HASH_KEY: string = 'hash'
  public static readonly PENDING_UPDATE_IS_LOADING_KEY: string = 'isLoading'
  public static readonly PENDING_UPDATE_KEY: string = 'CODE_PUSH_PENDING_UPDATE'
  public static readonly PREVIOUS_PACKAGE_KEY: string = 'previousPackage'
  public static readonly REACT_NATIVE_LOG_TAG: string = 'ReactNative'
  public static readonly RELATIVE_BUNDLE_PATH_KEY: string = 'bundlePath'
  public static readonly STATUS_FILE: string = 'codepush.json'
  public static readonly UNZIPPED_FOLDER_NAME: string = 'unzipped'
  public static readonly CODE_PUSH_APK_BUILD_TIME_KEY: string =
    'CODE_PUSH_APK_BUILD_TIME'
  public static readonly BUNDLE_JWT_FILE: string = '.codepushrelease'
  public static readonly LATEST_ROLLBACK_INFO_KEY: string =
    'LATEST_ROLLBACK_INFO'
  public static readonly LATEST_ROLLBACK_PACKAGE_HASH_KEY: string =
    'packageHash'
  public static readonly LATEST_ROLLBACK_TIME_KEY: string = 'time'
  public static readonly LATEST_ROLLBACK_COUNT_KEY: string = 'count'
  public static readonly CLIENT_UNIQUE_ID_KEY: string = 'clientUniqueId'
  public static readonly CODE_PUSH_DOCUMENT_DIRECTORY: string = 'CodePushSandBox'
}
