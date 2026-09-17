package xrn.modules.codepush

import org.json.JSONObject


/**
 * Represents a code push update package
 *
 * @property appVersion The app binary version that this update is dependent on. This is the value that was
 * specified via the appStoreVersion parameter when calling the CLI's release command.
 * @property deploymentKey The deployment key that was used to originally download this update.
 * @property description The description of the update. This is the same value that you specified in the CLI when you released the update.
 * @property failedInstall Indicates whether this update has been previously installed but was rolled back.
 * @property isFirstRun Indicates whether this is the first time the update has been run after being installed.
 * @property isMandatory Indicates whether the update is considered mandatory. This is the value that was specified in the CLI when the update was released.
 * @property isPending Indicates whether this update is in a "pending" state. When true, that means the update has been downloaded and installed, but the app restart
 * needed to apply it hasn't occurred yet, and therefore, its changes aren't currently visible to the end-user.
 * @property label The internal label automatically given to the update by the CodePush server. This value uniquely identifies the update within its deployment.
 * @property packageHash The SHA hash value of the update.
 * @property packageSize The size of the code contained within the update, in bytes.
 */
data class RemotePackage(
    val deploymentKey: String,
    val appVersion: String,
    val updateAppVersion: Boolean,
    val isAvailable: Boolean,
    val isMandatory: Boolean,
    val label: String,
    val description: String,
    val packageHash: String,
    val packageSize: Int,
    val downloadUrl: String,
    val isDiffAvailable: Boolean,
    val downloadDiffUrl: String,
    val downloadDiffSize: Int,

    // base package info
    val basePackageHash: String,
    val baseDownloadUrl: String,
    val basePackageSize: Int,

    val isPending: Boolean,
    val failedInstall: Boolean,
    val isFirstRun: Boolean,

    val currentPackageDiff: DiffPackage? = null,

    // 本次返回的包是从本地缓存命中的
    val localCacheHint: Boolean = false,
) {

    fun toJsonObj(): JSONObject {
        // TODO Gson
        return JSONObject().apply {
            put("appVersion", appVersion)
            put("updateAppVersion", updateAppVersion)
            put("deploymentKey", deploymentKey)
            put("description", description)
            put("failedInstall", failedInstall)
            put("isFirstRun", isFirstRun)
            put("isMandatory", isMandatory)
            put("isPending", isPending)
            put("label", label)
            put("packageHash", packageHash)
            put("packageSize", packageSize)
            put("downloadUrl", downloadUrl)
            put("isDiffAvailable", isDiffAvailable)
            put("downloadDiffUrl", downloadDiffUrl)
            put("downloadDiffSize", downloadDiffSize)
            put("basePackageHash", basePackageHash)
            put("baseDownloadUrl", baseDownloadUrl)
            put("basePackageSize", basePackageSize)
            if (currentPackageDiff != null) {
                put("currentPackageDiff", JSONObject().also { diffPackage ->
                    diffPackage.put("isDiffAvailable", currentPackageDiff.isDiffAvailable)
                    diffPackage.put("downloadDiffUrl", currentPackageDiff.downloadDiffUrl)
                    diffPackage.put("downloadDiffSize", currentPackageDiff.downloadDiffSize)
                })
            }
            put("localCacheHint", localCacheHint)
        }
    }

}