import { AppMeta } from '../../models/app_version_meta'
import semver from 'semver'

class NativeAppManager {
  constructor() {}

  /**
   * 检查更新类型，根据基线的最小支持版本判断是否需要强制更新
   * @param appMetaId - 应用元数据ID
   * @param version - 当前应用版本
   * @param currentUpdateType - 当前的更新类型（可选，如果未提供则返回原值或默认值）
   * @returns 更新类型：'Force' 如果需要强制更新，否则返回 currentUpdateType 或 'Silent'
   */
  async checkUpdateType(
    appMetaId: number | null | undefined,
    version: string,
    currentUpdateType?: string,
  ): Promise<string> {
    // 兼容历史版本，如果最新记录有app_meta_id，根据基线的最小支持版本判断是否需要强制更新
    if (appMetaId) {
      const nativeAppMeta = await AppMeta.findByPk(appMetaId)
      if (
        nativeAppMeta?.min_supported_version &&
        semver.lt(version, nativeAppMeta.min_supported_version)
      ) {
        return 'Force'
      }
    }

    // 如果没有需要强制更新的情况，返回当前的更新类型或默认值
    return currentUpdateType || 'Silent'
  }
}

export const nativeAppManager = new NativeAppManager()
