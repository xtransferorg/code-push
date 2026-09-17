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
export * from './rest-definitions'

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
  deliveryType?: string
  buildType?: string
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

// 文件类型枚举
export enum BaseLineFileType {
  META = 'META',
  RAW = 'RAW',
  COMMON = 'COMMON',
  COMMON_MAP = 'COMMON_MAP',
  BUNDLE_RESOURCE = 'BUNDLE_RESOURCE',
  BASE_PACKAGE = 'BASE_PACKAGE',
  BUNDLE_RESOURCES = 'BUNDLE_RESOURCES',
  BUNDLE_BUILD_PRODUCT = 'BUNDLE_BUILD_PRODUCT',
  NATIVE_SIGNATURE = 'NATIVE_SIGNATURE',
  HBC_BASELINE = 'HBC_BASELINE',
}

export interface BaselineMeta {
  platform: string
  version_name: string
  app_type: NativeAppType
  core_version?: string
  cli_version?: string
  version_number?: number
  min_supported_version?: string
  common_hash?: string
  env?: string
}

export interface DynamicBaselineMeta {
  platform: string
  version_name: string
  common_hash: string
  app_type: NativeAppType
  file_type: BaseLineFileType
  file_name: string
  file_size: number
  file_hash: string
  coverable?: boolean
}

export interface BaselineDownload {
  file_type: BaseLineFileType
  url: string
  file_name: string
  file_hash: string
}

export type BaselineDownloadModel = BaselineDownload[]

export interface BaselineModel {
  id: number
  app_meta_id: number
  deployment_version_id: number
  url: string
  file_name: string
  file_hash: string
  file_type: string
  created_at: Date
  updated_at: Date
  deleted_at: Date
  deleted: number
}

export interface BaselineUploadedResponse {
  baselineRecords: BaselineModel[]
  appMetaId: number
}

export enum NativeAppVersionStatus {
  ReadyForReview = 'ready_for_review',
  PendingReview = 'pending_review',
  /** 市场审核通过，尚未开始应用内灰度放量 */
  MarketApproved = 'market_approved',
  Rollout = 'rollout',
  /** 灰度暂停，存量灰度用户仍需收到热更新 */
  Paused = 'paused',
  Published = 'published',
  /** 灰度已关闭，存量用户按正式用户对待 */
  RolloutClosed = 'rollout_closed',
  Discarded = 'discarded',
}

/**
 * @deprecated 使用 NativeAppVersionStatus 描述完整生命周期，数据迁移完成后删除。
 */
export enum NativeAppVersionReviewStatus {
  AUDIT_PASSED = 1,
  RELEASED = 2,
}

/** 发布目标类型，用于 GET /xrn/app/app-versions 过滤候选版本，review 暂不实现 */
export type PublishTarget = 'official' | 'gray' | 'review'

export interface AppVersionItem {
  version: string
  status: NativeAppVersionStatus
  /** official / gray / review */
  type: 'official' | 'gray' | 'review'
  minSupportedVersion?: string | null
}

export interface AppVersionsResponse {
  versions: AppVersionItem[]
  latestRelease: string | null
  latestGray: string | null
  minOfficialVersion: string | null
  minGrayVersion: string | null
}

export interface ValidateVersionBundle {
  name: string
  coreVersion: string
}

export interface ValidateVersionRequest {
  platform: string
  publishTarget: PublishTarget
  targetVersions: string[]
  bundles: ValidateVersionBundle[]
}

export type ValidateVersionReason =
  | 'OK'
  | 'CORE_VERSION_MISMATCH'
  | 'OUT_OF_COMPATIBLE_RANGE'
  | 'BELOW_MIN_SUPPORTED_VERSION'
  | 'VERSION_LIST_MISMATCH'

export interface ValidateVersionResultItem {
  version: string
  passed: boolean
  reason: ValidateVersionReason
  message: string | null
}

export interface ValidateVersionResponse {
  passed: boolean
  missingVersions: string[]
  results: ValidateVersionResultItem[]
}

export interface NativeAppPublish {
  app_key: string
  download_url: string
  version_name: string
  rollout: number
  is_backward_compatible: boolean
  environment: Environment
  core_version: string
  platform: string
  min_supported_version: string
  status?: NativeAppVersionStatus
  white_list?: string
  build_type?: BuildType
  update_type?: UpdateType
  changelog?: string
  channel?: string
  version_number?: string
  only_apply_version?: string
  not_only_apply_version?: string
  app_format?: string
  package_size?: number
  download_url_arm32?: string
  download_url_arm64?: string
}

export interface NativeAppPublishModel {
  id: number
  app_meta_id: number
  version_id: string // 唯一id
  app_key: string
  version_number: string // 20240101，主要用于在同一个版本下的不同构建（前提条件是同一个版本对外暴露的能力一致）
  version_name: string // 3.3.2
  changelog?: string
  download_url?: string
  rollout: number // 0-100
  white_list?: string
  only_apply_version?: string // 3.3.2，如果设置了此参数，表示只有在此版本客户端才能收到本次更新
  not_only_apply_version?: string // 3.3.2，如果设置了此参数，表示除了此版本客户端都能收到本次更新
  build_type: BuildType
  is_backward_compatible: boolean // 是否兼容前一个版本
  status: NativeAppVersionStatus
  environment: Environment // 生产环境或测试环境
  update_type: UpdateType // 强制更新或静默更新
  channel?: string
  app_format?: string
  package_size?: number
  created_at?: string
  review_passed?: number
}

export interface NativeAppMeta {
  id: number
  platform: string
  version_number: string
  version_name: string
  core_version: string
  cli_version?: string
  min_supported_version: string
  created_at: Date
  updated_at: Date
  deleted_at: Date
  deleted: number
}

export interface NativeAppMetaWithCommonHash extends NativeAppMeta {
  common_hash: string | null
}

export interface NativeAppVersionWithMeta extends NativeAppPublishModel {
  app_meta: NativeAppMeta | null
}

export interface GetNativeAppVersionsParams {
  platform: string
  channel?: string
  build_type: BuildType
  app_format: string
  version_name?: string
  name?: string
}

export enum NativeAppType {
  RELEASE = 'release',
  DEBUG = 'debug',
}

export enum BundlePlatformMapType {
  IOS = 1,
  ANDROID = 2,
  HARMONY = 4,
}

export enum SystemType {
  IOS = 'ios',
  ANDROID = 'android',
  HARMONY = 'harmony',
}
