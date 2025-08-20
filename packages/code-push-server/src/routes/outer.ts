import express from 'express'
import {
  AppTypeEnum,
  SystemTypeEnum,
  getEnabledSystems,
  getBundleTag,
  getNativeAppProjectName,
  getSentryReleaseVersion,
  getSystemConfig,
} from '../config/system-config'
// 在文件顶部添加模型导入和操作符导入
import { NativeApps } from '../models/native_apps'
import { NativeAppVersions } from '../models/native_app_versions'
import { Op } from 'sequelize'

export const outerRouter = express.Router()

// 辅助函数：根据应用类型分离应用
function separateAppsByType(appType: AppTypeEnum, publishInfoList: any[]) {
  const nativeApps: any[] = []
  const nonNativeApps: any[] = []
  const enabledSystems = getEnabledSystems(appType)

  publishInfoList.forEach((item) => {
    if (item.isNative) {
      // 处理 native 应用

      if (!enabledSystems.includes(item.system as SystemTypeEnum)) {
        return
      }
      const nativeProject = getSystemConfig(
        appType,
        item.system as SystemTypeEnum,
      )

      if (nativeProject.enabled) {
        nativeApps.push({
          ...item,
          projectId: nativeProject.nativeProjectId,
          bundleName: nativeProject.nativeProjectName,
        })
      }
    } else {
      nonNativeApps.push({
        ...item,
      })
    }
  })

  // 对 nativeApps 根据 system 和 version 字段去重
  const uniqueNativeApps = nativeApps.filter((app, index, self) => {
    return (
      index ===
      self.findIndex(
        (a) => a.system === app.system && a.version === app.version,
      )
    )
  })

  return { nativeApps: uniqueNativeApps, nonNativeApps }
}

// 辅助函数：处理非 native 应用
function processNonNativeApps(appType: AppTypeEnum, nonNativeApps: any[]) {
  return nonNativeApps.map((item) => ({
    ...item,
    sentryReleaseVersion: getBundleTag(appType, item),
  }))
}

// 辅助函数：处理 native 应用
async function processNativeApps(appType: AppTypeEnum, nativeApps: any[]) {
  if (nativeApps.length === 0) {
    return []
  }

  // 构建批量查询条件
  const queryConditions = nativeApps.map((app) => {
    return {
      version: app.version,
      system: app.system,
    }
  })

  const versions = queryConditions.map((c) => c.version)
  const systems = [...new Set(queryConditions.map((c) => c.system))]

  // 根据条件查询符合条件的应用
  const matchingApps = await NativeApps.findAll({
    where: {
      platform: {
        [Op.in]: systems,
      },
      name: appType,
      app_type: 'Release',
    },
    attributes: ['app_key', 'platform', 'package_name'],
  })

  const appKeys = matchingApps.map((app) => app.app_key)

  // 根据app_key和其他条件查询版本信息
  const nativeAppVersions = await NativeAppVersions.findAll({
    where: {
      app_key: {
        [Op.in]: appKeys,
      },
      version_name: {
        [Op.in]: versions,
      },
      environment: 'prod',
    },
    order: [['id', 'DESC']],
  })

  // 合并数据
  const queryResult = nativeAppVersions.map((version) => {
    const matchingApp = matchingApps.find(
      (app) => app.app_key === version.app_key,
    )
    return {
      ...version.toJSON(),
      platform: matchingApp?.platform,
      package_name: matchingApp?.package_name,
    }
  })

  return nativeApps.flatMap((app) => {
    const matchingRecords = (queryResult as any[]).filter(
      (record) =>
        record.version_name === app.version && record.platform === app.system,
    )

    const sentryReleaseVersions = matchingRecords.map((record) =>
      getSentryReleaseVersion(record),
    )

    // 去重后为每个不同的版本创建一条数据
    const uniqueVersions = [...new Set(sentryReleaseVersions)]

    return uniqueVersions.map((version) => ({
      ...app,
      bundleName: getNativeAppProjectName(
        appType,
        app.system as SystemTypeEnum,
      ),
      sentryReleaseVersion: version,
    }))
  })
}

// 批量获取包标签信息的接口
outerRouter.post('/package/label/batch', async (req, res, next) => {
  const { body } = req
  const { publishInfoList, appType = AppTypeEnum.Xtransfer } = body

  // 早期返回处理空数据
  if (
    !publishInfoList ||
    !Array.isArray(publishInfoList) ||
    publishInfoList.length === 0
  ) {
    return res.status(200).send({ publishInfoList: [] })
  }

  try {
    // 分离 native 和非 native 应用
    const { nativeApps, nonNativeApps } = separateAppsByType(
      appType,
      publishInfoList,
    )

    // 并行处理两种类型的应用
    const [nativeResults, nonNativeResults] = await Promise.all([
      processNativeApps(appType, nativeApps),
      processNonNativeApps(appType, nonNativeApps),
    ])

    // 合并结果并保持原始顺序
    const result = [...nativeResults, ...nonNativeResults]

    res.status(200).send({ publishInfoList: result })
  } catch (e) {
    next(e)
  }
})
