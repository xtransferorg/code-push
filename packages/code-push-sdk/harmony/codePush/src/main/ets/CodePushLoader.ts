import {
  JSBundleProvider,
  JSBundleProviderError,
} from '@rnoh/react-native-openharmony/ts'
import fs from '@ohos.file.fs'
import Logger from './Logger'
import { CodePushUpdateManager } from './CodePushUpdateManager'
import { CodePushNativeModule } from './CodePushNativeModule'
import { common } from '@kit.AbilityKit'

const TAG = 'CodePushLoader:'

export class CodePushJSBundleProvider extends JSBundleProvider {
  constructor(
    private appKeys: string[] = [],
    private context: common.UIAbilityContext,
    private bundleName: string,
    private deploymentKey: string,
  ) {
    super()
  }

  getURL(): string {
    return this.getCurrentBundlePath()
  }

  getAppKeys(): string[] {
    return this.appKeys
  }

  async getBundle(
    onProgress?: (progress: number) => void,
  ): Promise<ArrayBuffer> {
    try {
      const url = this.getURL()
      if (!url) {
        throw new Error('Bundle not found. ' + this.bundleName + ' ' + this.deploymentKey)
      }
      const file = await fs.open(url, fs.OpenMode.READ_ONLY)
      const { size } = await fs.stat(file.fd)
      const buffer = new ArrayBuffer(size)
      await fs.read(file.fd, buffer, { length: size })
      return buffer
    } catch (err) {
      Logger.error(TAG, err)
      throw new JSBundleProviderError({
        whatHappened: `Couldn't load JSBundle from ${this.getURL()}`,
        extraData: err,
        howCanItBeFixed: [
          `Check if a bundle exists at "${this.getURL()}" on your device.`,
        ],
      })
    }
  }

  getCurrentBundlePath() {
    Logger.info(TAG, 'getCurrentBundlePath=' + this.deploymentKey)
    Logger.info(TAG, 'bundleName=' + this.bundleName)
    const codePushUpdateManager = new CodePushUpdateManager(
      this.context,
      '',
      this.deploymentKey,
    )
    const bundlePath = codePushUpdateManager.getCurrentPackageBundlePath(
      this.bundleName,
    )
    Logger.info(TAG, 'getCurrentBundlePath--bundlePath=' + bundlePath)
    return bundlePath
  }

  static loadCodePushBundle(
    context: common.UIAbilityContext,
    bundleName: string,
    deploymentKey: string,
  ) {
    return new CodePushJSBundleProvider([], context, bundleName, deploymentKey)
  }
}
