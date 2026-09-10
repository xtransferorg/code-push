/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import type { TurboModule } from 'react-native/Libraries/TurboModule/RCTExport'
import { TurboModuleRegistry } from 'react-native'

export interface Spec extends TurboModule {
  codePushInstallModeImmediate: () => number
  codePushInstallModeOnNextRestart: () => number
  codePushInstallModeOnNextResume: () => number
  codePushInstallModeOnNextSuspend: () => number
  codePushUpdateStateRunning: () => number
  codePushUpdateStatePending: () => number
  codePushUpdateStateLatest: () => number
  sync(): Promise<Object>
  isFailedUpdate(packageHash: string): Promise<boolean>
  allow(): void
  clearPendingRestart(): void
  disallow(): void
  restartApp(onlyIfUpdateIsPending: boolean): Promise<boolean>
  downloadUpdate(
    updatePackage: Object,
    notifyProgress: boolean,
  ): Promise<Object>
  getConfiguration(): Promise<Object>
  getUpdateMetadata(updateState: number): Promise<object>
  getNewStatusReport(): Promise<Object>
  installUpdate(
    updatePackage: Object,
    installMode: number,
    minimumBackgroundDuration: number,
  ): Promise<object>
  getLatestRollbackInfo(): Promise<string | null>
  setLatestRollbackInfo(packageHash: string): Promise<string | null>
  isFirstRun(packageHash: string): Promise<boolean | null>
  notifyApplicationReady(): Promise<string | null>
  recordStatusReported(statusReport: Object): void
  saveStatusReportForRetry(statusReport: Object): void
  downloadAndReplaceCurrentBundle(remoteBundleUrl: string): void
  clearUpdates(): void
  isFileExist(path: string): boolean
  getIntlResourcePath(path: string): string
  isNativeSyncing(): boolean
  isAssetBundleFileExists(): boolean
  getBasePackageBundlePath(): string
  addListener?(eventName: string): void
  removeListeners?(count: number): void
  beforeLoadBizBundleHandlePendingUpdate?(): void
}

export default TurboModuleRegistry.get<Spec>('RTNCodePush') as Spec | null
