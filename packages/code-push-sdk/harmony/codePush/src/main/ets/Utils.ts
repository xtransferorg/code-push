import { bundleManager } from '@kit.AbilityKit'

export const getCurrentAppVersionName = (() => {
  const { versionName } = bundleManager.getBundleInfoForSelfSync(
    bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT,
  )
  return () => {
    return versionName
  }
})()
