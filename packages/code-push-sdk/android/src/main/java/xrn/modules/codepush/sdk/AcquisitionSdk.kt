package xrn.modules.codepush.sdk

import com.microsoft.codepush.react.CodePushConfiguration
import com.microsoft.codepush.react.CodePushUtils
import com.microsoft.codepush.react.GsonUtils
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okio.IOException
import xrn.modules.codepush.LocalPackage
import xrn.modules.codepush.RemotePackage

class AcquisitionSdk(
    private val httpClient: OkHttpClient,
    private val config: CodePushConfiguration
) {

    @Throws(IOException::class)
    fun queryUpdateWithCurrentPackage(
        currentPackage: LocalPackage?,
        basePackageHash: String?,
        useCache: Boolean = false,
        staleTime: Long? = null,
    ): RemotePackage? {
        if (currentPackage == null || currentPackage.appVersion.isBlank()) {
            CodePushUtils.log("Calling common acquisition SDK with incorrect package")
            return null
        }

        if (useCache) {
            val cache = PreFetchSdk.getRemotePackage(
                config.deploymentKey,
                currentPackage.appVersion,
                currentPackage.label,
                currentPackage.packageHash,
                basePackageHash,
                staleTime,
            )
            if (cache != null) {
                if (!cache.isAvailable || cache.downloadUrl.isBlank()) {
                    return null
                }
                return cache
            }
        }

        val url = createHttpUrlBuilder()
            .addPathSegment("updateCheck")
            .addQueryParameter("deploymentKey", config.deploymentKey)
            .addQueryParameter("clientUniqueId", config.clientUniqueId)
            .addQueryParameter("commonHash", config.commonHash)
            .addQueryParameter("isCompanion", null)
            .addQueryParameter("appVersion", currentPackage.appVersion)
            .addQueryParameter("packageHash", currentPackage.packageHash)
            .addQueryParameter("label", currentPackage.label)
            .addQueryParameter("basePackageHash", basePackageHash)
            .build()

        val request = Request.Builder()
            .get()
            .url(url)
            .build()

        val responseBody = HttpUtils.executeRequestInternal(httpClient, request) ?: return null
        val updateInfo = GsonUtils.fromJson<UpdateResponse>(responseBody.string())?.updateInfo
            ?: return null
        if (!updateInfo.isAvailable || updateInfo.downloadUrl.isBlank()) {
            return null
        }

        return updateInfo.copy(deploymentKey = config.deploymentKey)
    }

    fun reportStatusDownload(
        downloadPackage: LocalPackage?,
    ): Boolean {
        val body = ReportStatusDownloadBody(
            deploymentKey = config.deploymentKey,
            clientUniqueId = config.clientUniqueId,
            label = downloadPackage?.label,
        )

        try {
            val url = createHttpUrlBuilder()
                .addPathSegment("reportStatus")
                .addPathSegment("download")
                .build()

            val requestBody = GsonUtils.toJson(body).toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url(url)
                .post(requestBody)
                .build()

            HttpUtils.executeRequestInternal(httpClient, request) ?: return false

            return true
        } catch (e: IOException) {
            CodePushUtils.log(e)
            return false
        }
    }

    fun reportStatusDeploy(
        deployedPackage: LocalPackage?,
        status: String?,
        previousLabelOrAppVersion: String?,
        previousDeploymentKey: String?,
    ): Boolean {
        val body = ReportStatusDeployBody(
            appVersion = deployedPackage?.appVersion ?: config.appVersion,
            deploymentKey = config.deploymentKey,
            clientUniqueId = config.clientUniqueId,

            previousLabelOrAppVersion = previousLabelOrAppVersion,
            previousDeploymentKey = previousDeploymentKey,
        )

        if (deployedPackage != null) {
            body.label = deployedPackage.label
            body.appVersion = deployedPackage.appVersion
            body.patchFailed = deployedPackage.patchFailed

            when (status) {
                ReportStatusDeployBody.DeploymentSucceeded,
                ReportStatusDeployBody.DeploymentFailed -> {
                    body.status = status
                }

                null -> {
                    CodePushUtils.log("reportStatusDeploy Status is null")
                    return false
                }

                else -> {
                    CodePushUtils.log("reportStatusDeploy Invalid status: $status")
                    return false
                }
            }
        }

        try {
            val url = createHttpUrlBuilder()
                .addPathSegment("reportStatus")
                .addPathSegment("deploy")
                .build()

            val requestBody = GsonUtils.toJson(body).toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url(url)
                .post(requestBody)
                .build()

            HttpUtils.executeRequestInternal(httpClient, request) ?: return false

            return true
        } catch (e: IOException) {
            CodePushUtils.log(e)
            return false
        }
    }

    private fun createHttpUrlBuilder(): HttpUrl.Builder {
        return config.serverUrl.toHttpUrl().newBuilder()
    }

}
