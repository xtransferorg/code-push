/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import { CodePushConstants } from './CodePushConstants'
import dataPreferences from '@ohos.data.preferences'
import { BusinessError } from '@ohos.base'
import { CodePushUnknownException } from './CodePushUnknownException'
import { CodePushMalformedDataException } from './CodePushMalformedDataException'
import common from '@ohos.app.ability.common'
import Logger from './Logger'
import { log } from './nativeCodePush/Logging'

const TAG = 'CodePushNativeModule-SettingsManager: '

export class SettingsManager {
  private preferences: dataPreferences.Preferences | null = null

  private bundleName: string = ""

  constructor(private context: common.UIAbilityContext, bundleName:string, deploymentKey: string) {
    console.log(`[Preload]-SettingsManager.constructor:deploymentKey=${deploymentKey}`)
    this.init(bundleName, deploymentKey)
  }

  private init(bundleName: string, deploymentKey: string) {
    console.log(`[Preload]-SettingsManager.init:deploymentKey=${deploymentKey}, this.preferences=${this.preferences}`)
    this.bundleName = bundleName
    if (deploymentKey && !this.preferences) {
      this.preferences = dataPreferences.getPreferencesSync(this.context, {
        name: deploymentKey + CodePushConstants.CODE_PUSH_PREFERENCES,
      })
    }
  }

  public setBundleInfo(bundleName: string, deploymentKey: string) {
    this.init(bundleName, deploymentKey)
  }

  public getFailedUpdates(): Array<Record<string, any>> {
    Logger.info(TAG, 'isFailedHash--getFailedUpdates entry')
    let failedUpdatesString = this.preferences.getSync(
      CodePushConstants.FAILED_UPDATES_KEY,
      null,
    ) as string
    Logger.info(
      TAG,
      `isFailedHash--getFailedUpdates failedUpdatesString=${failedUpdatesString}`,
    )
    if (!failedUpdatesString) {
      return new Array()
    }
    try {
      return JSON.parse(failedUpdatesString)
    } catch (e) {
      Logger.info(
        TAG,
        `isFailedHash--getFailedUpdates catch,${JSON.stringify(e)}`,
      )
      // Unrecognized data format, clear and replace with expected format.
      const emptyArray: Array<Record<string, any>> = new Array()
      this.preferences.putSync(
        CodePushConstants.FAILED_UPDATES_KEY,
        emptyArray.toString(),
      )
      this.preferences?.flushSync()
      return emptyArray
    }
  }

  public getPendingUpdate(): Record<string, string> {
    const pendingUpdateString: string | null = this.preferences.getSync(
      CodePushConstants.PENDING_UPDATE_KEY,
      null,
    ) as string
    Logger.info(
      TAG,
      `[Preload]-SettingManager.installPackage--pendingUpdateString=${pendingUpdateString}`,
    )
    if (pendingUpdateString === null) {
      return null
    }

    try {
      return JSON.parse(pendingUpdateString)
    } catch (e) {
      // Should not happen.
      Logger.error(
        TAG,
        `Unable to parse pending update metadata ${pendingUpdateString},stored in SharedPreferences,e=${JSON.stringify(e)}`,
      )
      return null
    }
  }

  public isFailedHash(packageHash: string): boolean {
    const failedUpdates: Array<Record<string, any>> | null =
      this.getFailedUpdates()
    Logger.info(
      TAG,
      `isFailedHash--failedUpdates=${JSON.stringify(failedUpdates)}`,
    )
    if (failedUpdates !== null && packageHash !== null) {
      for (let i = 0; i < failedUpdates.length; i++) {
        Logger.info(
          TAG,
          `isFailedHash--failedUpdates-i=${JSON.stringify(failedUpdates[i])}`,
        )
        try {
          const failedPackage: Record<string, any> = failedUpdates[i]
          const failedPackageHash: string =
            failedPackage[CodePushConstants.PACKAGE_HASH_KEY]
          Logger.info(
            TAG,
            `isFailedHash--failedPackageHash=${failedPackageHash}`,
          )
          if (packageHash === failedPackageHash) {
            Logger.info(TAG, 'isFailedHash--true')
            return true
          }
        } catch (e) {
          throw new CodePushUnknownException(
            'Unable to read failedUpdates data stored in SharedPreferences.',
            e,
          )
        }
      }
    }
    return false
  }

  public isPendingUpdate(packageHash: string | null): boolean {
    Logger.info(
      TAG,
      `installPackage--isPendingUpdate-entry=${JSON.stringify(this.preferences)}`,
    )
    const pendingUpdate: Record<string, string> = this.getPendingUpdate()
    Logger.info(TAG, `installPackage--pendingUpdate=${pendingUpdate}`)
    try {
      return (
        pendingUpdate != null &&
        !pendingUpdate[CodePushConstants.PENDING_UPDATE_IS_LOADING_KEY] &&
        (packageHash == null ||
          (pendingUpdate[
            CodePushConstants.PENDING_UPDATE_HASH_KEY
          ] as unknown as string) === packageHash)
      )
    } catch (e) {
      throw new CodePushUnknownException(
        'Unable to read pending update metadata in isPendingUpdate.',
        e,
      )
    }
  }

  public isPendingHash(packageHash: string | null): boolean {
    Logger.info(
      TAG,
      `installPackage--isPendingUpdate-entry=${JSON.stringify(this.preferences)}`,
    )
    const pendingUpdate: Record<string, string> = this.getPendingUpdate()
    Logger.info(TAG, `installPackage--pendingUpdate=${pendingUpdate}`)
    try {
      return (
        pendingUpdate != null &&
          (packageHash == null ||
            (pendingUpdate[
            CodePushConstants.PENDING_UPDATE_HASH_KEY
            ] as unknown as string) === packageHash)
      )
    } catch (e) {
      throw new CodePushUnknownException(
        'Unable to read pending update metadata in isPendingUpdate.',
        e,
      )
    }
  }

  public removeFailedUpdates(): void {
    this.preferences.deleteSync(CodePushConstants.FAILED_UPDATES_KEY)
    this.preferences?.flushSync()
  }

  public removePendingUpdate(): void {

    log(`[Preload]-SettingManager.initializeUpdateAfterRestart.${TAG}.removePendingUpdate:bundleName=${this.bundleName}}`)
    this.preferences?.deleteSync(CodePushConstants.PENDING_UPDATE_KEY)
    this.preferences?.flushSync()
  }

  public saveFailedUpdate(failedPackage: Record<string, any>): void {
    try {
      if (
        this.isFailedHash(
          failedPackage[
            CodePushConstants.PACKAGE_HASH_KEY
          ] as unknown as string,
        )
      ) {
        // Do not need to add the package if it is already in the failedUpdates.
        return
      }
    } catch (e) {
      throw new CodePushUnknownException(
        'Unable to read package hash from package.',
        e,
      )
    }

    const failedUpdatesString: string | null = this.preferences.getSync(
      CodePushConstants.FAILED_UPDATES_KEY,
      null,
    ) as string
    let failedUpdates: Array<Record<string, any>>
    if (failedUpdatesString == null) {
      failedUpdates = []
    } else {
      try {
        failedUpdates = JSON.parse(failedUpdatesString)
      } catch (e) {
        // Should not happen.
        throw new CodePushMalformedDataException(
          'Unable to parse failed updates information ' +
            failedUpdatesString +
            ' stored in SharedPreferences',
          e,
        )
      }
    }

    failedUpdates.push(failedPackage)
    this.preferences.putSync(
      CodePushConstants.FAILED_UPDATES_KEY,
      JSON.stringify(failedUpdates),
    )
    this.preferences?.flushSync()
  }

  public getLatestRollbackInfo(): Record<string, any> | null {
    const latestRollbackInfoString = this.preferences.getSync(
      CodePushConstants.LATEST_ROLLBACK_INFO_KEY,
      null,
    ) as string
    if (!latestRollbackInfoString) {
      return null
    }

    try {
      return JSON.parse(latestRollbackInfoString)
    } catch (error) {
      Logger.error(
        TAG,
        `Unable to parse latest rollback metadata=${latestRollbackInfoString},stored in SharedPreferences,e=${JSON.stringify(error)}`,
      )
      return null
    }
  }

  public setLatestRollbackInfo(packageHash: string): void {
    let latestRollbackInfo: Record<string, any> = this.getLatestRollbackInfo()
    let count = 0

    if (latestRollbackInfo) {
      const latestRollbackPackageHash =
        latestRollbackInfo[CodePushConstants.LATEST_ROLLBACK_PACKAGE_HASH_KEY]
      if (latestRollbackPackageHash === packageHash) {
        count = latestRollbackInfo[
          CodePushConstants.LATEST_ROLLBACK_COUNT_KEY
        ] as number
      }
    } else {
      latestRollbackInfo = {}
    }

    try {
      latestRollbackInfo[CodePushConstants.LATEST_ROLLBACK_PACKAGE_HASH_KEY] =
        packageHash
      latestRollbackInfo[CodePushConstants.LATEST_ROLLBACK_TIME_KEY] =
        Date.now()
      latestRollbackInfo[CodePushConstants.LATEST_ROLLBACK_COUNT_KEY] =
        count + 1
      this.preferences.putSync(
        CodePushConstants.LATEST_ROLLBACK_INFO_KEY,
        JSON.stringify(latestRollbackInfo),
      )
      this.preferences?.flushSync()
    } catch (error) {
      throw new CodePushUnknownException(
        'Unable to save latest rollback info.',
        error,
      )
    }
  }

  public savePendingUpdate(packageHash: string, isLoading: boolean): void {
    log(`[Preload]-SettingManager.savePendingUpdate=====, packageHash=${packageHash}, isLoading=${isLoading}, bundleName=${this.bundleName}`)
    const pendingUpdate: object = {}
    pendingUpdate[CodePushConstants.PENDING_UPDATE_HASH_KEY] = packageHash
    pendingUpdate[CodePushConstants.PENDING_UPDATE_IS_LOADING_KEY] = isLoading
    try {
      Logger.info(
        TAG,
        `savePendingUpdate--pendingUpdate: ${JSON.stringify(pendingUpdate)}`,
      )
      this.preferences?.putSync(
        CodePushConstants.PENDING_UPDATE_KEY,
        JSON.stringify(pendingUpdate),
      )
      this.preferences?.flushSync()
    } catch (error) {
      throw new CodePushUnknownException(
        'Unable to save pending update.',
        error,
      )
    }
  }
}
