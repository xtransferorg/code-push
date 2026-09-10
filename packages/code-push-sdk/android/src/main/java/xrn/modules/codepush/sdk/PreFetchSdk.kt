package xrn.modules.codepush.sdk

import com.microsoft.codepush.react.CodePushConfiguration
import com.microsoft.codepush.react.CodePushUtils
import com.microsoft.codepush.react.GsonUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.lang.System.currentTimeMillis
import java.util.concurrent.ConcurrentHashMap
import xrn.modules.codepush.LocalPackage
import xrn.modules.codepush.RemotePackage

object PreFetchSdk {

    private val mainScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val httpClient: OkHttpClient by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        HttpUtils.createHttpClient()
    }

    private val jsonMediaType = "application/json".toMediaType()

    private val checkUpdateCache = ConcurrentHashMap<String, CachedRemotePackage>()

    fun getRemotePackage(
        depKey: String,
        appVersion: String,
        label: String?,
        packageHash: String?,
        basePackageHash: String?,
        staleTime: Long? = null,
    ): RemotePackage? {
        val cache = checkUpdateCache[depKey] ?: return null
        if (staleTime != null
            && currentTimeMillis() - cache.cachedAtMillis > staleTime
        ) {
            return null
        }

        return cache.remotePackage.takeIf {
            appVersion == it.appVersion
                    && isLabelNewer(newer = it.label, older = label)
        }
    }

    fun preFetchUpdates(params: List<Pair<CodePushConfiguration, LocalPackage?>>) {
        val requestItems = params.map { (config, localPackage) ->
            BatchUpdateCheckRequestItem(
                deploymentKey = config.deploymentKey,
                label = localPackage?.label,
                packageHash = localPackage?.packageHash,
                commonHash = config.commonHash,
                basePackageHash = config.packageHash,
            )
        }

        if (requestItems.isNotEmpty()) {
            preFetchUpdates(params.first().first, requestItems)
        }
    }

    fun preFetchUpdates(config: CodePushConfiguration, items: List<BatchUpdateCheckRequestItem>) {
        mainScope.launch {
            val result = withContext(Dispatchers.IO) {
                batchUpdateCheck(this@PreFetchSdk.httpClient, config, items)
            }

            result?.forEach { item ->
                item.updateInfo?.let {
                    checkUpdateCache[item.deploymentKey] = CachedRemotePackage(
                        remotePackage = it,
                        cachedAtMillis = currentTimeMillis(),
                    )
                }
            }
        }
    }

    private fun batchUpdateCheck(
        httpClient: OkHttpClient,
        config: CodePushConfiguration,
        items: List<BatchUpdateCheckRequestItem>,
    ): List<BatchUpdateCheckResultItem>? {
        if (items.isEmpty()) {
            CodePushUtils.log("batchUpdateCheck: items is empty, skip request.")
            return null
        }

        return try {
            val url = config.serverUrl.toHttpUrl().newBuilder()
                .addPathSegment("batchUpdateCheck")
                .build()

            val payload = BatchUpdateCheckRequest(
                appVersion = config.appVersion,
                clientUniqueId = config.clientUniqueId,
                items = items,
            )

            val requestBody = GsonUtils.toJson(payload).toRequestBody(jsonMediaType)

            val request = Request.Builder()
                .url(url)
                .post(requestBody)
                .build()

            val responseBody = HttpUtils.executeRequestInternal(httpClient, request) ?: return null
            GsonUtils.fromJson<BatchUpdateCheckResponse>(responseBody.string())?.updateInfos
        } catch (e: Throwable) {
            CodePushUtils.log(e)
            null
        }
    }

    /**
     * 比较两个 label（约定形如 `v\d+`）。返回 true 表示 [newer] 严格新于 [older]。
     */
    private fun isLabelNewer(newer: String?, older: String?): Boolean {
        if (newer.isNullOrBlank()) return true
        if (older.isNullOrBlank()) return true

        val newerNum = newer.trimStart('v').toIntOrNull() ?: return false
        val olderNum = older.trimStart('v').toIntOrNull() ?: return false
        return newerNum > olderNum
    }
}

data class BatchUpdateCheckRequestItem(
    val deploymentKey: String,
    val label: String? = null,
    val packageHash: String? = null,
    val basePackageHash: String? = null,
    val commonHash: String? = null,
)

/** `POST /batchUpdateCheck` 请求体。 */
data class BatchUpdateCheckRequest(
    val appVersion: String,
    val clientUniqueId: String,
    val items: List<BatchUpdateCheckRequestItem>,
)

/** `POST /batchUpdateCheck` 响应体。 */
data class BatchUpdateCheckResponse(
    val updateInfos: List<BatchUpdateCheckResultItem> = emptyList(),
)

/**
 * 与请求 items 中某个 deploymentKey 对应的查询结果；
 * [updateInfo] 为 null 表示该 key 查询失败或无可用更新，但不影响批次内其它项。
 */
data class BatchUpdateCheckResultItem(
    val deploymentKey: String,
    val updateInfo: RemotePackage? = null,
)

private data class CachedRemotePackage(
    val remotePackage: RemotePackage,
    val cachedAtMillis: Long,
)