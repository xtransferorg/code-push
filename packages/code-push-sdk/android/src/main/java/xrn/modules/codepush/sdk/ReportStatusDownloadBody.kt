package xrn.modules.codepush.sdk

data class ReportStatusDownloadBody(
    val deploymentKey: String,
    val clientUniqueId: String? = null,
    val label: String? = null,
)
