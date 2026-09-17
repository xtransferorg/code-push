import { HttpTimeoutOption } from "./http/HttpRequest"

export const X_CODE_PUSH_PLUGIN_NAME = "native-code-push-xt-harmony"
export const X_CODE_PUSH_PLUGIN_VERSION = "3.0.0" //TODO 动态获取
export const X_CODE_PUSH_SDK_VERSION = "3.0.0" //TODO 动态获取

export const SyncStatus = {
  UP_TO_DATE: 0, // The running app is up-to-date
  UPDATE_INSTALLED: 1, // The app had an optional/mandatory update that was successfully downloaded and is about to be installed.
  UPDATE_IGNORED: 2, // The app had an optional update and the end-user chose to ignore it
  UNKNOWN_ERROR: 3,
  SYNC_IN_PROGRESS: 4, // There is an ongoing "sync" operation in progress.
  CHECKING_FOR_UPDATE: 5,
  AWAITING_USER_ACTION: 6,
  DOWNLOADING_PACKAGE: 7,
  INSTALLING_UPDATE: 8,
  CHECKING_DONE: 9,
  PATCH_START: 10,
  PATCH_DONE: 11,
  PATCH_ERROR: 12,
  DOWNLOADED_PACKAGE: 13,
}

export const CheckFrequency = {
  ON_APP_START: 0,
  ON_APP_RESUME: 1,
  MANUAL: 2,
}

export const DeploymentStatus = {
  SUCCEEDED: 'DeploymentSucceeded',
  FAILED: 'DeploymentFailed',
}

export const DEFAULT_UPDATE_DIALOG = {
  appendReleaseDescription: false,
  descriptionPrefix: ' Description: ',
  mandatoryContinueButtonLabel: 'Continue',
  mandatoryUpdateMessage: 'An update is available that must be installed.',
  optionalIgnoreButtonLabel: 'Ignore',
  optionalInstallButtonLabel: 'Install',
  optionalUpdateMessage: 'An update is available. Would you like to install it?',
  title: 'Update available',
}

export const DEFAULT_ROLLBACK_RETRY_OPTIONS = {
  delayInHours: 24,
  maxRetryAttempts: 1,
}

export const DEFAULT_UPDATE_CHECK_TIMEOUT: HttpTimeoutOption = {
  connectTimeoutMills: 10_000,
  readTimeoutMills: 10_000,
}

export const UPDATE_CHECK_TIMEOUT: HttpTimeoutOption = {
  connectTimeoutMills: 2_000,
  readTimeoutMills: 2_000,
}

