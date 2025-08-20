package com.microsoft.codepush.react;

public enum CodePushPatchState {

    START("PATCH_START"),
    DONE("PATCH_DONE"),
    ERROR("PATCH_ERROR");
    private final String value;

    CodePushPatchState(String state) {
        this.value = state;
    }

    public String getValue() {
        return this.value;
    }

}
