/*
 * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
 * Use of this source code is governed by a MIT license that can be
 * found in the LICENSE file.
 */

import {
  RNPackage,
  UITurboModule,
  UITurboModuleContext,
  RNPackageContext,
  UITurboModuleFactory,
} from '@rnoh/react-native-openharmony/ts'
import { TM } from '@rnoh/react-native-openharmony/generated/ts'
import { CodePushNativeModule } from './CodePushNativeModule'
import { CodePushBuilder } from './CodePushBuilder'
import fs, { ReadTextOptions } from '@ohos.file.fs'
import common from '@ohos.app.ability.common'
import { bundleManager } from '@kit.AbilityKit'
import Logger from './Logger'
import { CodePushConstants } from './CodePushConstants'
import { getCurrentAppVersionName } from './Utils'

const TAG = 'CodePushNativeModule-CodePushPackage: '

class CodePushModulesFactory extends UITurboModuleFactory {
  constructor(
    ctx: UITurboModuleContext,
    private bundleInfo: any,
    private serverUrl: string,
  ) {
    super(ctx)
  }

  createTurboModule(name: string): UITurboModule | null {
    if (name === TM.RTNCodePush.NAME) {
      let codePush = new CodePushBuilder(
        this.bundleInfo,
        this.bundleInfo?.getCodePushKey(),
        this.serverUrl,
      ).build(this.ctx)
      return new CodePushNativeModule(this.ctx, codePush)
    }
    return null
  }

  hasTurboModule(name: string): boolean {
    return name === TM.RTNCodePush.NAME
  }
}

export class CodePushPackage extends RNPackage {
  constructor(
    ctx: RNPackageContext,
    private bundleInfo: any,
    private serverUrl: string,
  ) {
    super(ctx)
  }

  createTurboModulesFactory(ctx: UITurboModuleContext): UITurboModuleFactory {
    return new CodePushModulesFactory(ctx, this.bundleInfo, this.serverUrl)
  }
}

export function clearOtherVersionCodePushData(context: common.AbilityStageContext) {
  const versionName = getCurrentAppVersionName()
  const fileList = fs.listFileSync(context.filesDir)
  fileList.filter(filePath => fs.statSync(filePath).isDirectory() && /[0-9]\.[0-9]\.[0-9]$/.test(filePath) &&
    !filePath.endsWith(versionName))
    .forEach(filePath => {
      fs.rmdirSync(filePath)
    })
}
