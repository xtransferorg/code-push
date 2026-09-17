/**
 * codePush http config
 */
export interface NativeCodePushHttpConfig {
  appVersion: string
  clientUniqueId: string
  deploymentKey: string
  serverUrl: string
  ignoreAppVersion?: boolean
  httpConnectTimeout?: number
  httpReadTimeout?: number
}