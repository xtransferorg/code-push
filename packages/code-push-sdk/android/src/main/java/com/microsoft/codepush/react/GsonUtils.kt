package com.microsoft.codepush.react

import com.google.gson.GsonBuilder
import com.google.gson.JsonSyntaxException
import org.json.JSONObject

object GsonUtils {

    val gson by lazy {
        GsonBuilder().serializeNulls().disableHtmlEscaping().create()
    }

    fun toJson(obj: Any): String {
        return try {
            gson.toJson(obj)
        } catch (e: Exception) {
            CodePushUtils.log(e)
            "{}"
        }
    }

    // TODO 两次序列化问题
    inline fun <reified T> fromJsonObj(jsonObject: JSONObject): T? {
        return fromJson<T>(jsonObject.toString())
    }

    inline fun <reified T> fromJson(json: String): T? {
        return try {
            gson.fromJson(json, T::class.java)
        } catch (e: JsonSyntaxException) {
            CodePushUtils.log(e)
            null
        }
    }

}