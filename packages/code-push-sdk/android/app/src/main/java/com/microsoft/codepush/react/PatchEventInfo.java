package com.microsoft.codepush.react;

import org.json.JSONException;
import org.json.JSONObject;

public class PatchEventInfo {

    private String state;
    private int code;

    public PatchEventInfo(String state, int code) {
        this.state = state;
        this.code = code;
    }

    public String getState() {
        return state;
    }

    public void setState(String state) {
        this.state = state;
    }

    public int getCode() {
        return code;
    }

    public void setCode(int code) {
        this.code = code;
    }

    public JSONObject toJson() {
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("state", state);
            jsonObject.put("code", code);
        } catch (JSONException e) {
            throw new RuntimeException(e);
        }
        return jsonObject;
    }
}
