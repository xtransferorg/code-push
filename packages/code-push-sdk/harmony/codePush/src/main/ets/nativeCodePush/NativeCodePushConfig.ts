export interface Configuration {
  appVersion: string
  clientUniqueId: string
  deploymentKey: string
  serverUrl: string
  /**
   * base package hash
   * inner bundle: inner bundle hash(from inner codepush.json);
   * dynamic bundle: base bundle hash(from http);
   */
  packageHash?: string
  commonHash?: string
}