// 更新方式：走应用市场更新，还是走应用内更新（直接下发下载链接）
enum UpdateMethod {
  MARKET = 'market',
  IN_APP = 'in_app',
}

// 走市场更新时，兜底下载链接固定使用的渠道
// 用于客户端因各种原因无法跳转应用市场时的下载兜底（例如国内某些设备无法打开对应应用商店）
export const MARKET_FALLBACK_CHANNEL = 'chinaNew'

// 服务端维护的渠道配置：目前只需要维护「是否已在应用市场上架」这一属性
// 命中的渠道走应用市场更新，未命中的渠道走应用内更新（下发对应渠道自己的下载链接，老逻辑）
interface ChannelConfig {
  onMarket: boolean
}

const CHANNEL_CONFIG_MAP: Record<string, ChannelConfig> = {
  appStore: { onMarket: true },
  AppGallery: { onMarket: true },
  googlePlay: { onMarket: true },
  xiaomi: { onMarket: true },
  vivo: { onMarket: true },
  oppo: { onMarket: true },
  huawei: { onMarket: true },
  honor: { onMarket: true },
}

class ChannelMarketManager {
  /**
   * 判断该渠道对应的应用市场是否已上架当前 App
   * 未在配置中登记的渠道，默认视为未上架（走应用内更新，保持老逻辑）
   */
  isOnMarket(channel: string | undefined | null): boolean {
    if (!channel) return false
    return Boolean(CHANNEL_CONFIG_MAP[channel]?.onMarket)
  }

  /**
   * 根据渠道判断本次更新应该走应用市场更新还是应用内更新
   */
  getUpdateMethod(channel: string | undefined | null): UpdateMethod {
    return this.isOnMarket(channel) ? UpdateMethod.MARKET : UpdateMethod.IN_APP
  }
}

export const channelMarketManager = new ChannelMarketManager()
