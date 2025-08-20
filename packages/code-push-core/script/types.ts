export {
  AccessKeyRequest,
  Account,
  App,
  AppCreationRequest,
  CollaboratorMap,
  CollaboratorProperties,
  Deployment,
  DeploymentMetrics,
  Package,
  PackageInfo,
  AccessKey as ServerAccessKey,
  UpdateMetrics,
  ReleaseInfo,
} from './rest-definitions'

export interface CodePushError {
  message: string
  statusCode: number
}

export interface AccessKey {
  createdTime: number
  expires: number
  name: string
  key?: string
}

export interface Session {
  loggedInTime: number
  machineName: string
}

export type Headers = { [headerName: string]: string }

export interface AddAppConfig {
  repositoryUrl?: string
  appKey?: string
  port?: number
}

export type Environment = 'dev' | 'prod' | string
export type Platform = 'iOS' | 'Android' | 'OH'
export type UpdateType = 'Force' | 'Silent' | 'Suggestion'
export type BuildType = 'debug' | 'release'

export interface NativeRelease {
  appKey: string
  versionName: string
  versionNumber: string
  changeLog: string
  downloadUrl: string
  buildType?: BuildType
  isBackwardCompatible?: boolean
  environment?: Environment
  updateType?: UpdateType
  channel?: string
  onlyApplyVersion?: string
  notOnlyApplyVersion?: string
  status?: string
  appFormat?: string
}

export interface NativeUpdateRelease extends NativeRelease {
  versionId: string
  rollout?: number
  status?: string
  whiteList?: string
}

export interface NativeListRelease extends NativeRelease {
  page?: number
  limit?: number
}
