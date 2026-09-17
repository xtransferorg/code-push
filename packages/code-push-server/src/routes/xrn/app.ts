import { checkToken, Req } from '../../core/middleware'
import { NativeApps } from '../../models/native_apps'
import { NativeBaseline } from '../../models/native_baseline'
import { v4 as uuid } from 'uuid'
import { AppError, ErrorCode } from '../../core/app-error'
import { NativeAppVersions } from '../../models/native_app_versions'
import { AppMeta } from '../../models/app_version_meta'
import { isUndefined, omitBy } from 'lodash'
import { Gray } from '../../core/services/gray'
import { nativeAppManager } from '../../core/services/native-app-manager'
import {
  channelMarketManager,
  MARKET_FALLBACK_CHANNEL,
} from '../../core/services/channel-market'
import { Op, WhereOptions } from 'sequelize'
import { PublishStateMachine } from './state'
import {
  aggregateVersionsByPlatform,
  autoCloseStaleRollouts,
  compareVersion,
  computeBaseline,
  filterVersionsByPublishTarget,
} from './version-aggregation'
import { Pagination } from '../../core/services/pagination'
import semver from 'semver'
import express from 'express'
import {
  BaseLineFileType,
  NativeAppPublish,
  NativeAppType,
  NativeAppVersionReviewStatus,
  NativeAppVersionStatus,
  UpdateType,
  type BuildType,
  type Environment,
  type Platform,
} from '@xrnjs/code-push-core'
import { LogReportNativeAppLogs } from '../../models/log_report_native_app_download'

export const appRouter = express.Router()

/**
 * 判断系统版本是否低于最低支持版本
 * 使用 semver.coerce 做宽松解析，任一版本号无法解析时返回 false（不拦截）
 */
function isSystemVersionLow(
  systemVersion: string,
  minVersion: string,
): boolean {
  const coercedSystem = semver.coerce(systemVersion)
  const coercedMin = semver.coerce(minVersion)
  if (!coercedSystem || !coercedMin) return false
  return semver.lt(coercedSystem, coercedMin)
}

/**
 * 走应用市场更新时，获取兜底下载链接
 * 无论客户端实际渠道是什么，走市场更新的下载链接始终使用 chinaNew 渠道下对应版本的链接，
 * 用作客户端因各种原因无法跳转应用市场时的兜底下载地址；如果没有匹配到对应版本，
 * 则返回 undefined，由调用方保留原渠道的下载链接兜底
 */
async function getMarketFallbackDownloadUrl(
  appKey: string,
  environment: string,
  versionName: string,
): Promise<string | undefined> {
  const fallbackVersion = await NativeAppVersions.findOne({
    where: {
      app_key: appKey,
      environment,
      channel: MARKET_FALLBACK_CHANNEL,
      version_name: versionName,
      status: {
        [Op.in]: ['published', 'rollout'],
      },
    },
    order: [['created_at', 'DESC']],
  })
  return fallbackVersion?.download_url
}

// APP 更新检查
appRouter.get(
  '/update_check',
  async (
    req: Req<
      any,
      any,
      {
        platform: Platform
        env: Environment
        build_number: string
        version: string
        device_id: string
        channel: string
        app_key: string
        systemVersion: string // 客户端的系统版本
      }
    >,
    _,
    next,
  ) => {
    const { logger } = req
    const {
      version = '0.0.0', // 默认0.0.0，可能历史版本没有版本号，但是需要更新
      build_number: version_number,
      device_id,
      app_key,
      systemVersion,
      env = 'prod',
    } = req.query
    let { channel } = req.query

    logger.info('update check', {
      app_key,
      version,
      device_id,
      channel,
      systemVersion,
      env,
    })

    try {
      if (!app_key || !systemVersion) {
        return next(
          new AppError(
            'app_key and systemVersion is required',
            ErrorCode.PARAMS_INVALID,
            500,
          ),
        )
      }
      const app = await NativeApps.findOne({ where: { app_key } })
      if (!app) {
        return next(new AppError('App not found', ErrorCode.NOT_FOUND, 500))
      }
      // TODO 临时处理，后续需要优化
      if (app.platform === 'iOS') {
        channel = 'appStore'
      }
      if (!channel) {
        return next(
          new AppError('channel is required', ErrorCode.PARAMS_INVALID, 500),
        )
      }
      // 获取所有版本（含灰度暂停 paused、灰度已关闭 rollout_closed，
      // paused 存量灰度用户仍需收到热更新；rollout_closed 存量用户按正式用户对待）
      const allVersions = await NativeAppVersions.findAll({
        where: omitBy(
          {
            app_key,
            environment: env,
            status: {
              [Op.in]: [
                NativeAppVersionStatus.Published,
                NativeAppVersionStatus.Rollout,
                NativeAppVersionStatus.Paused,
                NativeAppVersionStatus.RolloutClosed,
              ],
            },
            channel: channel,
          },
          isUndefined,
        ),
      })
      // 大于当前版本号
      const higherVersions = allVersions
        .filter((v) => semver.gt(v.version_name, version))
        .sort((a, b) => {
          return semver.gt(a.version_name, b.version_name) ? -1 : 1
        })

      const result = {
        app: {
          name: app.name,
          platform: app.platform,
          description: app.description,
          min_version: app.min_version,
          package_name: app.package_name,
        },
        need_update: false,
        in_gray_release: false,
        in_white_list: false,
        download_url: '',
        update_type: null,
        // 提示客户端本次更新应该走应用市场更新，还是走应用内更新（下载安装包）
        // 由请求渠道是否已在对应应用市场上架决定，与是否需要更新无关，客户端始终可用
        update_method: channelMarketManager.getUpdateMethod(channel),
        version: '',
        version_number: '',
        update_description: [],
        changelog: '',
        version_id: '',
        channel: '',
        environment: '',
        should_update_system_version: false,
      }

      // 如果没有比当前版本更高的版本，返回空结果
      if (higherVersions.length === 0) {
        return next(result)
      }

      // 对比构建版本号，取得最新的一条构建记录
      let latestVersion = higherVersions[0]

      if (
        latestVersion.status === NativeAppVersionStatus.Rollout ||
        latestVersion.status === NativeAppVersionStatus.Paused
      ) {
        // paused 仅给存量灰度用户继续投放，使用与 rollout 相同的灰度命中逻辑
        const gray = new Gray(
          device_id,
          latestVersion.rollout,
          latestVersion.white_list?.split(',') || [],
        )
        if (gray.isHit()) {
          result.in_gray_release = true
        } else {
          // 没有命中灰度，再检查是否有全量发布的版本（published 或 rollout_closed）
          const latestPublishedVersion = higherVersions
            .slice(1)
            .find(
              (v) =>
                v.status === NativeAppVersionStatus.Published ||
                v.status === NativeAppVersionStatus.RolloutClosed,
            )
          if (latestPublishedVersion) {
            // 如果有全量发布的版本，取最新的一条
            latestVersion = latestPublishedVersion
          } else {
            return next(result)
          }
        }
      }

      const updateType = await nativeAppManager.checkUpdateType(
        latestVersion.app_meta_id,
        version,
        latestVersion.update_type,
      )

      // 如果该渠道走应用市场更新，下载链接始终使用 chinaNew 渠道对应版本的链接，
      // 用作客户端因各种原因无法跳转应用市场时的兜底下载地址；
      // 如果没有走市场更新，或者没有找到对应的兜底版本，则下发该渠道自己的下载链接（老逻辑）
      let downloadUrl = latestVersion.download_url
      if (channelMarketManager.isOnMarket(channel)) {
        const marketFallbackUrl = await getMarketFallbackDownloadUrl(
          app_key,
          env,
          latestVersion.version_name,
        )
        if (marketFallbackUrl) {
          downloadUrl = marketFallbackUrl
        }
      }

      const gray = new Gray(
        device_id,
        latestVersion.rollout,
        latestVersion.white_list?.split(',') || [],
      )
      if (gray.isHitWhiteList()) {
        // 命中了白名单立马返回结果，优先级最高
        result.need_update = true
        result.in_white_list = true
        result.version = latestVersion.version_name
        result.version_number = latestVersion.version_number
        result.download_url = downloadUrl
        result.update_type = updateType
        result.version_id = latestVersion.version_id
        result.channel = latestVersion.channel
        result.environment = latestVersion.environment
        result.update_description = (latestVersion.changelog || '').split('\n')
        result.changelog = latestVersion.changelog
        if (isSystemVersionLow(systemVersion, app.min_version)) {
          result.should_update_system_version = true
        }
        return next(result)
      }

      if (latestVersion.not_only_apply_version) {
        // 如果设置了不允许特定版本收到更新，那么特定版本不需要更新
        if (semver.satisfies(version, latestVersion.not_only_apply_version)) {
          return next(result)
        }
      }

      if (latestVersion.only_apply_version) {
        // 如果设置了只有特定版本才能收到更新，那么不否和的版本不需要更新
        if (!semver.satisfies(version, latestVersion.only_apply_version)) {
          return next(result)
        }
      }

      result.need_update = true
      result.version = latestVersion.version_name
      result.version_number = latestVersion.version_number
      result.download_url = downloadUrl
      result.update_type = updateType
      result.version_id = latestVersion.version_id
      result.channel = latestVersion.channel
      result.environment = latestVersion.environment
      result.update_description = (latestVersion.changelog || '').split('\n')
      result.changelog = latestVersion.changelog
      if (isSystemVersionLow(systemVersion, app.min_version)) {
        result.should_update_system_version = true
      }

      return next(result)
    } catch (error) {
      return next(new AppError(error, ErrorCode.QUERY_ERROR, 500))
    }
  },
)

// APP 查询
appRouter.get(
  '/query_app/:app_key',
  async (req: Req<{ app_key: string }>, _, next) => {
    const { app_key } = req.params
    try {
      const app = await NativeApps.findOne({ where: { app_key } })
      return next(app)
    } catch (error) {
      return next(new AppError(error, ErrorCode.NOT_FOUND, 500))
    }
  },
)

// APP 版本查询
appRouter.get(
  '/query_version/:environment/:app_key/:version_id?',
  async (
    req: Req<
      {
        environment: Environment
        app_key: string
        version_id: string
      },
      {},
      {
        page: number
        limit: number
        version_name: string
        build_type: BuildType
        channel: string
        app_format: string
        update_type: UpdateType
        status: NativeAppVersionStatus
      }
    >,
    _,
    next,
  ) => {
    const { logger } = req
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || 10
    const {
      version_name,
      build_type,
      channel,
      update_type,
      status,
      app_format,
    } = req.query
    const { version_id, app_key } = req.params
    let environment = req.params.environment

    logger.info('query version', {
      app_key,
      version_id,
      environment,
      channel,
      update_type,
      status,
      app_format,
    })

    try {
      const app = await NativeApps.findOne({ where: { app_key } })
      if (!app) {
        return next(new AppError('App not found', ErrorCode.NOT_FOUND, 500))
      }
      if (version_id) {
        const version = await NativeAppVersions.findOne({
          where: { version_id, environment },
        })
        return next(new Pagination([version], limit, page, 1))
      } else {
        const whereQuery: WhereOptions = omitBy(
          {
            app_key,
            environment,
            version_name,
            build_type,
            channel,
            update_type,
            status,
            app_format,
          },
          isUndefined,
        )
        const environments = {
          prod: 'prod',
          pre: 'pre',
        }
        if (environments[environment]) {
          whereQuery.environment = environments[environment]
        } else {
          if (environment === 'dev') {
            whereQuery.environment = {
              [Op.not]: ['prod', 'pre'],
            }
          }
        }
        const versions = await NativeAppVersions.findAll({
          where: whereQuery,
          order: [['version_number', 'DESC']],
          offset: (page - 1) * limit,
          limit,
        })
        const total = await NativeAppVersions.count({
          where: whereQuery,
        })

        return next(new Pagination(versions, page, limit, total))
      }
    } catch (error) {
      return next(new AppError(error, ErrorCode.NOT_FOUND, 500))
    }
  },
)

// 需要权限校验
// APP 发布
appRouter.post(
  '/publish',
  checkToken,
  async (req: Req<Record<string, string>, NativeAppPublish>, _, next) => {
    const { logger, body } = req
    const {
      app_key,
      download_url,
      version_name,
      rollout,
      is_backward_compatible,
      white_list,
      build_type,
      update_type,
      changelog,
      environment = 'dev',
      channel,
      status,
      version_number,
      app_format,
      package_size = 0,
      only_apply_version,
      not_only_apply_version,
      download_url_arm32,
      download_url_arm64,
      platform,
    } = body
    const nativeApp = await NativeApps.findOne({ where: { app_key } })

    logger.info('publish app', {
      app_key,
      download_url,
      version_name,
      rollout,
      is_backward_compatible,
      white_list,
      build_type,
      update_type,
      changelog,
      environment,
      channel,
      version_number,
      only_apply_version,
      app_format,
      package_size,
      not_only_apply_version,
      download_url_arm32,
      download_url_arm64,
    })

    if (only_apply_version && not_only_apply_version) {
      return next(
        new AppError(
          'only_apply_version and not_only_apply_version cannot be set at the same time',
          ErrorCode.PARAMS_INVALID,
          500,
        ),
      )
    }

    if (!nativeApp) {
      return next(
        new AppError(
          `App not found: ${app_key}`,
          ErrorCode.PARAMS_INVALID,
          500,
        ),
      )
    }
    try {
      if (environment === 'prod') {
        const previousVersion = await NativeAppVersions.findOne({
          where: {
            app_key,
            channel,
            environment: 'prod',
            status: { [Op.not]: 'discarded' },
            app_format,
          },
          order: [['created_at', 'DESC']],
        })
        // 获取上一个生产环境的版本：
        // - published 需要 rollout=100
        // - paused 不要求 rollout=100
        // （并且发布的版本和当前最新的版本不是同一个版本）
        const isPreviousVersionReadyForNextPublish =
          previousVersion?.status === NativeAppVersionStatus.Paused ||
          (previousVersion?.status === NativeAppVersionStatus.Published &&
            previousVersion.rollout === 100)
        if (
          previousVersion &&
          previousVersion.version_name !== version_name &&
          !isPreviousVersionReadyForNextPublish
        ) {
          return next(
            new AppError(
              'Previous version must be paused, or published with rollout=100%',
              ErrorCode.PUBLISH_FAILED,
              400,
            ),
          )
        }
      }
      const prevVersion = await NativeAppVersions.findOne({
        where: { app_key, version_name, channel, environment, app_format },
      })
      if (prevVersion) {
        // 状态未发布或者灰度流量为0的版本可以更新
        if (
          [
            NativeAppVersionStatus.ReadyForReview,
            NativeAppVersionStatus.PendingReview,
          ].includes(prevVersion.status) ||
          (prevVersion.status === NativeAppVersionStatus.Rollout &&
            prevVersion.rollout === 0) ||
          // 测试环境定时构建会将生产稳定版本同步到测试环境，此时 status 会带入生产的状态值
          // （如 published 等），不满足上方的未发布条件，需跳过此校验以允许版本信息正常更新
          environment !== 'prod'
        ) {
          // 版本号和版本名称以及渠道环境重复，并且状态还是未发布的，应该更新
          await prevVersion.update(
            omitBy(
              {
                download_url,
                rollout,
                is_backward_compatible,
                white_list,
                status,
                build_type,
                update_type,
                changelog,
                version_number,
                only_apply_version,
                app_format,
                package_size,
                download_url_arm32,
                download_url_arm64,
              },
              isUndefined,
            ),
          )
          return next(await prevVersion.reload())
        } else {
          return next(
            new AppError(
              'Version already exists and status is not ready_for_review or pending_review or rollout is not 0',
              ErrorCode.PUBLISH_FAILED,
              500,
            ),
          )
        }
      }
      // 查询或创建app_version_meta记录
      const appMeta = await AppMeta.findOne({
        where: {
          platform,
          version_name,
          app_type: build_type,
        },
      })

      if (!appMeta) {
        return next(
          new AppError('App meta not found', ErrorCode.NOT_FOUND, 500),
        )
      }

      const data = await NativeAppVersions.create({
        app_key,
        version_id: uuid(),
        version_number,
        version_name,
        download_url,
        rollout,
        is_backward_compatible,
        white_list,
        status:
          environment === 'prod'
            ? NativeAppVersionStatus.ReadyForReview // 生产环境在发布的时候强制为待审核状态
            : status,
        build_type: build_type || 'release',
        update_type: update_type || 'Force',
        environment: environment || 'dev',
        changelog,
        channel,
        only_apply_version,
        not_only_apply_version,
        app_format,
        package_size,
        download_url_arm32,
        download_url_arm64,
        app_meta_id: appMeta.id,
      })
      return next(data)
    } catch (error) {
      return next(new AppError(error, ErrorCode.PUBLISH_FAILED, 500))
    }
  },
)

// 已经发布的版本，只允许更新 changelog、rollout、white_list、update_type、is_backward_compatible、status
appRouter.patch(
  '/update_publish',
  checkToken,
  async (
    req: Req<
      Record<string, string>,
      {
        version_id: string
        rollout: number
        is_backward_compatible: boolean
        status: NativeAppVersionStatus
        white_list?: string
        update_type?: UpdateType
        changelog?: string
        only_apply_version?: string
        not_only_apply_version?: string
      }
    >,
    _,
    next,
  ) => {
    const {
      version_id,
      rollout,
      is_backward_compatible,
      white_list,
      update_type,
      changelog,
      only_apply_version,
      not_only_apply_version,
    } = req.body
    let { status } = req.body
    const currentVersion = await NativeAppVersions.findOne({
      where: { version_id },
    })
    if (!currentVersion) {
      return next(new AppError('Version not found', ErrorCode.NOT_FOUND, 500))
    }
    if (
      currentVersion.status !== NativeAppVersionStatus.Rollout &&
      status !== NativeAppVersionStatus.Rollout &&
      typeof rollout === 'number'
    ) {
      // 只有灰度流量状态下才能更新灰度流量
      return next(
        new AppError(
          'Rollout can only be updated when status is rollout',
          ErrorCode.UPDATE_ERROR,
          500,
        ),
      )
    }
    if (
      currentVersion.status === NativeAppVersionStatus.Rollout &&
      rollout === 0
    ) {
      // 灰度中将流量调整为 0，自动流转为 Paused
      status = NativeAppVersionStatus.Paused
    }
    const stateMachine = new PublishStateMachine(
      currentVersion.status,
      currentVersion.rollout,
    )
    if (status && !stateMachine.transitionTo(status, rollout)) {
      return next(
        new AppError(
          `Invalid state transition: ${currentVersion.status} -> ${status}`,
          ErrorCode.UPDATE_ERROR,
          500,
        ),
      )
    }
    try {
      await NativeAppVersions.update(
        omitBy(
          {
            rollout,
            is_backward_compatible,
            white_list,
            status,
            update_type,
            changelog,
            only_apply_version,
            not_only_apply_version,
          },
          isUndefined,
        ),
        {
          where: { version_id },
        },
      )
      const updated = await currentVersion.reload()

      return next(updated)
    } catch (error) {
      return next(new AppError(error, ErrorCode.UPDATE_ERROR, 500))
    }
  },
)

appRouter.post(
  '/log',
  async (
    req: Req<
      Record<string, string>,
      {
        version_id: string
        device_model: string
        device_version: string
        screen_resolution: string
        device_info: string
        client_version: string
        user_id: string
      }
    >,
    _,
    next,
  ) => {
    const {
      version_id,
      device_model,
      device_version,
      screen_resolution,
      device_info,
      client_version,
      user_id,
    } = req.body
    try {
      const data = await LogReportNativeAppLogs.create({
        version_key: version_id,
        client_version: client_version,
        device_model: device_model,
        device_version: device_version,
        screen_resolution: screen_resolution,
        user_id: user_id,
        device_info: device_info,
      })
      return next(data.toJSON())
    } catch (error) {
      return next(new AppError(error, ErrorCode.LOG_ERROR, 500))
    }
  },
)

// 查询最新灰度或稳定版本的发布记录
appRouter.get(
  '/get_latest_release',
  async (
    req: Req<
      Record<string, string>,
      {},
      {
        coreVersion: string
        platform: string
        appType?: NativeAppType
        environment?: string
      }
    >,
    res,
    next,
  ) => {
    const { logger, query } = req
    const {
      coreVersion,
      platform,
      appType = NativeAppType.RELEASE,
      environment,
    } = query

    logger.info('get latest release', {
      coreVersion,
      platform,
      appType,
    })

    try {
      // 验证必要参数
      if (!platform) {
        return next(
          new AppError('platform is required', ErrorCode.PARAMS_INVALID, 400),
        )
      }

      const whereCondition = {
        platform: {
          [Op.eq]: platform,
        },
        app_type: appType,
      }

      const majorVersion = coreVersion ? semver.parse(coreVersion)?.major : null

      if (majorVersion) {
        Object.assign(whereCondition, {
          core_version: {
            [Op.like]: `${majorVersion}.%`,
          },
        })
      }

      const meta = await AppMeta.findAll({
        where: whereCondition,
        order: [['created_at', 'DESC']],
      })

      if (!meta.length) {
        return res.json({
          code: 0,
          message: 'success',
          data: null,
        })
      }

      const result = meta.sort((a, b) => {
        return semver.compare(b.version_name, a.version_name)
      })

      return next(result[0])
    } catch (error) {
      return next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.QUERY_ERROR, 500),
      )
    }
  },
)

// 查询基线元数据列表
appRouter.get(
  '/get_app_meta_list',
  async (
    req: Req<
      Record<string, string>,
      {},
      {
        platform: string
        appType?: NativeAppType
      }
    >,
    res,
    next,
  ) => {
    const { logger, query } = req
    const { platform, appType = NativeAppType.RELEASE } = query

    logger.info('get app meta list', {
      platform,
      appType,
    })

    try {
      // 验证必要参数
      if (!platform) {
        return next(
          new AppError('platform is required', ErrorCode.PARAMS_INVALID, 400),
        )
      }

      const whereCondition = {
        platform: {
          [Op.eq]: platform,
        },
        app_type: appType,
      }

      const meta = await AppMeta.findAll({
        where: whereCondition,
        order: [['created_at', 'DESC']],
      })

      // 获取所有 meta_id
      const metaIds = meta.map((m) => m.id)

      // 查询 NativeBaseline 中 file_type 为 COMMON 的记录
      const baselines = metaIds.length
        ? await NativeBaseline.findAll({
            where: {
              app_meta_id: { [Op.in]: metaIds },
              file_type: BaseLineFileType.COMMON,
            },
          })
        : []

      // 构建 app_meta_id 到 common_hash 的映射
      const commonHashMap = new Map(
        baselines.map((b) => [b.app_meta_id, b.file_hash]),
      )

      const sortedMeta = meta.sort((a, b) => {
        return semver.compare(b.version_name, a.version_name)
      })

      // 添加 common_hash 到结果中
      const result = sortedMeta.map((m) => ({
        ...m.toJSON(),
        common_hash: commonHashMap.get(m.id) || null,
      }))

      return next(result)
    } catch (error) {
      return next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.QUERY_ERROR, 500),
      )
    }
  },
)

appRouter.post(
  '/market_review_passed',
  async (
    req: Req<{ versionId: string; reviewStatus: NativeAppVersionReviewStatus }>,
    res,
    next,
  ) => {
    const { versionId, reviewStatus } = req.body
    try {
      const version = await NativeAppVersions.findOne({
        where: { version_id: versionId },
      })

      if (!version) {
        return next(new AppError('Version not found', ErrorCode.NOT_FOUND, 500))
      }

      // 状态转换规则：
      // 0/null (未审核) -> 1 (审核通过) -> 2 (已发布)
      const currentStatus = version.review_passed || 0

      if (reviewStatus === NativeAppVersionReviewStatus.AUDIT_PASSED) {
        // 只能从未审核状态(0/null)变更为审核通过(1)
        if (currentStatus === 0) {
          version.review_passed = NativeAppVersionReviewStatus.AUDIT_PASSED
        }
      } else if (reviewStatus === NativeAppVersionReviewStatus.RELEASED) {
        // 只能从审核通过状态(1)变更为已发布(2)
        if (currentStatus === NativeAppVersionReviewStatus.AUDIT_PASSED) {
          version.review_passed = NativeAppVersionReviewStatus.RELEASED
        }
      }
      await version.save()
      return next(true)
    } catch (error) {
      return next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.UPDATE_ERROR, 500),
      )
    }
  },
)
appRouter.post(
  '/get_build_list',
  async (req: Req<{ versionIds: string[] }>, res, next) => {
    const { versionIds = [] } = req.body
    try {
      if (!versionIds.length) {
        return next([])
      }
      const builds = await NativeAppVersions.findAll({
        where: { version_id: { [Op.in]: versionIds } },
      })

      const result = builds.map((build) => {
        const downloadUrls = [
          build.download_url,
          build.download_url_arm32,
          build.download_url_arm64,
        ].filter(Boolean)

        return {
          id: build.id,
          appKey: build.app_key,
          versionId: build.version_id,
          versionName: build.version_name,
          versionNumber: build.version_number,
          buildType: build.build_type,
          updateType: build.update_type,
          appFormat: build.app_format,
          packageSize: build.package_size,
          channelName: build.channel,
          downloadUrls,
          createdAt: build.created_at,
        }
      })

      return next(result)
    } catch (error) {
      return next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.QUERY_ERROR, 500),
      )
    }
  },
)

// 获取 NativeAppVersions 数据列表，关联 app_meta 表
appRouter.get(
  '/get_native_app_versions',
  async (
    req: Req<
      Record<string, string>,
      {},
      {
        platform: string
        channel?: string
        build_type: BuildType
        app_format: string
        version_name?: string
        name?: string
      }
    >,
    res,
    next,
  ) => {
    const { logger, query } = req
    const {
      platform,
      channel,
      build_type,
      app_format,
      version_name,
      name = 'XTransfer',
    } = query

    logger.info('get native app versions', {
      platform,
      channel,
      build_type,
      app_format,
      version_name,
      name,
    })

    try {
      // 验证必要参数
      if (!platform || !build_type || !app_format) {
        return next(
          new AppError(
            'platform, build_type and app_format are required',
            ErrorCode.PARAMS_INVALID,
            400,
          ),
        )
      }

      // native_apps 中 platform/app_type 存储为首字母大写格式，需要兼容请求参数全小写的情况
      const normalizedPlatformMap: Record<string, string> = {
        ios: 'iOS',
        android: 'Android',
        harmony: 'Harmony',
      }
      const normalizedAppTypeMap: Record<string, string> = {
        debug: 'Debug',
        release: 'Release',
      }
      const normalizedPlatform =
        normalizedPlatformMap[platform.toLowerCase()] || platform
      const normalizedAppType =
        normalizedAppTypeMap[String(build_type).toLowerCase()] || build_type

      const nativeApp = await NativeApps.findOne({
        where: {
          platform: normalizedPlatform,
          name,
          app_type: normalizedAppType,
        },
      })

      if (!nativeApp) {
        return next([])
      }

      // build_type/app_format/version_name 为筛选参数；channel 不传时查询全部渠道
      // 构建查询条件，默认不查出 discarded 的数据
      const whereCondition: WhereOptions = omitBy(
        {
          app_key: nativeApp.app_key,
          channel,
          build_type,
          app_format,
          version_name,
          status: {
            [Op.ne]: NativeAppVersionStatus.Discarded,
          },
        },
        isUndefined,
      )

      // 查询 NativeAppVersions
      const versions = await NativeAppVersions.findAll({
        where: whereCondition,
        order: [['created_at', 'DESC']],
      })

      if (!versions.length) {
        return next([])
      }

      // 获取所有的 app_meta_id
      const appMetaIds = [
        ...new Set(versions.map((v) => v.app_meta_id).filter(Boolean)),
      ]

      // 查询关联的 AppMeta 数据
      const appMetas = appMetaIds.length
        ? await AppMeta.findAll({
            where: {
              id: { [Op.in]: appMetaIds },
              platform,
            },
          })
        : []

      // 构建 app_meta_id 到 AppMeta 的映射
      const appMetaMap = new Map(appMetas.map((meta) => [meta.id, meta]))

      // 合并数据：
      // 1) 保留 app_meta_id 为空的历史记录，app_meta 返回 null
      // 2) app_meta_id 存在时，仅返回 platform 匹配的记录
      const result = versions
        .filter((version) => {
          if (!version.app_meta_id) return true
          const meta = appMetaMap.get(version.app_meta_id)
          return meta && meta.platform === platform
        })
        .map((version) => ({
          ...version.toJSON(),
          app_meta: version.app_meta_id
            ? appMetaMap.get(version.app_meta_id)?.toJSON() || null
            : null,
        }))

      return next(result)
    } catch (error) {
      return next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.QUERY_ERROR, 500),
      )
    }
  },
)

/**
 * GET /xrn/app/app-versions
 * 按 platform + publishTarget 返回过滤后的版本列表，含 latestRelease / latestGray / minOfficialVersion / minGrayVersion。
 * Captain 自动填充发布版本号下拉项时调用。
 */
appRouter.get(
  '/app-versions',
  async (
    req: Req<
      Record<string, string>,
      {},
      {
        platform: string
        publishTarget: 'official' | 'gray' | 'review'
        environment?: string
      }
    >,
    _,
    next,
  ) => {
    const { platform, publishTarget, environment = 'prod' } = req.query
    if (!platform || !publishTarget) {
      return next(
        new AppError(
          'platform and publishTarget are required',
          ErrorCode.PARAMS_INVALID,
          400,
        ),
      )
    }
    if (
      publishTarget !== 'official' &&
      publishTarget !== 'gray' &&
      publishTarget !== 'review'
    ) {
      return next(
        new AppError(
          'publishTarget must be official, gray or review',
          ErrorCode.PARAMS_INVALID,
          400,
        ),
      )
    }
    try {
      const aggregates = await aggregateVersionsByPlatform({
        platform,
        environment,
      })
      const baseline = computeBaseline(aggregates)

      // latestRelease 无 minSupportedVersion 时视为无下限，记录 warning
      if (baseline.latestRelease && !baseline.minOfficialVersion) {
        req.logger?.warn?.(
          'latestRelease has no minSupportedVersion, treat as no lower bound',
          { platform, latestRelease: baseline.latestRelease },
        )
      }

      const versions = filterVersionsByPublishTarget(
        aggregates,
        baseline,
        publishTarget,
      )
        .map((v) => ({
          version: v.versionName,
          status: v.status,
          type: publishTarget as 'official' | 'gray' | 'review',
          minSupportedVersion: v.minSupportedVersion ?? null,
        }))
        .sort((a, b) => compareVersion(a.version, b.version))

      return next({
        versions,
        latestRelease: baseline.latestRelease,
        latestGray: baseline.latestGray,
        minOfficialVersion: baseline.minOfficialVersion,
        minGrayVersion: baseline.minGrayVersion,
      })
    } catch (error) {
      return next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.QUERY_ERROR, 500),
      )
    }
  },
)

/**
 * POST /xrn/app/validate-version
 * 预发流水线「原生版本校验」节点调用，双向校验目标版本列表合法性。
 *
 * 校验步骤：
 *  ① bundle core 包 major 版本一致性
 *  ② core 包版本与 App 基线 core 包兼容（暂以一致性近似）
 *  ③ 目标版本不低于 minOfficialVersion / minGrayVersion（review 目标不校验）
 *  ④ 目标版本列表 vs 有效版本列表（review 目标只校验"多选"，不校验"漏选"）
 */
appRouter.post(
  '/validate-version',
  async (
    req: Req<
      Record<string, string>,
      {
        platform: string
        publishTarget: 'official' | 'gray' | 'review'
        environment?: string
        targetVersions: string[]
        bundles?: { name: string; coreVersion: string }[]
      }
    >,
    _,
    next,
  ) => {
    const {
      platform,
      publishTarget,
      environment = 'prod',
      targetVersions = [],
      bundles = [],
    } = req.body

    if (!platform || !publishTarget) {
      return next(
        new AppError(
          'platform and publishTarget are required',
          ErrorCode.PARAMS_INVALID,
          400,
        ),
      )
    }
    if (
      publishTarget !== 'official' &&
      publishTarget !== 'gray' &&
      publishTarget !== 'review'
    ) {
      return next(
        new AppError(
          'publishTarget must be official, gray or review',
          ErrorCode.PARAMS_INVALID,
          400,
        ),
      )
    }

    const results: {
      version: string
      passed: boolean
      reason:
        | 'OK'
        | 'CORE_VERSION_MISMATCH'
        | 'OUT_OF_COMPATIBLE_RANGE'
        | 'BELOW_MIN_SUPPORTED_VERSION'
        | 'VERSION_LIST_MISMATCH'
      message: string | null
    }[] = []

    // ① bundle core 包 major 版本一致性校验
    if (bundles.length > 1) {
      const majors = new Set<string>()
      for (const b of bundles) {
        const c = semver.coerce(b.coreVersion)
        majors.add(c ? String(c.major) : b.coreVersion)
      }
      if (majors.size > 1) {
        const offending = bundles
          .map((b) => `${b.name}@${b.coreVersion}`)
          .join(', ')
        for (const v of targetVersions) {
          results.push({
            version: v,
            passed: false,
            reason: 'CORE_VERSION_MISMATCH',
            message: `bundle core major version mismatch: ${offending}`,
          })
        }
        return next({ passed: false, missingVersions: [], results })
      }
    }

    try {
      const aggregates = await aggregateVersionsByPlatform({
        platform,
        environment,
      })
      const baseline = computeBaseline(aggregates)

      const appMetaIds = Array.from(
        new Set(aggregates.map((a) => a.appMetaId).filter(Boolean) as number[]),
      )
      const appMetas = appMetaIds.length
        ? await AppMeta.findAll({ where: { id: { [Op.in]: appMetaIds } } })
        : []
      const appMetaMap = new Map(appMetas.map((m) => [m.id, m]))

      const validVersions = filterVersionsByPublishTarget(
        aggregates,
        baseline,
        publishTarget,
      ).map((v) => v.versionName)
      const aggMap = new Map(aggregates.map((a) => [a.versionName, a]))

      const bundleCoreMajor = bundles.length
        ? semver.coerce(bundles[0].coreVersion)?.major ?? null
        : null

      let minBound: string | null
      if (publishTarget === 'official') {
        minBound = baseline.minOfficialVersion
      } else if (publishTarget === 'gray') {
        minBound = baseline.minGrayVersion
      } else {
        minBound = null
      }

      // ③ 单个版本：低于 minSupportedVersion → 失败
      const targetSet = new Set(targetVersions)
      const validSet = new Set(validVersions)

      for (const v of targetVersions) {
        // ② 目标版本 app_meta.core_version major 与 bundle core major 一致
        if (bundleCoreMajor !== null) {
          const agg = aggMap.get(v)
          const appMeta = agg?.appMetaId ? appMetaMap.get(agg.appMetaId) : null
          const appMetaCoreMajor = appMeta?.core_version
            ? semver.coerce(appMeta.core_version)?.major ?? null
            : null

          if (appMetaCoreMajor !== null && appMetaCoreMajor !== bundleCoreMajor) {
            results.push({
              version: v,
              passed: false,
              reason: 'OUT_OF_COMPATIBLE_RANGE',
              message: `版本 ${v} 的 app_meta core major=${appMetaCoreMajor}，与 bundle core major=${bundleCoreMajor} 不一致`,
            })
            continue
          }
        }

        if (minBound && compareVersion(v, minBound) < 0) {
          results.push({
            version: v,
            passed: false,
            reason: 'BELOW_MIN_SUPPORTED_VERSION',
            message: `版本 ${v} 低于最小支持版本 ${minBound}，该版本用户已被强制升级原生包`,
          })
          continue
        }
        if (!validSet.has(v)) {
          const agg = aggMap.get(v)
          results.push({
            version: v,
            passed: false,
            reason: 'VERSION_LIST_MISMATCH',
            message: agg
              ? `版本 ${v}（status=${agg.status}）不在当前 ${publishTarget} 候选列表中`
              : `版本 ${v} 不在当前 ${publishTarget} 候选列表中`,
          })
          continue
        }
        results.push({ version: v, passed: true, reason: 'OK', message: null })
      }

      // ④ 双向比对（review 目标跳过 missingVersions 校验，允许只勾选部分审核中版本）
      const missingVersions: string[] = []
      if (publishTarget !== 'review') {
        for (const v of validVersions) {
          if (!targetSet.has(v)) missingVersions.push(v)
        }
      }

      const allPassed =
        results.every((r) => r.passed) && missingVersions.length === 0

      if (!allPassed && missingVersions.length) {
        for (const v of missingVersions) {
          results.push({
            version: v,
            passed: false,
            reason: 'VERSION_LIST_MISMATCH',
            message: `版本 ${v} 为有效候选但未被勾选`,
          })
        }
      }

      return next({
        passed: allPassed,
        missingVersions,
        results,
      })
    } catch (error) {
      return next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.QUERY_ERROR, 500),
      )
    }
  },
)

/**
 * POST /xrn/app/pre-validate-version
 * Captain 创建 / 提交发布单阶段的轻量预校验，仅执行步骤④双向比对，
 * 不依赖 bundle 信息，便于前端实时提示发布人员漏选 / 多选。
 *
 * 入参：platform、publishTarget、targetVersions
 * 出参：passed / missingVersions / unexpectedVersions / validVersions
 *
 * validVersions 与 GET /app-versions 在相同 platform + publishTarget 下返回的
 * versions[].version 集合保持一致，便于前端一键回填。
 */
appRouter.post(
  '/pre-validate-version',
  async (
    req: Req<
      Record<string, string>,
      {
        platform: string
        publishTarget: 'official' | 'gray' | 'review'
        environment?: string
        targetVersions: string[]
      }
    >,
    _,
    next,
  ) => {
    const {
      platform,
      publishTarget,
      environment = 'prod',
      targetVersions = [],
    } = req.body

    if (!platform || !publishTarget) {
      return next(
        new AppError(
          'platform and publishTarget are required',
          ErrorCode.PARAMS_INVALID,
          400,
        ),
      )
    }
    if (
      publishTarget !== 'official' &&
      publishTarget !== 'gray' &&
      publishTarget !== 'review'
    ) {
      return next(
        new AppError(
          'publishTarget must be official, gray or review',
          ErrorCode.PARAMS_INVALID,
          400,
        ),
      )
    }

    try {
      const aggregates = await aggregateVersionsByPlatform({
        platform,
        environment,
      })
      const baseline = computeBaseline(aggregates)

      const validVersions = filterVersionsByPublishTarget(
        aggregates,
        baseline,
        publishTarget,
      )
        .map((v) => v.versionName)
        .sort(compareVersion)

      const validSet = new Set(validVersions)
      const targetSet = new Set(targetVersions)

      // 勾选了但不在候选集
      const unexpectedVersions: string[] = []
      for (const v of targetVersions) {
        if (!validSet.has(v)) unexpectedVersions.push(v)
      }

      // 候选集中未被勾选（review 跳过漏选校验）
      const missingVersions: string[] = []
      if (publishTarget !== 'review') {
        for (const v of validVersions) {
          if (!targetSet.has(v)) missingVersions.push(v)
        }
      }

      const passed =
        unexpectedVersions.length === 0 && missingVersions.length === 0

      return next({
        passed,
        missingVersions,
        unexpectedVersions,
        validVersions,
      })
    } catch (error) {
      return next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.QUERY_ERROR, 500),
      )
    }
  },
)

/**
 * POST /xrn/app/set-published
 * App 发布单流水线 bundle 合入 master 节点后调用。
 * 将目标 App 版本所有渠道状态从 rollout / paused 流转为 published。
 */
appRouter.post(
  '/set-published',
  checkToken,
  async (
    req: Req<
      Record<string, string>,
      {
        version_id?: string
        platform?: string
        version_name?: string
        environment?: string
      }
    >,
    _,
    next,
  ) => {
    const {
      version_id,
      platform,
      version_name,
      environment = 'prod',
    } = req.body
    if (!version_id && !(platform && version_name)) {
      return next(
        new AppError(
          'version_id or (platform + version_name) is required',
          ErrorCode.PARAMS_INVALID,
          400,
        ),
      )
    }

    try {
      let rows
      if (version_id) {
        rows = await NativeAppVersions.findAll({ where: { version_id } })
      } else {
        // 按 platform + version_name 找到所有匹配渠道
        const aggregates = await aggregateVersionsByPlatform({
          platform: platform!,
          environment,
        })
        const target = aggregates.find((a) => a.versionName === version_name)
        if (!target || !target.appMetaId) {
          return next({ updated: [], skipped: [] })
        }
        const metas = await AppMeta.findAll({
          where: { platform: platform!, version_name: version_name! },
        })
        const metaIds = metas.map((m) => m.id)
        if (!metaIds.length) return next({ updated: [], skipped: [] })
        rows = await NativeAppVersions.findAll({
          where: {
            environment,
            version_name: version_name!,
            app_meta_id: { [Op.in]: metaIds },
          },
        })
      }

      const updated: string[] = []
      const skipped: { versionId: string; status: string }[] = []

      const resolvedPlatform =
        platform ||
        (rows[0]?.app_meta_id
          ? (await AppMeta.findOne({ where: { id: rows[0].app_meta_id } }))
              ?.platform
          : undefined)

      const platformAggregates = resolvedPlatform
        ? await aggregateVersionsByPlatform({
            platform: resolvedPlatform,
            environment,
          })
        : null

      const scopedMetaIds = platformAggregates
        ? Array.from(
            new Set(
              platformAggregates
                .map((a) => a.appMetaId)
                .filter(Boolean) as number[],
            ),
          )
        : []

      const resolvedBaseline = platformAggregates
        ? computeBaseline(platformAggregates)
        : null

      // 在执行 rollout -> published 流转之前先触发 paused -> rollout_closed 自动流转。
      // 一旦目标版本进入 published，latestGray 会发生变化，使得本应被关闭的 paused
      // 版本不再满足 latestRelease < v < latestGray 的条件而被漏掉，所以必须前置。
      try {
        if (resolvedPlatform && platformAggregates) {
          await autoCloseStaleRollouts({
            platform: resolvedPlatform,
            environment,
            aggregates: platformAggregates,
            logger: req.logger,
          })
        }
      } catch (err) {
        req.logger?.warn?.('autoCloseStaleRollouts failed', err)
      }

      for (const row of rows) {
        // 边界场景：当某环境尚无正式版时，第一个 paused 版本不能直接 published，需先收敛为 rollout_closed。
        if (
          row.status === NativeAppVersionStatus.Paused &&
          !resolvedBaseline?.latestRelease
        ) {
          const pausedSm = new PublishStateMachine(row.status, row.rollout)
          if (
            pausedSm.transitionTo(
              NativeAppVersionStatus.RolloutClosed,
              row.rollout,
            )
          ) {
            await NativeAppVersions.update(
              { status: NativeAppVersionStatus.RolloutClosed },
              { where: { version_id: row.version_id } },
            )
            updated.push(row.version_id)
          } else {
            skipped.push({ versionId: row.version_id, status: row.status })
          }
          continue
        }

        const sm = new PublishStateMachine(row.status, row.rollout)
        if (
          sm.transitionTo(
            NativeAppVersionStatus.Published,
            Math.max(row.rollout, 100),
          )
        ) {
          await NativeAppVersions.update(
            { status: NativeAppVersionStatus.Published, rollout: 100 },
            { where: { version_id: row.version_id } },
          )
          updated.push(row.version_id)
        } else {
          skipped.push({ versionId: row.version_id, status: row.status })
        }
      }

      // 边界场景补充：当本次是该环境首个正式版（此前 latestRelease 为空），且目标由 rollout -> published，
      // 需要把同平台中低于目标版本的 paused 一并收敛为 rollout_closed。
      if (!resolvedBaseline?.latestRelease && scopedMetaIds.length) {
        const targetVersion = rows[0]?.version_name
        if (targetVersion) {
          const lowerPausedRows = await NativeAppVersions.findAll({
            where: {
              environment,
              app_meta_id: { [Op.in]: scopedMetaIds },
              status: NativeAppVersionStatus.Paused,
            },
          })

          const lowerVersionIds = lowerPausedRows
            .filter(
              (row) => compareVersion(row.version_name, targetVersion) < 0,
            )
            .map((row) => row.version_id)
          if (lowerVersionIds.length) {
            await NativeAppVersions.update(
              { status: NativeAppVersionStatus.RolloutClosed },
              { where: { version_id: { [Op.in]: lowerVersionIds } } },
            )
          }
        }
      }

      return next({ updated, skipped })
    } catch (error) {
      return next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.UPDATE_ERROR, 500),
      )
    }
  },
)

/**
 * POST /xrn/app/change-status
 * 统一的原生版本状态变更入口，取代原 app-rollout job 的状态变更能力。
 * 同一 (platform, version_name) 下所有渠道一并流转；任意渠道的流转不合法整体失败并回滚。
 * 服务端依状态机校验合法性（参见方案 3.2 状态流转图）。
 */
appRouter.post(
  '/change-status',
  checkToken,
  async (
    req: Req<
      Record<string, string>,
      {
        version_id: string
        target_status: NativeAppVersionStatus
      }
    >,
    _,
    next,
  ) => {
    const { version_id, target_status } = req.body
    if (!version_id || !target_status) {
      return next(
        new AppError(
          'version_id and target_status are required',
          ErrorCode.PARAMS_INVALID,
          400,
        ),
      )
    }

    const allowedStatuses = new Set<string>([
      NativeAppVersionStatus.MarketApproved,
      NativeAppVersionStatus.Rollout,
      NativeAppVersionStatus.Paused,
      NativeAppVersionStatus.RolloutClosed,
      NativeAppVersionStatus.Discarded,
    ])
    if (!allowedStatuses.has(target_status)) {
      return next(
        new AppError(
          `target_status must be one of: ${Array.from(allowedStatuses).join(', ')}`,
          ErrorCode.PARAMS_INVALID,
          400,
        ),
      )
    }

    try {
      const current = await NativeAppVersions.findOne({
        where: { version_id },
      })
      if (!current) {
        return next(
          new AppError('Version not found', ErrorCode.NOT_FOUND, 404),
        )
      }

      const sm = new PublishStateMachine(current.status, current.rollout)
      const nextRollout =
        target_status === NativeAppVersionStatus.Paused ? 0 : current.rollout
      if (!sm.transitionTo(target_status, nextRollout)) {
        return next(
          new AppError(
            `Invalid state transition: ${current.status} -> ${target_status}`,
            ErrorCode.UPDATE_ERROR,
            400,
          ),
        )
      }

      await NativeAppVersions.update(
        {
          status: target_status,
          ...(target_status === NativeAppVersionStatus.Paused
            ? { rollout: 0 }
            : {}),
        },
        { where: { version_id } },
      )
      const updated = await current.reload()

      return next({
        versionId: updated.version_id,
        previousStatus: current.status,
        status: updated.status,
        rollout: updated.rollout,
      })
    } catch (error) {
      return next(
        error instanceof AppError
          ? error
          : new AppError(error, ErrorCode.UPDATE_ERROR, 500),
      )
    }
  },
)
//   try {
//       await baselineManager.getAppHotUpdateVersions(SystemTypeEnum.iOS)
//     const [appForHarmony, grayAppForHarmony] =
//       await baselineManager.getAppHotUpdateVersions(SystemTypeEnum.Harmony)
//     const result = [
//       {
//         type: 'gray',
//         android: grayAppForAndroid,
//         iOS: grayAppForiOS,
//         harmony: grayAppForHarmony,
//       },
//       {
//         type: 'release',
//         android: appForAndroid,
//         iOS: appForiOS,
//         harmony: appForHarmony,
//       },
//     ]
//     return next(result)
//   } catch (error) {
//     return next(new AppError(error, ErrorCode.QUERY_ERROR, 500))
//   }
// })
