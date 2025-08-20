import AccountManager = require('@xrnjs/code-push-core')
import type {
  AddAppConfig,
  NativeRelease,
  NativeUpdateRelease,
  NativeListRelease,
} from '@xrnjs/code-push-core/dist/types'

export enum CommandType {
  accessKeyAdd,
  accessKeyPatch,
  accessKeyList,
  accessKeyRemove,
  appAdd,
  appModify,
  appList,
  appRemove,
  appRename,
  appTransfer,
  collaboratorAdd,
  collaboratorList,
  collaboratorRemove,
  debug,
  deploymentAdd,
  deploymentHistory,
  deploymentHistoryClear,
  deploymentList,
  deploymentMetrics,
  deploymentRemove,
  deploymentRename,
  link,
  login,
  logout,
  patch,
  promote,
  register,
  release,
  releaseCordova,
  releaseReact,
  rollback,
  whoami,
  batchPatch,
  batchRollback,
  nativeRelease,
  nativeUpdateRelease,
  nativeListRelease,
  token, // Add this line for the new token command
}

export interface ICommand {
  type: CommandType
}

export interface IAccessKeyAddCommand extends ICommand {
  name: string
  ttl?: number
}

export interface IAccessKeyPatchCommand extends ICommand {
  newName?: string
  oldName: string
  ttl?: number
}

export interface IAccessKeyListCommand extends ICommand {
  format: string
}

export interface IAccessKeyRemoveCommand extends ICommand {
  accessKey: string
}

export interface IAppAddCommand extends ICommand, AddAppConfig {
  appName: string
  os: string
  platform: string
}

export interface IAppListCommand extends ICommand {
  format: string
}

export interface IAppRemoveCommand extends ICommand {
  appName: string
}

export interface IAppRenameCommand extends ICommand {
  currentAppName: string
  newAppName: string
}

export interface IAppTransferCommand extends ICommand {
  appName: string
  email: string
}

export interface ICollaboratorAddCommand extends ICommand {
  appName: string
  email: string
}

export interface ICollaboratorListCommand extends ICommand {
  appName: string
  format: string
}

export interface ICollaboratorRemoveCommand extends ICommand {
  appName: string
  email: string
}

export interface IDebugCommand extends ICommand {
  platform: string
}

export interface IDeploymentAddCommand extends ICommand {
  appName: string
  deploymentName: string
  default: boolean
}

export interface IDeploymentHistoryClearCommand extends ICommand {
  appName: string
  deploymentName: string
}

export interface IDeploymentHistoryCommand extends ICommand {
  appName: string
  deploymentName: string
  format: string
  displayAuthor: boolean
}

export interface IDeploymentListCommand extends ICommand {
  appName: string
  format: string
  displayKeys: boolean
  showPackage?: boolean
}

export interface IDeploymentRemoveCommand extends ICommand {
  appName: string
  deploymentName: string
}

export interface IDeploymentRenameCommand extends ICommand {
  appName: string
  currentDeploymentName: string
  newDeploymentName: string
}

export interface IDeploymentMetricsCommand extends ICommand {
  appName: string
  deploymentName: string
  format: string
}

export interface ILinkCommand extends ICommand {
  serverUrl?: string
}

export interface ILoginCommand extends ICommand {
  serverUrl?: string
  accessKey: string
  proxy?: string
  noProxy?: boolean
}

export interface IPackageInfo {
  description?: string
  label?: string
  disabled?: boolean
  mandatory?: boolean
  rollout?: number
  whiteList?: string
  uuid?: string
  channelReleaseId?: string
}

export interface IPatchCommand extends ICommand, IPackageInfo {
  appName: string
  appStoreVersion?: string
  deploymentName: string
  label: string
}

export interface IPromoteCommand extends ICommand, IPackageInfo {
  appName: string
  appStoreVersion?: string
  sourceDeploymentName: string
  destDeploymentName: string
  noDuplicateReleaseError?: boolean
}

export interface IRegisterCommand extends ICommand {
  serverUrl?: string
  proxy?: string
  noProxy?: boolean
}

export interface IReleaseBaseCommand extends ICommand, IPackageInfo {
  appName: string
  appStoreVersion: string
  deploymentName: string
  noDuplicateReleaseError?: boolean
  privateKeyPath?: string
  uuid?: string
  force?: boolean
  bundleName?: string
  appBinaryTime?: string
}

export interface IReleaseCommand extends IReleaseBaseCommand {
  package: string
}

export interface IReleaseCordovaCommand extends IReleaseBaseCommand {
  build: boolean
  platform: string
  isReleaseBuildType?: boolean
}

export interface IReleaseReactCommand extends IReleaseBaseCommand {
  bundleName?: string
  development?: boolean
  entryFile?: string
  gradleFile?: string
  podFile?: string
  platform: string
  plistFile?: string
  plistFilePrefix?: string
  sourcemapOutput?: string
  sourcemapOutputDir?: string
  outputDir?: string
  config?: string
  extraBundlerOptions?: string[]
  extraHermesFlags?: string[]
}

export interface IRollbackCommand extends ICommand {
  appName: string
  deploymentName: string
  targetRelease: string
  appVersion?: string
  targetUuid?: string
  rollbackUuid?: string
  y: boolean
  previous: boolean
}

export interface IBatchPatch extends ICommand {
  uuid?: string
  channelReleaseId?: string
  rollout?: number
  disabled?: boolean
  mandatory?: boolean
  whiteList?: string
  description?: string
}

export interface IBatchRollback extends ICommand {
  targetUuid: string
  rollbackUuid: string
  channelReleaseId?: string
  previous?: boolean
}

export interface IAppConfig extends ICommand, AddAppConfig {
  appName: string
}

export type ReleaseHook = (
  currentCommand: IReleaseCommand,
  originalCommand: IReleaseCommand,
  sdk: AccountManager,
) => Promise<IReleaseCommand | void>

export interface ReleaseFile {
  sourceLocation: string // The current location of the file on disk
  targetLocation: string // The desired location of the file within the zip
}

export interface IReleaseNativeCommand extends ICommand, NativeRelease {}

export interface IReleaseUpdateNativeCommand
  extends IReleaseNativeCommand,
    NativeUpdateRelease {}

export interface IReleaseListNativeCommand
  extends IReleaseNativeCommand,
    NativeListRelease {}

export interface ITokenCommand extends ICommand {
  // No extra fields needed for token command
}
