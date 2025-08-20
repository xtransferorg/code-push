export enum SystemTypeEnum {
  iOS = 'iOS',
  Android = 'Android',
  Harmony = 'harmony',
}

export enum AppTypeEnum {
  Xtransfer = 'Xtransfer',
  // CrmApp
}

export interface SystemConfig {
  appSysCode: string
  nativeProjectName: string
  nativeProjectId: number
  enabled: boolean
}

export const SYSTEM_CONFIG_MAP: Record<
  AppTypeEnum,
  Record<SystemTypeEnum, SystemConfig>
> = {
  [AppTypeEnum.Xtransfer]: {
    [SystemTypeEnum.iOS]: {
      appSysCode: 'IOS',
      nativeProjectId: 53,
      nativeProjectName: 'xt-app-ios',
      enabled: true,
    },
    [SystemTypeEnum.Android]: {
      appSysCode: 'AN',
      nativeProjectId: 52,
      nativeProjectName: 'xt-app-android',
      enabled: true,
    },
    [SystemTypeEnum.Harmony]: {
      appSysCode: 'OH',
      nativeProjectId: 144,
      nativeProjectName: 'xt-app-oh',
      enabled: false, // 鸿蒙暂未接入sentry, 不开放
    },
  },
}

// 工具函数
export const getSystemConfig = (
  appType: AppTypeEnum,
  system: SystemTypeEnum,
): SystemConfig => {
  const appConfig = SYSTEM_CONFIG_MAP[appType]
  if (!appConfig) {
    throw new Error(`Unsupported app type: ${appType}`)
  }

  const config = appConfig[system]
  if (!config) {
    throw new Error(`Unsupported system type: ${system} for app: ${appType}`)
  }

  return config
}

export const getEnabledSystems = (appType: AppTypeEnum): SystemTypeEnum[] => {
  return Object.entries(SYSTEM_CONFIG_MAP[appType])
    .filter(([, config]) => config.enabled)
    .map(([system]) => system as SystemTypeEnum)
}

export const getNativeAppProjectName = (
  appType: AppTypeEnum,
  system: SystemTypeEnum,
): string => {
  return getSystemConfig(appType, system).nativeProjectName
}

export const getAppSysCode = (
  appType: AppTypeEnum,
  system: SystemTypeEnum,
): string => {
  return getSystemConfig(appType, system).appSysCode
}

export function getBundleTag(appType: AppTypeEnum, bundle) {
  const { bundleName, version, system, label } = bundle
  const name = bundleName.split('-').pop()
  const sysCode = getAppSysCode(appType, system as SystemTypeEnum)
  return `${version}_${label}_${sysCode}_${name}`
}

export function getSentryReleaseVersion(record) {
  if (record.platform === SystemTypeEnum.Android) {
    return `${record.package_name}@${record.version_name}+${record.version_number}`
  } else if (record.platform === SystemTypeEnum.iOS) {
    return record.version_number
  } else {
    // 鸿蒙暂时返回与安卓一致，captain不传参过来
    return `${record.version_name}(${record.version_number})`
  }
}
