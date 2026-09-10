package xrn.modules.codepush.sdk

data class ReportStatusDeployBody(
    var appVersion: String,
    val deploymentKey: String,
    val clientUniqueId: String? = null,

    var status: String? = null,


    var previousLabelOrAppVersion: String? = null,
    var previousDeploymentKey: String? = null,

    var label: String? = null,
    var patchFailed: Boolean? = null
) {
    companion object {
        const val DeploymentSucceeded = "DeploymentSucceeded"
        const val DeploymentFailed = "DeploymentFailed"
    }
}
