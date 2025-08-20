import { checkToken, Req } from '../../core/middleware'
import { NativeApps } from '../../models/native_apps'
import { v4 as uuid } from 'uuid'
import { AppError, ErrorCode } from '../../core/app-error'
import {
  NativeAppVersions,
  NativeAppVersionStatus,
} from '../../models/native_app_versions'
import { isUndefined, omitBy } from 'lodash'
import { Gray } from '../../core/services/gray'
import { Op, WhereOptions } from 'sequelize'
import { PublishStateMachine } from './state'
import { Pagination } from '../../core/services/pagination'
import semver from 'semver'
import express from 'express'
import type {
  BuildType,
  Environment,
  Platform,
  UpdateType,
} from '@xrnjs/code-push-core/dist/types'
import { LogReportNativeAppLogs } from '../../models/log_report_native_app_download'

export const appRouter = express.Router()

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
      // 获取所有版本
      const allVersions = await NativeAppVersions.findAll({
        where: omitBy(
          {
            app_key,
            environment: env,
            status: {
              [Op.in]: ['published', 'rollout'],
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
        version: '',
        version_number: '',
        update_description: [],
        changelog: '',
        version_id: '',
        channel: '',
        environment: '',
        should_update_system_version: false,
      }

      if (
        semver.lt(semver.coerce(systemVersion), semver.coerce(app.min_version))
      ) {
        result.should_update_system_version = true
        // 如果系统版本小于最低版本，不支持
        return next(result)
      }

      // 如果没有比当前版本更高的版本，返回空结果
      if (higherVersions.length === 0) {
        return next(result)
      }

      // 对比构建版本号，取得最新的一条构建记录
      let latestVersion = higherVersions[0]

      if (latestVersion.status === NativeAppVersionStatus.Rollout) {
        const gray = new Gray(
          device_id,
          latestVersion.rollout,
          latestVersion.white_list?.split(',') || [],
        )
        if (gray.isHit()) {
          result.in_gray_release = true
        } else {
          // 没有命中灰度，再检查是否有全量发布的版本
          const latestPublishedVersion = higherVersions
            .slice(1)
            .find((v) => v.status === NativeAppVersionStatus.Published)
          if (latestPublishedVersion) {
            // 如果有全量发布的版本，取最新的一条
            latestVersion = latestPublishedVersion
          } else {
            return next(result)
          }
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
        result.download_url = latestVersion.download_url
        result.update_type = latestVersion.update_type
        result.version_id = latestVersion.version_id
        result.channel = latestVersion.channel
        result.environment = latestVersion.environment
        result.update_description = latestVersion.changelog.split('\n')
        result.changelog = latestVersion.changelog
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
      result.download_url = latestVersion.download_url
      result.update_type = latestVersion.update_type
      result.version_id = latestVersion.version_id
      result.channel = latestVersion.channel
      result.environment = latestVersion.environment
      result.update_description = latestVersion.changelog.split('\n')
      result.changelog = latestVersion.changelog

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
  async (
    req: Req<
      Record<string, string>,
      {
        name: string
        platform: string
        app_type: string
        download_url: string
        version_name: string
        rollout: number
        is_backward_compatible: boolean
        environment: Environment
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
      }
    >,
    _,
    next,
  ) => {
    const { logger, body } = req
    const {
      name,
      platform,
      app_type,
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
      only_apply_version,
      not_only_apply_version,
    } = body
    const app = await NativeApps.findOne({
      where: { name, platform, app_type },
    })
    if (!app) {
      return next(new AppError('未找到对应的 app', ErrorCode.NOT_FOUND, 404))
    }
    const nativeApp = await NativeApps.findOne({
      where: { app_key: app.app_key },
    })

    logger.info('publish app', {
      name,
      platform,
      app_type,
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
      not_only_apply_version,
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
          `App not found: ${app.app_key}`,
          ErrorCode.PARAMS_INVALID,
          500,
        ),
      )
    }
    try {
      if (environment === 'prod') {
        const previousVersion = await NativeAppVersions.findOne({
          where: {
            app_key: app.app_key,
            channel,
            environment: 'prod',
            status: { [Op.not]: 'discarded' },
          },
          order: [['created_at', 'DESC']],
        })
        // 获取上一个生产环境的版本，灰度流量必须是100%并且状态是已发布（并且发布的版本和当前最新的版本不是同一个版本）
        if (
          previousVersion &&
          previousVersion.version_name !== version_name &&
          (previousVersion.rollout !== 100 ||
            previousVersion.status !== 'published')
        ) {
          return next(
            new AppError(
              'Previous version is not published or rollout is not 100%',
              ErrorCode.PUBLISH_FAILED,
              500,
            ),
          )
        }
      }
      const prevVersion = await NativeAppVersions.findOne({
        where: { app_key: app.app_key, version_name, channel, environment },
      })
      if (prevVersion) {
        // 状态未发布或者灰度流量为0的版本可以更新
        if (
          [
            NativeAppVersionStatus.ReadyForReview,
            NativeAppVersionStatus.PendingReview,
          ].includes(prevVersion.status) ||
          (prevVersion.status === NativeAppVersionStatus.Rollout &&
            prevVersion.rollout === 0)
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
      const data = await NativeAppVersions.create({
        app_key: app.app_key,
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
    if (rollout >= 100) {
      // 如果灰度流量设置为100%，则直接发布
      status = NativeAppVersionStatus.Published
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
      return next(await currentVersion.reload())
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
