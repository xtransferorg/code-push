import { Package } from "./Package"

export interface RemotePackage extends Package {
  downloadUrl: string
  downloadDiffUrl?: string
  downloadDiffSize?: number
  isDiffAvailable?: boolean
  basePackageHash?: string
  baseDownloadUrl?: string
  basePackageSize?: number
  hasCurrentPackageDiff?: boolean
  previousPackageHash?: string
}