let NativeCodePush
if (Platform.OS === 'harmony') {
  NativeCodePush = require('./src/NativeCodePush').default
} else {
  NativeCodePush = require('react-native').NativeModules.CodePush
}

export const NativeCodePushState = (() => {
  if (Platform.OS === 'harmony') {
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
  }
  return {
    codePushInstallModeImmediate: NativeCodePush.codePushInstallModeImmediate,
    codePushInstallModeOnNextRestart:
      NativeCodePush.codePushInstallModeOnNextRestart,
    codePushInstallModeOnNextResume:
      NativeCodePush.codePushInstallModeOnNextResume,
    codePushInstallModeOnNextSuspend:
      NativeCodePush.codePushInstallModeOnNextSuspend,
    codePushUpdateStateRunning: NativeCodePush.codePushUpdateStateRunning,
    codePushUpdateStatePending: NativeCodePush.codePushUpdateStatePending,
    codePushUpdateStateLatest: NativeCodePush.codePushUpdateStateLatest,
  }
})()
