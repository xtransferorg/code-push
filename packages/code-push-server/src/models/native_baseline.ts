import { DataTypes, Model } from 'sequelize'
import { sequelize } from '../core/utils/connections'

export interface BaseLineInterface extends Model {
  id: number
  app_meta_id: number
  deployment_version_id: number
  url: string
  file_name: string
  file_hash: string
  file_type: string
  file_size: number
  created_at: Date
  updated_at: Date
  deleted_at: Date
  deleted: number
}

export const NativeBaseline = sequelize.define<BaseLineInterface>(
  'NativeBaseline',
  {
    id: {
      type: DataTypes.INTEGER({ length: 10 }),
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    app_meta_id: {
      type: DataTypes.BIGINT({ length: 20 }),
      allowNull: true,
    },
    deployment_version_id: {
      type: DataTypes.BIGINT({ length: 20 }),
      allowNull: true,
    },
    url: DataTypes.STRING,
    file_name: DataTypes.STRING,
    file_hash: DataTypes.STRING,
    file_type: DataTypes.STRING,
    file_size: DataTypes.NUMBER,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
    deleted_at: DataTypes.DATE,
    deleted: DataTypes.INTEGER({ length: 3 }),
  },
  {
    tableName: 'native_baseline',
    underscored: true,
    paranoid: true,
  },
)
