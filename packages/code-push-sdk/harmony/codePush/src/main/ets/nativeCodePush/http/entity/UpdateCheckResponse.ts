/**
 * updateCheck http response
 */
export interface UpdateCheckResponse extends PackageInfo {
  downloadURL?: string
  isAvailable?: boolean
  packageSize?: number
  shouldRunBinaryVersion?: boolean
  updateAppVersion?: boolean
  downloadDiffUrl?: string
  downloadDiffSize?: number
  isDiffAvailable?: boolean
  basePackageHash?: string
  baseDownloadUrl?: string
  basePackageSize?: number
  currentPackageDiff?: CurrentPackageDiff
  deploymentKey?: string
}

export interface PackageInfo {
  appVersion?: string
  description?: string
  isDisabled?: boolean
  isMandatory?: boolean
  /*generated*/ label?: string
  /*generated*/ packageHash?: string
  rollout?: number
  uuid?: string
  originalLabel?: string
  whiteList?: string
  channelReleaseId?: string
  bundleName?: string
  force?: boolean
  appBinaryTime?: string
}

export interface CurrentPackageDiff {
  downloadDiffUrl?: string
  downloadDiffSize?: number
  isDiffAvailable?: boolean
}