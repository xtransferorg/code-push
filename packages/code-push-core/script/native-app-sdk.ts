// @ts-nocheck
import BaseSdk = require('./base-sdk')
import {
  NativeAppPublish,
  NativeAppPublishModel,
  NativeAppMeta,
  NativeAppMetaWithCommonHash,
  NativeAppType,
  NativeAppVersionWithMeta,
  GetNativeAppVersionsParams,
  NativeAppVersionReviewStatus,
  NativeAppVersionStatus,
  AppVersionsResponse,
  PublishTarget,
  ValidateVersionBundle,
  ValidateVersionResponse,
} from './types'

class NativeAppSdk extends BaseSdk {
  constructor(serverUrl: string, accessKey: string) {
    super(serverUrl, accessKey)
  }

  /**
   * 获取发布版本列表
   * @param coreVersions 核心版本列表
   * @returns Promise
   */
  public getReleaseVersions(coreVersions: string | string[]): Promise<any> {
    return this._post('/xrn/app/get_hot_update_apps', { coreVersions })
  }

  public publishNativeApp(
    params: NativeAppPublish,
  ): Promise<NativeAppPublishModel> {
    const requestBody = {
      app_key: params.app_key,
      download_url: params.download_url,
      version_name: params.version_name,
      rollout: params.rollout,
      is_backward_compatible: params.is_backward_compatible,
      environment: params.environment,
      core_version: params.core_version,
      platform: params.platform,
      min_supported_version: params.min_supported_version,
      status: params.status,
      white_list: params.white_list,
      build_type: params.build_type,
      update_type: params.update_type,
      changelog: params.changelog,
      channel: params.channel,
      version_number: params.version_number,
      only_apply_version: params.only_apply_version,
      not_only_apply_version: params.not_only_apply_version,
      app_format: params.app_format,
      package_size: params.package_size,
      download_url_arm32: params.download_url_arm32,
      download_url_arm64: params.download_url_arm64,
    }
    return this._post<NativeAppPublishModel>('/xrn/app/publish', requestBody)
  }

  public getLatestVersion(params: {
    platform: string
    appType: NativeAppType
    coreVersion?: string
  }): Promise<NativeAppMeta> {
    const { platform, coreVersion, appType } = params
    return this._get<NativeAppMeta>('/xrn/app/get_latest_release', {
      platform,
      coreVersion,
      appType,
    })
  }

  public getAppMetaList(params: {
    platform: string
    appType: NativeAppType
  }): Promise<NativeAppMetaWithCommonHash[]> {
    const { platform, appType } = params
    return this._get<NativeAppMetaWithCommonHash[]>(
      '/xrn/app/get_app_meta_list',
      {
        platform,
        appType,
      },
    )
  }

  public updateMinSupportedVersion(params: {
    platform: string
    coreVersion: string
    minSupportedVersion: string
  }): Promise<void> {
    const { platform, coreVersion, minSupportedVersion } = params
    return this._post<void>('/xrn/app/update_min_supported_version', {
      platform,
      coreVersion,
      minSupportedVersion,
    })
  }

  public markMarketReviewPassed(params: {
    versionId: string
    reviewStatus: NativeAppVersionReviewStatus
  }): Promise<void> {
    const { versionId, reviewStatus } = params
    return this._post<void>('/xrn/app/market_review_passed', {
      versionId,
      reviewStatus: Number(reviewStatus),
    })
  }

  /**
   * 获取 NativeAppVersions 数据列表，关联 app_meta 表
   * @param params 查询参数
   * @returns Promise<NativeAppVersionWithMeta[]>
   */
  public getNativeAppVersions(
    params: GetNativeAppVersionsParams,
  ): Promise<NativeAppVersionWithMeta[]> {
    const { platform, channel, build_type, app_format, version_name, name } =
      params
    return this._get<NativeAppVersionWithMeta[]>(
      '/xrn/app/get_native_app_versions',
      {
        platform,
        channel,
        build_type,
        app_format,
        version_name,
        name,
      },
    )
  }

  /**
   * 获取候选 App 版本列表（按 platform + publishTarget 过滤）
   * Captain 自动填充发布单版本号下拉项时调用
   */
  public getAppVersions(params: {
    platform: string
    publishTarget: PublishTarget
    environment?: string
  }): Promise<AppVersionsResponse> {
    return this._get<AppVersionsResponse>('/xrn/app/app-versions', params)
  }

  /**
   * 校验目标版本列表合法性
   * 预发流水线「原生版本校验」节点调用
   */
  public validateAppVersions(params: {
    platform: string
    publishTarget: PublishTarget
    targetVersions: string[]
    bundles?: ValidateVersionBundle[]
    environment?: string
  }): Promise<ValidateVersionResponse> {
    return this._post<ValidateVersionResponse>(
      '/xrn/app/validate-version',
      params,
    )
  }

  /**
   * App 发布单 bundle 合入 master 后调用，将目标版本所有渠道流转为 published
   */
  public setPublished(params: {
    versionId?: string
    platform?: string
    versionName?: string
    environment?: string
  }): Promise<{
    updated: string[]
    skipped: { versionId: string; status: string }[]
  }> {
    return this._post('/xrn/app/set-published', {
      version_id: params.versionId,
      platform: params.platform,
      version_name: params.versionName,
      environment: params.environment,
    })
  }

  /**
   * 统一的原生版本状态变更入口（取代原 app-rollout 的状态变更能力）
   * targetStatus 支持：market_approved / rollout / paused / rollout_closed / discarded
   * 服务端依状态机校验流转合法性
   */
  public changeAppStatus(params: {
    versionId: string
    targetStatus: NativeAppVersionStatus
  }): Promise<{
    versionId: string
    previousStatus: NativeAppVersionStatus
    status: NativeAppVersionStatus
  }> {
    return this._post('/xrn/app/change-status', {
      version_id: params.versionId,
      target_status: params.targetStatus,
    })
  }
}

export = NativeAppSdk
