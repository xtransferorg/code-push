import semver from 'semver'
import { Op } from 'sequelize'
import { NativeAppVersionStatus } from '@xrnjs/code-push-core'
import { NativeAppVersions } from '../../models/native_app_versions'
import { AppMeta } from '../../models/app_version_meta'

/**
 * 版本级状态聚合优先级（数值越大优先级越高）
 * 同一 (platform, version_name) 下取所有渠道中优先级最高的 status 作为版本级状态
 */
const STATUS_PRIORITY: Record<string, number> = {
  [NativeAppVersionStatus.Published]: 60,
  [NativeAppVersionStatus.RolloutClosed]: 50,
  [NativeAppVersionStatus.Paused]: 40,
  [NativeAppVersionStatus.Rollout]: 30,
  [NativeAppVersionStatus.MarketApproved]: 20,
  [NativeAppVersionStatus.ReadyForReview]: 10,
  [NativeAppVersionStatus.PendingReview]: 5,
  [NativeAppVersionStatus.Discarded]: 0,
}

export interface VersionAggregate {
  versionName: string
  status: NativeAppVersionStatus
  /** 该版本下所有渠道记录对应的 app_meta_id（取第一条非空） */
  appMetaId?: number | null
  minSupportedVersion?: string | null
}

/**
 * 按 (platform, version_name) 聚合版本级状态。
 * environment 默认 'prod'。
 */
export async function aggregateVersionsByPlatform(params: {
  platform: string
  environment?: string
}): Promise<VersionAggregate[]> {
  const { platform, environment = 'prod' } = params

  const rows = await NativeAppVersions.findAll({
    where: {
      environment,
      status: { [Op.ne]: NativeAppVersionStatus.Discarded },
    },
  })

  if (!rows.length) return []

  const metaIds = Array.from(
    new Set(rows.map((r) => r.app_meta_id).filter(Boolean) as number[]),
  )
  const metas = metaIds.length
    ? await AppMeta.findAll({ where: { id: { [Op.in]: metaIds }, platform } })
    : []
  const metaMap = new Map(metas.map((m) => [m.id, m]))

  // 仅保留 platform 匹配的记录（app_meta 缺失视为不匹配）
  const filtered = rows.filter(
    (r) => r.app_meta_id && metaMap.has(r.app_meta_id),
  )

  const groups = new Map<string, VersionAggregate>()
  for (const row of filtered) {
    const meta = metaMap.get(row.app_meta_id)!
    const key = row.version_name
    const existing = groups.get(key)
    const priority = STATUS_PRIORITY[row.status] ?? -1

    if (!existing) {
      groups.set(key, {
        versionName: row.version_name,
        status: row.status,
        appMetaId: row.app_meta_id,
        minSupportedVersion: meta.min_supported_version,
      })
      continue
    }
    const existingPriority = STATUS_PRIORITY[existing.status] ?? -1
    if (priority > existingPriority) {
      existing.status = row.status
    }
  }

  return Array.from(groups.values())
}

/** semver 比较，无法解析时按字符串退化比较 */
export function compareVersion(a: string, b: string): number {
  const ca = semver.coerce(a)
  const cb = semver.coerce(b)
  if (ca && cb) return semver.compare(ca, cb)
  return a.localeCompare(b)
}

export function maxVersion(versions: string[]): string | null {
  if (!versions.length) return null
  return versions.reduce((acc, v) => (compareVersion(v, acc) > 0 ? v : acc))
}

/** 灰度版本号不得小于 latestRelease；无正式版时保留 rawLatestGray */
function resolveLatestGray(
  latestRelease: string | null,
  rawLatestGray: string | null,
): string | null {
  if (!rawLatestGray) return null
  if (!latestRelease) return rawLatestGray
  return compareVersion(rawLatestGray, latestRelease) >= 0
    ? rawLatestGray
    : null
}

export interface ComputedBaseline {
  latestRelease: string | null
  latestGray: string | null
  /** latestRelease 对应记录的 min_supported_version */
  minOfficialVersion: string | null
  /** latestGray 对应记录的 min_supported_version（无灰度版本时为 null） */
  minGrayVersion: string | null
}

export function computeBaseline(
  aggregates: VersionAggregate[],
): ComputedBaseline {
  const released = aggregates.filter(
    (v) => v.status === NativeAppVersionStatus.Published,
  )
  const gray = aggregates.filter(
    (v) =>
      v.status === NativeAppVersionStatus.Rollout ||
      v.status === NativeAppVersionStatus.Paused,
  )

  const latestRelease = maxVersion(released.map((v) => v.versionName))
  const rawLatestGray = maxVersion(gray.map((v) => v.versionName))
  const latestGray = resolveLatestGray(latestRelease, rawLatestGray)

  const releaseAgg = released.find((v) => v.versionName === latestRelease)
  const grayAgg = gray.find((v) => v.versionName === latestGray)

  return {
    latestRelease,
    latestGray,
    minOfficialVersion: releaseAgg?.minSupportedVersion ?? null,
    minGrayVersion: grayAgg?.minSupportedVersion ?? null,
  }
}

export type PublishTarget = 'official' | 'gray' | 'review'

const OFFICIAL_STATUSES = new Set<string>([
  NativeAppVersionStatus.Published,
  NativeAppVersionStatus.RolloutClosed,
])
const GRAY_STATUSES = new Set<string>([
  NativeAppVersionStatus.Rollout,
  NativeAppVersionStatus.Paused,
])

/**
 * 按 publishTarget 过滤聚合版本，得到该目标的"有效候选集"。
 * - official: published / rollout_closed，≥ minOfficialVersion
 * - gray:     rollout / paused，> latestRelease 且 ≥ minGrayVersion
 * - review:   ready_for_review，不受 minSupportedVersion 限制
 * 与 GET /app-versions 的过滤规则保持一致，供其它接口（validate / pre-validate）复用。
 */
export function filterVersionsByPublishTarget(
  aggregates: VersionAggregate[],
  baseline: ComputedBaseline,
  publishTarget: PublishTarget,
): VersionAggregate[] {
  return aggregates.filter((v) => {
    if (publishTarget === 'official') {
      if (!OFFICIAL_STATUSES.has(v.status)) return false
      return (
        !baseline.minOfficialVersion ||
        compareVersion(v.versionName, baseline.minOfficialVersion) >= 0
      )
    }
    if (publishTarget === 'gray') {
      if (!GRAY_STATUSES.has(v.status)) return false
      if (
        baseline.latestRelease &&
        compareVersion(v.versionName, baseline.latestRelease) <= 0
      ) {
        return false
      }
      return (
        !baseline.minGrayVersion ||
        compareVersion(v.versionName, baseline.minGrayVersion) >= 0
      )
    }
    return v.status === NativeAppVersionStatus.ReadyForReview
  })
}

/**
 * 当有新版本进入 rollout / published 时，批量检查满足条件的 paused 版本，
 * 自动流转为 rollout_closed：
 *   status = 'paused' AND version > latestRelease AND version < latestGray
 */
export async function autoCloseStaleRollouts(params: {
  platform: string
  environment?: string
  /** 外部已聚合的版本数据，传入可避免重复查库 */
  aggregates?: VersionAggregate[]
  logger?: {
    info: (msg: string, extra?: unknown) => void
    warn?: (msg: string, extra?: unknown) => void
  }
}): Promise<{ closed: string[] }> {
  const { platform, environment = 'prod', logger, aggregates: providedAggregates } =
    params
  const aggregates =
    providedAggregates ??
    (await aggregateVersionsByPlatform({
      platform,
      environment,
    }))
  const { latestRelease, latestGray } = computeBaseline(aggregates)

  // latestGray 为 null 时跳过检查
  if (!latestGray) return { closed: [] }
  if (!latestRelease) return { closed: [] }

  const pausedTargets = aggregates.filter(
    (v) =>
      v.status === NativeAppVersionStatus.Paused &&
      compareVersion(v.versionName, latestRelease) > 0 &&
      compareVersion(v.versionName, latestGray) < 0,
  )

  if (!pausedTargets.length) return { closed: [] }

  const scopedMetaIds = Array.from(
    new Set(aggregates.map((a) => a.appMetaId).filter(Boolean) as number[]),
  )
  if (!scopedMetaIds.length) return { closed: [] }

  const pausedVersionNames = pausedTargets.map((t) => t.versionName)
  const rows = await NativeAppVersions.findAll({
    where: {
      environment,
      app_meta_id: { [Op.in]: scopedMetaIds },
      version_name: { [Op.in]: pausedVersionNames },
      status: NativeAppVersionStatus.Paused,
    },
  })
  const versionIds = rows.map((row) => row.version_id)
  if (versionIds.length) {
    await NativeAppVersions.update(
      { status: NativeAppVersionStatus.RolloutClosed },
      { where: { version_id: { [Op.in]: versionIds } } },
    )
  }
  const closed = pausedVersionNames

  if (closed.length) {
    logger?.info('autoCloseStaleRollouts done', {
      platform,
      environment,
      closed,
      latestRelease,
      latestGray,
    })
  }

  return { closed }
}
