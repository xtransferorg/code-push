import { NativeEventEmitter } from 'react-native'
import RestartManager from './RestartManager'
import log from './logging'
import { NativeCodePushState } from './constant'

// This function is used to augment remote and local
// package objects with additional functionality/properties
// beyond what is included in the metadata sent by the server.
module.exports = (NativeCodePush) => {
  const remote = (reportStatusDownload) => {
    return {
      async download(downloadProgressCallback, patchStatusCallback) {
        if (!this.downloadUrl) {
          throw new Error('Cannot download an update without a download url')
        }

        const codePushEventEmitter = new NativeEventEmitter(NativeCodePush)
        let downloadProgressSubscription, patchStatusSubscription
        if (downloadProgressCallback) {
          // Use event subscription to obtain download progress.
          downloadProgressSubscription = codePushEventEmitter.addListener(
            'CodePushDownloadProgress',
            downloadProgressCallback,
          )
        }

        if (patchStatusCallback) {
          // Use event subscription to obtain patch status.
          patchStatusSubscription = codePushEventEmitter.addListener(
            'CodePushPatchStatus',
            patchStatusCallback,
          )
        }

        // Use the downloaded package info. Native code will save the package info
        // so that the client knows what the current package version is.
        try {
          const updatePackageCopy = Object.assign({}, this)
          Object.keys(updatePackageCopy).forEach(
            (key) =>
              typeof updatePackageCopy[key] === 'function' &&
              delete updatePackageCopy[key],
          )

          const downloadedPackage = await NativeCodePush.downloadUpdate(
            updatePackageCopy,
            !!downloadProgressCallback,
          )

          if (reportStatusDownload) {
            reportStatusDownload(this).catch((err) => {
              log(`Report download status failed: ${err}`)
            })
          }

          return { ...downloadedPackage, ...local }
        } finally {
          downloadProgressSubscription && downloadProgressSubscription.remove()
          patchStatusSubscription && patchStatusSubscription.remove()
        }
      },

      isPending: false, // A remote package could never be in a pending state
    }
  }

  const local = {
    async install(
      installMode = NativeCodePushState.codePushInstallModeOnNextRestart,
      minimumBackgroundDuration = 0,
      updateInstalledCallback,
    ) {
      const localPackage = this
      const localPackageCopy = Object.assign({}, localPackage) // In dev mode, React Native deep freezes any object queued over the bridge
      await NativeCodePush.installUpdate(
        localPackageCopy,
        installMode,
        minimumBackgroundDuration,
      )
      updateInstalledCallback && updateInstalledCallback()
      if (installMode == NativeCodePushState.codePushInstallModeImmediate) {
        RestartManager.restartApp(false)
      } else {
        RestartManager.clearPendingRestart()
        localPackage.isPending = true // Mark the package as pending since it hasn't been applied yet
      }
    },

    isPending: false, // A local package wouldn't be pending until it was installed
  }

  return { local, remote }
}
