import { DataTypes, Model } from 'sequelize'
import { sequelize } from '../core/utils/connections'

interface PackagesMetricsInterface extends Model {
  id: number
  package_id: number
  active: number // 活跃用户数（可能跨版本更新）
  downloaded: number // 下载成功的数据
  failed: number // 安装失败的次数
  installed: number // 安装次数（包括成功和失败）
  created_at: Date
  updated_at: Date
}

export const PackagesMetrics = sequelize.define<PackagesMetricsInterface>(
  'PackagesMetrics',
  {
    id: {
      type: DataTypes.INTEGER({ length: 10 }),
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    package_id: DataTypes.INTEGER({ length: 10 }),
    active: DataTypes.INTEGER({ length: 10 }),
    downloaded: DataTypes.INTEGER({ length: 10 }),
    failed: DataTypes.INTEGER({ length: 10 }),
    installed: DataTypes.INTEGER({ length: 10 }),
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  {
    tableName: 'packages_metrics',
    underscored: true,
    paranoid: true,
  },
)
