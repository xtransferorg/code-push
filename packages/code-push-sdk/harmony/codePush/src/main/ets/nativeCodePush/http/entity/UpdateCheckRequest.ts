/**
 * updateCheck http param
 */
export interface UpdateCheckRequest {
  appVersion: string
  clientUniqueId?: string
  deploymentKey: string
  isCompanion?: boolean
  label?: string
  packageHash?: string
  basePackageHash?: string
  commonHash?: string
}
