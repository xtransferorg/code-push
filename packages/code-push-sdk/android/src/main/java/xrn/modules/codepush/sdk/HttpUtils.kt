package xrn.modules.codepush.sdk

import com.facebook.react.modules.network.CustomClientBuilder
import com.facebook.react.modules.network.OkHttpClientProvider
import com.microsoft.codepush.react.CodePushUtils
import okhttp3.Headers
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.GzipSource
import okio.buffer
import xrn.modules.codepush.Constants
import java.util.concurrent.TimeUnit

object HttpUtils {

    private const val DEFAULT_TIMEOUT_MILLIS = 10_000L

    private var customClientBuilder: CustomClientBuilder? = null

    /**
     * 设置自定义 OkHttp 客户端构建器，用于配置请求超时、拦截器等。
     * 应在应用启动时调用，建议只设置一次。
     * 注意：此方法非线程安全，请确保在主线程调用。
     */
    fun setCustomClientBuilder(customClientBuilder: CustomClientBuilder) {
        this.customClientBuilder = customClientBuilder
    }

    private val baseHeaders by lazy {
        Headers.Builder()
            .add("X-CodePush-Plugin-Name", Constants.CODE_PUSH_PLUGIN_NAME)
            .add("X-CodePush-Plugin-Version", Constants.CODE_PUSH_PLUGIN_VERSION)
            .add("X-CodePush-SDK-Version", Constants.CODE_PUSH_SDK_VERSION)
            .build()
    }

    fun createHttpClient(): OkHttpClient {
        return OkHttpClientProvider.getOkHttpClient()
            .newBuilder()
            .connectTimeout(DEFAULT_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)
            .readTimeout(DEFAULT_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)
            .writeTimeout(DEFAULT_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)
            .build()
    }

    fun executeRequestInternal(httpClient: OkHttpClient, originRequest: Request): ResponseBody? {
        val clientBuilder = httpClient.newBuilder()
        customClientBuilder?.apply(clientBuilder)
        val client = clientBuilder.build()

        val builder = originRequest.newBuilder()
        baseHeaders.forEach { (name, value) -> builder.addHeader(name, value) }
        val request = builder.build()

        CodePushUtils.log("Starting request: ${request.url}")

        client.newCall(request).execute().use { response ->
            if (response.code != 200) {
                CodePushUtils.log("Request failed: ${response.code}, ${response.body}")
                return null
            }

            val responseBody = response.body
            if (responseBody == null) {
                CodePushUtils.log("Request failed: ${response.code}, response body is null")
                return null
            }

            val contentType = response.header("Content-Type")?.toMediaType()
            val bodyBytes =
                if ("gzip".equals(response.header("Content-Encoding"), ignoreCase = true)) {
                    GzipSource(responseBody.source()).buffer().use { source ->
                        source.readByteArray()
                    }
                } else {
                    responseBody.bytes()
                }

            return bodyBytes.toResponseBody(contentType)
        }
    }

}