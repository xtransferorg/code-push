import _, { isUndefined, omitBy } from 'lodash'
import { Op } from 'sequelize'
import { Apps, AppsInterface } from '../../models/apps'
import { Collaborators } from '../../models/collaborators'
import { Deployments } from '../../models/deployments'
import { Users } from '../../models/users'
import { AppError } from '../app-error'
import {
  IOS,
  IOS_NAME,
  ANDROID,
  ANDROID_NAME,
  WINDOWS,
  WINDOWS_NAME,
  CORDOVA,
  CORDOVA_NAME,
  REACT_NATIVE,
  REACT_NATIVE_NAME,
  STAGING,
  PRODUCTION,
  HARMONY,
  HARMONY_NAME,
  IS_DISABLED_NO,
} from '../const'
import { sequelize } from '../utils/connections'
import { randToken } from '../utils/security'
import type { AddAppConfig, SystemType } from '@xrnjs/code-push-core'
import { NativeApps } from '../../models/native_apps'
import { getBundleOsType } from '../utils/common'
import { DeploymentsVersions } from '../../models/deployments_versions'
import { Packages, PackagesInterface } from '../../models/packages'

/**
 * 处理 bundle 名称，删除操作系统标识符及其之后的内容
 * @param bundleName 原始 bundle 名称
 * @returns 处理后的 bundle 名称
 */
export function processBundleName(bundleName: string): string {
  const osIdentifiers = ['android', 'ios', 'harmony']

  for (const os of osIdentifiers) {
    const index = bundleName.toLowerCase().indexOf(`-${os}`)
    if (index !== -1) {
      return bundleName.substring(0, index)
    }
  }

  return bundleName
}

class AppManager {
  findAppByName(uid: number, appName: string, buildType: string = 'release') {
    return Apps.findOne({
      where: { name: appName, uid, build_type: buildType },
    })
  }

  addApp(
    uid: number,
    appName: string,
    os,
    platform,
    identical: string,
    { repositoryUrl, appKey, port, deliveryType, buildType }: AddAppConfig = {},
  ) {
    return sequelize.transaction((t) => {
      return Apps.create(
        {
          name: appName,
          uid,
          os,
          platform,
          repository_url: repositoryUrl,
          native_app_key: appKey,
          port: port,
          delivery_type: deliveryType,
          build_type: buildType,
        },
        {
          transaction: t,
        },
      ).then((apps) => {
        const appId = apps.id
        const deployments = []
        let deploymentKey = randToken(28) + identical
        deployments.push({
          appid: appId,
          name: PRODUCTION,
          last_deployment_version_id: 0,
          label_id: 0,
          deployment_key: deploymentKey,
        })
        deploymentKey = randToken(28) + identical
        deployments.push({
          appid: appId,
          name: STAGING,
          last_deployment_version_id: 0,
          label_id: 0,
          deployment_key: deploymentKey,
        })
        return Promise.all([
          Collaborators.create(
            { appid: appId, uid, roles: 'Owner' },
            { transaction: t },
          ),
          Deployments.bulkCreate(deployments, { transaction: t }),
        ])
      })
    })
  }

  deleteApp(appId) {
    return sequelize.transaction((t) => {
      return Promise.all([
        Apps.destroy({ where: { id: appId }, transaction: t }),
        Collaborators.destroy({ where: { appid: appId }, transaction: t }),
        Deployments.destroy({ where: { appid: appId }, transaction: t }),
      ])
    })
  }

  modifyApp(appId, params) {
    return Apps.update(params, { where: { id: appId } }).then(
      ([affectedCount]) => {
        if (!_.gt(affectedCount, 0)) {
          throw new AppError('modify errors')
        }
        return affectedCount
      },
    )
  }

  transferApp(appId: number, fromUid: number, toUid: number) {
    return sequelize.transaction((t) => {
      return Promise.all([
        Apps.update({ uid: toUid }, { where: { id: appId }, transaction: t }),
        Collaborators.destroy({
          where: { appid: appId, uid: fromUid },
          transaction: t,
        }),
        Collaborators.destroy({
          where: { appid: appId, uid: toUid },
          transaction: t,
        }),
        Collaborators.create(
          { appid: appId, uid: toUid, roles: 'Owner' },
          { transaction: t },
        ),
      ])
    })
  }

  listApps(uid: number) {
    return Collaborators.findAll({ where: { uid } })
      .then((data) => {
        if (_.isEmpty(data)) {
          return [] as AppsInterface[]
        }
        const appIds = _.map(data, (v) => {
          return v.appid
        })
        return Apps.findAll({ where: { id: { [Op.in]: appIds } } })
      })
      .then((appInfos) => {
        const rs = Promise.all(
          _.values(appInfos).map((v) => {
            return this.getAppDetailInfo(v, uid).then((info) => {
              let os = ''
              if (info.os === IOS) {
                os = IOS_NAME
              } else if (info.os === ANDROID) {
                os = ANDROID_NAME
              } else if (info.os === WINDOWS) {
                os = WINDOWS_NAME
              } else if (info.os === HARMONY) {
                os = HARMONY_NAME
              }

              let platform = ''
              if (info.platform === REACT_NATIVE) {
                platform = REACT_NATIVE_NAME
              } else if (info.platform === CORDOVA) {
                platform = CORDOVA_NAME
              }
              return {
                ...info,
                os,
                platform,
              }
            })
          }),
        )
        return rs
      })
  }

  async updateAppInfo(uid: number, appName: string, appInfo: AddAppConfig) {
    const { appKey, repositoryUrl, port } = appInfo
    if (appKey) {
      const nativeApp = await NativeApps.findOne({ where: { app_key: appKey } })
      if (!nativeApp) {
        throw new AppError('app_key not found')
      }
    }
    return Apps.update(
      omitBy(
        {
          native_app_key: appKey,
          repository_url: repositoryUrl,
          port,
        },
        isUndefined,
      ),
      {
        where: { name: appName, uid },
      },
    ).then(([affectedCount]) => {
      if (!_.gt(affectedCount, 0)) {
        throw new AppError('update error')
      }
      return affectedCount
    })
  }

  private getAppDetailInfo(appInfo: AppsInterface, currentUid: number) {
    const appId = appInfo.get('id')
    return Promise.all([
      Deployments.findAll({ where: { appid: appId } }),
      Collaborators.findAll({ where: { appid: appId } }).then(
        (collaboratorInfos) => {
          return collaboratorInfos.reduce((prev, collaborator) => {
            return prev.then((allCol) => {
              return Users.findOne({
                where: { id: collaborator.get('uid') },
              }).then((u) => {
                let isCurrentAccount = false
                if (_.eq(u.get('id'), currentUid)) {
                  isCurrentAccount = true
                }
                allCol[u.get('email')] = {
                  permission: collaborator.get('roles'),
                  isCurrentAccount,
                }
                return allCol
              })
            })
          }, Promise.resolve({}))
        },
      ),
    ]).then(([deploymentInfos, collaborators]) => {
      return {
        collaborators,
        deployments: _.map(deploymentInfos, (item) => {
          return _.get(item, 'name')
        }),
        os: appInfo.get('os'),
        platform: appInfo.get('platform'),
        name: appInfo.get('name'),
        id: appInfo.get('id'),
      }
    })
  }

  public async getAppListByVersion(
    platform: SystemType,
    env: string, // sitxt18
    buildType: string,
    logger,
  ) {
    const bundlePlatform = getBundleOsType(platform)
    const where = {
      os: bundlePlatform,
      delivery_type: {
        [Op.in]: ['DYNAMIC', 'INNER'],
      },
      build_type: buildType,
    }

    // 测试环境有env
    if (env && !env.includes('prod')) {
      Object.assign(where, { name: { [Op.like]: `%${env}` } })
    }

    const apps = await Apps.findAll({ where })
    // 查 deployment 获取 deployment_key
    const deployments = await Deployments.findAll({
      where: {
        appid: { [Op.in]: apps.map((app) => app.id) },
        name: PRODUCTION,
      },
    })
    const deploymentsMap = new Map(
      deployments.map((deployment) => [deployment.appid, deployment]),
    )
    const result = apps.map((app) => {
      const deployment = deploymentsMap.get(app.id)
      if (!deployment) {
        return null
      }
      const processedBundleName = processBundleName(app.name)
      return {
        bundleName: processedBundleName,
        codePushName: app.name,
        deploymentKey: deployment.deployment_key,
        deliveryType: app.delivery_type,
      }
    })
    return result.filter(Boolean)
  }

  /**
   * 根据deploymenyKey查找这个bundle是否发布了第一次热更新
   * @param deploymentKey
   * @param appVersion
   */
  public async queryFirstCodepush(
    deploymentKey: string,
    appVersion: string,
  ): Promise<({ deliveryType: string } & PackagesInterface) | null> {
    const deployment = await Deployments.findOne({
      where: { deployment_key: deploymentKey },
    })

    if (!deployment) {
      return null
    }

    const app = await Apps.findOne({
      where: { id: deployment.appid },
    })

    if (!app) {
      return null
    }

    const deploymentId = deployment.id

    const deploymentVersion = await DeploymentsVersions.findOne({
      where: {
        deployment_id: deploymentId,
        app_version: appVersion,
      },
    })

    if (!deploymentVersion) {
      return null
    }

    const deploymentVersionId = deploymentVersion.id

    const _package = await Packages.findOne({
      where: {
        deployment_version_id: deploymentVersionId,
        deployment_id: deploymentId,
        is_disabled: IS_DISABLED_NO,
      },
      order: [['created_at', 'ASC']],
    })

    if (!_package) {
      return null
    }

    return { ..._package.toJSON(), deliveryType: app.delivery_type } as {
      deliveryType: string
    } & PackagesInterface
  }

  /**
   * 根据bundleName查找这个bundle是否发布了第一次热更新
   * @param bundleName
   * @param appVersion
   */
  public async queryFirstCodepushByBundleName(
    bundleName: string,
    appVersion: string,
    buildType: string = 'release',
    logger,
  ) {
    logger.info('queryFirstCodepushByBundleName', { bundleName, appVersion })
    // 根据bundleName查找app
    const app = await Apps.findOne({
      where: { name: bundleName, build_type: buildType },
    })

    if (!app) {
      return null
    }

    // 根据appid查找deployment（默认查找Production环境的）
    const deployment = await Deployments.findOne({
      where: {
        appid: app.id,
        name: PRODUCTION,
      },
    })

    if (!deployment) {
      return null
    }

    // 复用相同的查询逻辑
    return this.queryFirstCodepush(deployment.deployment_key, appVersion)
  }
}

export const appManager = new AppManager()
