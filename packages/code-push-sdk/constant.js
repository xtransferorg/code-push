let NativeCodePush = require('./src/NativeCodePush').default

export const NativeCodePushState = (() => {
  return {
    codePushInstallModeImmediate:
      NativeCodePush.codePushInstallModeImmediate(),
    codePushInstallModeOnNextRestart:
      NativeCodePush.codePushInstallModeOnNextRestart(),
    codePushInstallModeOnNextResume:
      NativeCodePush.codePushInstallModeOnNextResume(),
    codePushInstallModeOnNextSuspend:
      NativeCodePush.codePushInstallModeOnNextSuspend(),
    codePushUpdateStateRunning: NativeCodePush.codePushUpdateStateRunning(),
    codePushUpdateStatePending: NativeCodePush.codePushUpdateStatePending(),
    codePushUpdateStateLatest: NativeCodePush.codePushUpdateStateLatest(),
  }
})()
