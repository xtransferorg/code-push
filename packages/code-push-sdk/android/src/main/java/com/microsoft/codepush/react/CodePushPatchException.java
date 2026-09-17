package com.microsoft.codepush.react;

public class CodePushPatchException extends RuntimeException {
    private final int code;

    public CodePushPatchException(String message, int code) {
        super(message);
        this.code = code;
    }

    public int getCode() {
        return code;
    }
}