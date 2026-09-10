import { bundleManager, common } from '@kit.AbilityKit'
import dataPreferences from '@ohos.data.preferences'
import deviceInfo from '@ohos.deviceInfo'
import { CodePushConstants } from './CodePushConstants'

const TAG = "[CodePushUtils]"

export const getCurrentAppVersionName = (() => {
  const { versionName } = bundleManager.getBundleInfoForSelfSync(
    bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT,
  )
  return () => {
    return versionName
  }
})()

export const isCodePushLabelNewer = (newer: string | undefined | null, older: string | undefined | null): boolean => {
  if (isBlankLabel(newer)) {
    return true
  }
  if (isBlankLabel(older)) {
    return true
  }

  const newerNum = parseLabelNumber(newer as string)
  if (newerNum === undefined) {
    return false
  }

  const olderNum = parseLabelNumber(older as string)
  if (olderNum === undefined) {
    return false
  }

  return newerNum > olderNum
}

const isBlankLabel = (value: string | undefined | null): boolean => {
  if (value === undefined || value === null) {
    return true
  }
  return value.trim().length === 0
}

const parseLabelNumber = (label: string): number | undefined => {
  const match = label.match(/\d+/)
  if (!match) {
    return undefined
  }
  return Number.parseInt(match[0], 10)
}

export const getClientUniqueId = (context: common.UIAbilityContext) => {
  const prefs = dataPreferences.getPreferencesSync(context, { name: CodePushConstants.CODE_PUSH_PREFERENCES })
  let clientUniqueId = prefs.getSync(CodePushConstants.CLIENT_UNIQUE_ID_KEY, '') as string
  if (!clientUniqueId) {
    clientUniqueId = deviceInfo.ODID
    prefs.putSync(CodePushConstants.CLIENT_UNIQUE_ID_KEY, clientUniqueId)
    prefs.flush()
  }

  console.log(TAG, `getClientUniqueId=${clientUniqueId}`)
  return clientUniqueId
}