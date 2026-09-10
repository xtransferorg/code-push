package com.microsoft.codepush.react;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;


public class CodePushNativeModuleV2 extends ReactContextBaseJavaModule {
    CodePushNativeModuleRNDelegate mCodePushNativeModuleRNDelegate;

    public CodePushNativeModuleV2(ReactApplicationContext reactContext, CodePush codePush, CodePushUpdateManager codePushUpdateManager, CodePushTelemetryManager codePushTelemetryManager, SettingsManager settingsManager) {
        super(reactContext);
        mCodePushNativeModuleRNDelegate = new CodePushNativeModuleRNDelegate(reactContext, codePush, codePushUpdateManager, codePushTelemetryManager, settingsManager);
    }

    @Override
    public Map<String, Object> getConstants() {
        final Map<String, Object> constants = new HashMap<>();

        constants.put("codePushInstallModeImmediate", CodePushInstallMode.IMMEDIATE.getValue());
        constants.put("codePushInstallModeOnNextRestart", CodePushInstallMode.ON_NEXT_RESTART.getValue());
        constants.put("codePushInstallModeOnNextResume", CodePushInstallMode.ON_NEXT_RESUME.getValue());
        constants.put("codePushInstallModeOnNextSuspend", CodePushInstallMode.ON_NEXT_SUSPEND.getValue());

        constants.put("codePushUpdateStateRunning", CodePushUpdateState.RUNNING.getValue());
        constants.put("codePushUpdateStatePending", CodePushUpdateState.PENDING.getValue());
        constants.put("codePushUpdateStateLatest", CodePushUpdateState.LATEST.getValue());

        return constants;
    }

    @Override
    public String getName() {
        return "CodePush";
    }

    @ReactMethod
    public void downloadUpdate(final ReadableMap updatePackage, final boolean notifyProgress, final Promise promise) {
        mCodePushNativeModuleRNDelegate.downloadUpdate(this.getReactApplicationContext(), updatePackage, notifyProgress, promise);
    }

    @ReactMethod
    public void getConfiguration(Promise promise) {
        mCodePushNativeModuleRNDelegate.getConfigure(promise);
    }

    @ReactMethod
    public void getUpdateMetadata(final int updateState, final Promise promise) {
        CodePushUpdateState state = CodePushUpdateState.LATEST;

        switch (updateState) {
            case 0:
                state = CodePushUpdateState.RUNNING;
                break;
            case 1:
                state = CodePushUpdateState.PENDING;
                break;
        }

        mCodePushNativeModuleRNDelegate.getUpdateMetadata(state, promise);
    }

    @ReactMethod
    public void getNewStatusReport(final Promise promise) {
        mCodePushNativeModuleRNDelegate.getNewStatusReport(promise);
    }

    @ReactMethod
    public void installUpdate(final ReadableMap updatePackage, final int installMode, final int minimumBackgroundDuration, final Promise promise) {
        CodePushInstallMode mode = CodePushInstallMode.IMMEDIATE;

        switch (installMode) {
            case 1:
                mode = CodePushInstallMode.ON_NEXT_RESTART;
                break;
            case 2:
                mode = CodePushInstallMode.ON_NEXT_RESUME;
                break;
            case 3:
                mode = CodePushInstallMode.ON_NEXT_SUSPEND;
                break;
        }

        mCodePushNativeModuleRNDelegate.installUpdate(this.getReactApplicationContext(), updatePackage, mode, minimumBackgroundDuration, promise);
    }

    @ReactMethod
    public void isFailedUpdate(String packageHash, Promise promise) {
        try {
            promise.resolve(mCodePushNativeModuleRNDelegate.isFailedUpdate(packageHash));
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void getLatestRollbackInfo(Promise promise) {
        try {
            JSONObject latestRollbackInfo = mCodePushNativeModuleRNDelegate.getRawLatestRollbackInfo();
            if (latestRollbackInfo != null) {
                promise.resolve(CodePushUtils.convertJsonObjectToWritable(latestRollbackInfo));
            } else {
                promise.resolve(null);
            }
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void setLatestRollbackInfo(String packageHash, Promise promise) {
        try {
            mCodePushNativeModuleRNDelegate.setLatestRollbackInfo(packageHash);
            promise.resolve(null);
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void isFirstRun(String packageHash, Promise promise) {
        try {
            promise.resolve(mCodePushNativeModuleRNDelegate.isFirstRun(packageHash));
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void notifyApplicationReady(Promise promise) {
        try {
            mCodePushNativeModuleRNDelegate.notifyApplicationReady();
            promise.resolve("");
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    public void recordStatusReported(ReadableMap statusReport) {
        try {
            mCodePushNativeModuleRNDelegate.recordStatusReported(statusReport);
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
        }
    }

    @ReactMethod
    public void saveStatusReportForRetry(ReadableMap statusReport) {
        try {
            mCodePushNativeModuleRNDelegate.saveStatusReportForRetry(statusReport);
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
        }
    }

    @ReactMethod
    public void restartApp(boolean onlyIfUpdateIsPending, Promise promise) {
        try {
            boolean result = mCodePushNativeModuleRNDelegate.restartApp(getReactApplicationContext(), onlyIfUpdateIsPending);
            promise.resolve(result);
        } catch (CodePushUnknownException e) {
            CodePushUtils.log(e);
            promise.reject(e);
        }
    }

    @ReactMethod
    // Replaces the current bundle with the one downloaded from removeBundleUrl.
    // It is only to be used during tests. No-ops if the test configuration flag is not set.
    public void downloadAndReplaceCurrentBundle(String remoteBundleUrl) {
        mCodePushNativeModuleRNDelegate.downloadAndReplaceCurrentBundle(remoteBundleUrl);
    }

    /**
     * This method clears CodePush's downloaded updates.
     * It is needed to switch to a different deployment if the current deployment is more recent.
     * Note: we don’t recommend to use this method in scenarios other than that (CodePush will call
     * this method automatically when needed in other cases) as it could lead to unpredictable
     * behavior.
     */
    @ReactMethod
    public void clearUpdates() {
        mCodePushNativeModuleRNDelegate.clearUpdates();
    }

}
