package xrn.modules.codepush

data class DiffPackage(
    val isDiffAvailable: Boolean,
    val downloadDiffUrl: String,
    val downloadDiffSize: Int,
)
