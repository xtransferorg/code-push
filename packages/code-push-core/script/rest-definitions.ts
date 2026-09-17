interface AccessKeyBase {
  createdBy?: string
  /*legacy*/ description?: string
  /*key*/ friendlyName?: string
  /*generated key*/ name?: string
}

/*out*/
export interface AccessKey extends AccessKeyBase {
  /*generated*/ createdTime?: number
  expires: number
  /*generated*/ isSession?: boolean
}

/*in*/
export interface AccessKeyRequest extends AccessKeyBase {
  ttl?: number
}

/*out*/
export interface DeploymentMetrics {
  [packageLabelOrAppVersion: string]: UpdateMetrics
}

/*in*/
export interface DeploymentStatusReport {
  appVersion: string
  clientUniqueId?: string
  deploymentKey: string
  previousDeploymentKey?: string
  previousLabelOrAppVersion?: string
  label?: string
  status?: string
  patchFailed?: boolean
}

/*in*/
export interface DownloadReport {
  clientUniqueId: string
  deploymentKey: string
  label: string
}

/*inout*/
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
  commonHash?: string
  bundleName?: string
  force?: boolean
  appBinaryTime?: string
  packagePath?: string
  packageDiff?: PackagesDiffInterface
}

export interface PackagesDiffInterface {
  id: number
  packageId: number
  diffAgainstPackageHash: string
  diffBlobUrl: string
  diffSize: number
  createdAt: Date
  updatedAt: Date
}

export interface ReleaseInfo {
  rollout?: number
  whiteList?: string
}

/*out*/
export interface UpdateCheckResponse extends PackageInfo {
  downloadURL?: string
  isAvailable: boolean
  packageSize?: number
  shouldRunBinaryVersion?: boolean
  updateAppVersion?: boolean
  downloadDiffUrl?: string
  downloadDiffSize?: number
  isDiffAvailable?: boolean
  currentPackageDiff?: {
    downloadDiffUrl: string,
    downloadDiffSize: number,
    isDiffAvailable: boolean
  }
}

/*out*/
export interface UpdateCheckCacheResponse {
  originalPackage: UpdateCheckResponse
  rollout?: number
  rolloutPackage?: UpdateCheckResponse
}

/*in*/
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

/*out*/
export interface UpdateMetrics {
  active: number
  downloaded?: number
  failed?: number
  installed?: number
}

/*out*/
export interface Account {
  /*key*/ email: string
  name: string
  linkedProviders: string[]
}

/*out*/
export interface CollaboratorProperties {
  isCurrentAccount?: boolean
  permission: string
}

/*out*/
export type CollaboratorMap = string[]

/*inout*/
export interface App {
  /*generated*/ collaborators?: CollaboratorMap
  /*key*/ name: string
  /* generated */ deployments?: string[]
  os?: string
  platform?: string
}

/*in*/
export interface AppCreationRequest extends App {
  manuallyProvisionDeployments?: boolean
}

/*inout*/
export interface Deployment {
  /*generated key*/ key?: string
  /*key*/ name: string
  /*generated*/ package?: Package
}

/*out*/
export interface BlobInfo {
  size: number
  url: string
}

/*out*/
export interface PackageHashToBlobInfoMap {
  [packageHash: string]: BlobInfo
}

/*inout*/
export interface Package extends PackageInfo {
  /*generated*/ blobUrl: string
  /*generated*/ diffPackageMap?: PackageHashToBlobInfoMap
  /*generated*/ originalLabel?: string // Set on "Promote" and "Rollback"
  /*generated*/ originalDeployment?: string // Set on "Promote"
  /*generated*/ releasedBy?: string // Set by commitPackage
  /*generated*/ releaseMethod?: string // "Upload", "Promote" or "Rollback". Unknown if unspecified
  /*generated*/ size: number
  /*generated*/ uploadTime: number
}
