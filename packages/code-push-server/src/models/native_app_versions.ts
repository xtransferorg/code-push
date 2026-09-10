import { DataTypes, Model } from 'sequelize'
import { sequelize } from '../core/utils/connections'
import type {
  BuildType,
  Environment,
  UpdateType,
  NativeAppVersionStatus,
} from '@xrnjs/code-push-core'

export interface NativeAppVersionsInterface extends Model {
  id: number
  app_meta_id: number
  version_id: string // 唯一id
  app_key: string
  version_number: string // 20240101，主要用于在同一个版本下的不同构建（前提条件是同一个版本对外暴露的能力一致）
  version_name: string // 3.3.2
  changelog?: string
  download_url?: string
  rollout: number // 0-100
  white_list?: string
  only_apply_version?: string // 3.3.2，如果设置了此参数，表示只有在此版本客户端才能收到本次更新
  not_only_apply_version?: string // 3.3.2，如果设置了此参数，表示除了此版本客户端都能收到本次更新
  build_type: BuildType
  is_backward_compatible: boolean // 是否兼容前一个版本
  status: NativeAppVersionStatus
  environment: Environment // 生产环境或测试环境
  update_type: UpdateType // 强制更新或静默更新
  channel?: string
  app_format?: string
  package_size?: number
  download_url_arm32?: string
  download_url_arm64?: string
  created_at?: string
  review_passed?: number
}

export const NativeAppVersions = sequelize.define<NativeAppVersionsInterface>(
  'NativeAppVersions',
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      autoIncrement: true,
      comment: '自增id',
    },
    app_meta_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      comment: '版本meta信息',
    },
    version_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true,
      comment: 'uuid，唯一标识，外部关联',
    },
    app_key: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: '应用的标识，关联到 apps 表',
    },
    version_number: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '应用的内部版本号，例如 20240101',
    },
    version_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: '应用的版本名称，展示给用户的版本号，例如 3.3.2',
    },
    only_apply_version: {
      type: DataTypes.STRING(50),
      comment: '如果设置了此参数，表示只有在此版本客户端才能收到本次更新',
    },
    not_only_apply_version: {
      type: DataTypes.STRING(50),
      comment: '如果设置了此参数，表示除了此版本客户端都能收到本次更新',
    },
    changelog: {
      type: DataTypes.TEXT,
      comment: '版本的更新内容说明',
    },
    download_url: {
      type: DataTypes.STRING(2048),
      comment: '版本的下载链接（OSS的文件地址，用于生产环境）',
    },
    download_url_arm32: {
      type: DataTypes.STRING(2048),
      comment: '32位版本的下载链接（OSS的文件地址，用于生产环境）',
    },
    download_url_arm64: {
      type: DataTypes.STRING(2048),
      comment: '64位版本的下载链接（OSS的文件地址，用于生产环境）',
    },
    rollout: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: '灰度流量，默认0，上限100',
    },
    white_list: {
      type: DataTypes.TEXT,
      comment: '灰度白名单',
    },
    build_type: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: '包的类型',
    },
    is_backward_compatible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: '是否兼容前一个版本',
    },
    status: {
      type: DataTypes.STRING(255), // ready_for_review -> pending_review -> rollout -> published -> discarded
      defaultValue: 'ready_for_review',
      allowNull: false,
      comment: '发布状态',
    },
    environment: {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: 'dev',
      comment: '环境，区分测试和生产',
    },
    update_type: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: 'Silent',
      comment: '更新类型，强更或静默',
    },
    package_size: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      defaultValue: 0,
      comment: '包的大小，单位：字节',
    },
    channel: {
      type: DataTypes.STRING(50),
      comment: '发布渠道，例如华为、Google等',
    },
    app_format: {
      type: DataTypes.STRING(50),
      comment: '应用的格式，例如 apk、ipa',
    },
    created_at: {
      type: DataTypes.DATE,
      comment: '创建时间',
    },
    review_passed: {
      type: DataTypes.TINYINT.UNSIGNED,
      allowNull: true,
      defaultValue: 0,
      comment: '审核是否通过：0：未通过，1：通过',
    },
  },
  {
    tableName: 'native_app_versions',
    underscored: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
    comment: '存储应用的版本信息',
  },
)
