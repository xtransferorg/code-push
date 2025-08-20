/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import common from '@ohos.app.ability.common'
import { CodePush } from './CodePush'
import bundleManager from '@ohos.bundle.bundleManager'
import Logger from './Logger'
import { UITurboModuleContext } from '@rnoh/react-native-openharmony/ts'

declare function getContext(context: any): common.UIAbilityContext

const TAG = 'CodePushNativeModule-CodePushBuilder: '

export class CodePushBuilder {
  private mIsDebugMode: boolean = false
  private mPublicKeyResourceDescriptor: number = -1
  static mCodePushs = new Map<string, CodePush>()

  constructor(
    private bundleIntlInfo: any,
    private deploymentKey: string,
    private mServerUrl: string,
  ) {
    let bundleFlags = bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION
    let bundleInfo = bundleManager.getBundleInfoForSelfSync(bundleFlags)
    let isDebug = bundleInfo.appInfo.debug
    Logger.info(TAG, `CodePushBuilder isDebug:${isDebug}`)
    Logger.info(TAG, `CodePushBuilder getDeploymentKey:${deploymentKey}`)
  }

  public setIsDebugMode(isDebugMode: boolean) {
    this.mIsDebugMode = isDebugMode
    return this
  }

  public setServerUrl(serverUrl: string) {
    this.mServerUrl = serverUrl
  }

  public setPublicKeyResourceDescriptor(publicKeyResourceDescriptor: number) {
    this.mPublicKeyResourceDescriptor = publicKeyResourceDescriptor
    return this
  }

  public build(rnContext: UITurboModuleContext) {
    let codePush = CodePushBuilder.mCodePushs.get(this.deploymentKey)
    if (codePush) {
      // 保证一个 deploymentKey 对应一个 CodePush
      // 但是又需要保证 rnContext 保持更新，因为在强制更新时，rnContext 会更新
      codePush.setRnContext(rnContext)
      return codePush
    }
    codePush = new CodePush(
      this.bundleIntlInfo,
      this.deploymentKey,
      this.mIsDebugMode,
      this.mServerUrl,
      rnContext,
      this.mPublicKeyResourceDescriptor,
    )
    CodePushBuilder.mCodePushs.set(this.deploymentKey, codePush)
    return codePush
  }
}
