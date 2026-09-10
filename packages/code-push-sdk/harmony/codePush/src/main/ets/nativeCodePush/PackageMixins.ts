import {log} from "./Logging"
import { NativeCodePushDelegate } from './NativeCodePushDelegate'
import { CodePushInstallMode } from '../CodePushInstallMode'

const TAG = "PackageMixins"

// This function is used to augment remote and local
// package objects with additional functionality/properties
// beyond what is included in the metadata sent by the server.
function getMixPackage(nativeCodePushDelegate: NativeCodePushDelegate) {
  

  const remote = (reportStatusDownload) => {
    return {
      async download(downloadProgressCallback, patchStatusCallback) {
        if (!this.downloadUrl) {
          throw new Error('Cannot download an update without a download url')
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

          log(`${TAG}.download" updatePackageCopy: ${JSON.stringify(updatePackageCopy)}`)
          const downloadedPackage = await nativeCodePushDelegate.downloadUpdate(
            updatePackageCopy,
            downloadProgressCallback,
          )

          if (reportStatusDownload) {
            reportStatusDownload(this).catch((err) => {
              log(`${TAG}.download" Report download status failed: ${err}`)
            })
          }

          return { ...downloadedPackage, ...local }
        } finally {
          // downloadProgressSubscription && downloadProgressSubscription?.remove()
          // patchStatusSubscription && patchStatusSubscription?.remove()
        }
      },

      isPending: false, // A remote package could never be in a pending state
    }
  }

  const local = {
    async install(
      installMode = CodePushInstallMode.ON_NEXT_RESTART,
      minimumBackgroundDuration = 0,
      updateInstalledCallback,
    ) {
      const localPackage = this
      const localPackageCopy = Object.assign({}, localPackage) // In dev mode, React Native deep freezes any object queued over the bridge
      await nativeCodePushDelegate.installUpdate(
        localPackageCopy,
        installMode,
        minimumBackgroundDuration,
      )
      updateInstalledCallback && updateInstalledCallback()
      // if (installMode == CodePushInstallMode.IMMEDIATE) {
      //   nativeCodePushDelegate.restartApp(false)
      // } else {
      //   nativeCodePushDelegate.clearPendingRestart()
      //   localPackage.isPending = true // Mark the package as pending since it hasn't been applied yet
      // }
    },

    isPending: false, // A local package wouldn't be pending until it was installed
  }

  return { local, remote }
}

export default getMixPackage
