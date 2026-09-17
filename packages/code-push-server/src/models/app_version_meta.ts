import { DataTypes, Model } from 'sequelize'
import { sequelize } from '../core/utils/connections'

export interface AppsVersionMetaInterface extends Model {
  id: number
  platform: string
  version_number: string
  version_name: string
  core_version: string
  cli_version?: string
  min_supported_version: string
  app_type: string
  created_at: Date
  updated_at: Date
  deleted_at: Date
  deleted: number
}

export const AppMeta = sequelize.define<AppsVersionMetaInterface>(
  'AppMeta',
  {
    id: {
      type: DataTypes.INTEGER({ length: 10 }),
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    platform: DataTypes.STRING,
    version_number: DataTypes.STRING,
    version_name: DataTypes.STRING,
    core_version: DataTypes.STRING,
    cli_version: DataTypes.STRING,
    min_supported_version: DataTypes.STRING,
    app_type: DataTypes.STRING,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
    deleted_at: DataTypes.DATE,
    deleted: DataTypes.INTEGER({ length: 1 }),
  },
  {
    tableName: 'app_version_meta',
    underscored: true,
    paranoid: true,
  },
)
