package xrn.modules.codepush

data class RollbackInfo(
    val packageHash: String,
    val time: Long,
    val count: Int
)
