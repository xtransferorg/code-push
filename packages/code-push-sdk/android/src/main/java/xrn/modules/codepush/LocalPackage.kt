package xrn.modules.codepush

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableNativeMap
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
data class LocalPackage(
    val appVersion: String,
    val deploymentKey: String? = null,
    val description: String? = null,
    val failedInstall: Boolean? = null,
    val isFirstRun: Boolean? = null,
    val isMandatory: Boolean? = null,
    val isPending: Boolean? = null,
    val label: String? = null,
    val packageHash: String? = null,
    val packageSize: Int? = null,
    val isDebugOnly: Boolean = false,
    val patchFailed: Boolean? = null,
) {

    fun toJsonObj(): JSONObject {
        // TODO Gson
        return JSONObject().apply {
            put("appVersion", appVersion)
            putOpt("deploymentKey", deploymentKey)
            putOpt("description", description)
            putOpt("failedInstall", failedInstall)
            putOpt("isFirstRun", isFirstRun)
            putOpt("isMandatory", isMandatory)
            putOpt("isPending", isPending)
            putOpt("label", label)
            putOpt("packageHash", packageHash)
            putOpt("packageSize", packageSize)
            put("isDebugOnly", isDebugOnly)
            putOpt("patchFailed", patchFailed)
        }
    }

    fun toReadable(): ReadableMap {
        return Arguments.createMap().apply {
            putString("appVersion", appVersion)
            putString("deploymentKey", deploymentKey)
            putString("description", description)
            putBoolean("failedInstall", failedInstall ?: false)
            putBoolean("isFirstRun", isFirstRun ?: false)
            putBoolean("isMandatory", isMandatory ?: false)
            putBoolean("isPending", isPending ?: false)
            putString("label", label)
            putString("packageHash", packageHash)
            putInt("packageSize", packageSize ?: 0)
            putBoolean("isDebugOnly", isDebugOnly)
            putBoolean("patchFailed", patchFailed ?: false)
        }
    }

}
