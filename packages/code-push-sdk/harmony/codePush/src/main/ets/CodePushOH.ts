export abstract class CodePushBase {
  abstract deploymentKey: string
  /**
   * 返回当前 bundle 名字
   * @returns harmony.xt-app-main.js
   */
  abstract bundleName(): string
}
