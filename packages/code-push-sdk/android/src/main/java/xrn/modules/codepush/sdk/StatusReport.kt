package xrn.modules.codepush.sdk

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.google.gson.annotations.SerializedName
import xrn.modules.codepush.LocalPackage

data class StatusReport(
    val appVersion: String? = null,
    val status: String? = null,

    val previousLabelOrAppVersion: String? = null,
    val previousDeploymentKey: String? = null,

    @SerializedName("package")
    val localPackage: LocalPackage? = null
) {
    fun toReadable(): ReadableMap {
        return Arguments.createMap().apply {
            putString("appVersion", appVersion)
            putString("status", status)
            putString("previousLabelOrAppVersion", previousLabelOrAppVersion)
            putString("previousDeploymentKey", previousDeploymentKey)
            localPackage?.let { putMap("localPackage", it.toReadable()) }
        }
    }
}
