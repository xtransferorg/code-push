package com.microsoft.codepush.react;

import android.content.Context;
import android.text.TextUtils;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.ByteBuffer;

import com.github.sisong.HPatch;

public class CodePushUpdateManager {

    private String mDocumentsDirectory;
    private String deploymentKey;
    private Context context;

    public CodePushUpdateManager(Context context, String documentsDirectory, String deploymentKey) {
        mDocumentsDirectory = documentsDirectory;
        this.deploymentKey = deploymentKey;
        this.context = context;
    }

    private String getDownloadFilePath() {
        return CodePushUtils.appendPathComponent(getCodePushPath(), CodePushConstants.DOWNLOAD_FILE_NAME);
    }

    private String getUnzippedFolderPath() {
        return CodePushUtils.appendPathComponent(getCodePushPath(), CodePushConstants.UNZIPPED_FOLDER_NAME);
    }

    private String getDocumentsDirectory() {
        return mDocumentsDirectory;
    }

    private String getCodePushPath() {
        String codePushPath = CodePushUtils.appendPathComponent(getDocumentsDirectory(), this.deploymentKey + CodePushConstants.CODE_PUSH_FOLDER_PREFIX);
        if (CodePush.isUsingTestConfiguration()) {
            codePushPath = CodePushUtils.appendPathComponent(codePushPath, "TestPackages");
        }

        return codePushPath;
    }

    private String getStatusFilePath() {
        return CodePushUtils.appendPathComponent(getCodePushPath(), CodePushConstants.STATUS_FILE);
    }

    public JSONObject getCurrentPackageInfo() {
        String statusFilePath = getStatusFilePath();
        if (!FileUtils.fileAtPathExists(statusFilePath)) {
            return new JSONObject();
        }

        try {
            return CodePushUtils.getJsonObjectFromFile(statusFilePath);
        } catch (IOException e) {
            // Should not happen.
            throw new CodePushUnknownException("Error getting current package info", e);
        }
    }

    public void updateCurrentPackageInfo(JSONObject packageInfo) {
        try {
            CodePushUtils.writeJsonToFile(packageInfo, getStatusFilePath());
        } catch (IOException e) {
            // Should not happen.
            throw new CodePushUnknownException("Error updating current package info", e);
        }
    }

    public String getCurrentPackageFolderPath() {
        JSONObject info = getCurrentPackageInfo();
        String packageHash = info.optString(CodePushConstants.CURRENT_PACKAGE_KEY, null);
        if (packageHash == null) {
            return null;
        }

        return getPackageFolderPath(packageHash);
    }

    public String getCurrentPackageBundlePath(String bundleFileName) {
        String packageFolder = getCurrentPackageFolderPath();
        if (packageFolder == null) {
            return null;
        }

        JSONObject currentPackage = getCurrentPackage();
        if (currentPackage == null) {
            return null;
        }

        String relativeBundlePath = currentPackage.optString(CodePushConstants.RELATIVE_BUNDLE_PATH_KEY, null);
        if (relativeBundlePath == null) {
            return CodePushUtils.appendPathComponent(packageFolder, bundleFileName);
        } else {
            return CodePushUtils.appendPathComponent(packageFolder, relativeBundlePath);
        }
    }

    public String getPackageFolderPath(String packageHash) {
        return CodePushUtils.appendPathComponent(getCodePushPath(), packageHash);
    }

    public String getCurrentPackageHash() {
        JSONObject info = getCurrentPackageInfo();
        return info.optString(CodePushConstants.CURRENT_PACKAGE_KEY, null);
    }

    public String getPreviousPackageHash() {
        JSONObject info = getCurrentPackageInfo();
        return info.optString(CodePushConstants.PREVIOUS_PACKAGE_KEY, null);
    }

    public JSONObject getCurrentPackage() {
        String packageHash = getCurrentPackageHash();
        if (packageHash == null) {
            return null;
        }

        return getPackage(packageHash);
    }

    public JSONObject getPreviousPackage() {
        String packageHash = getPreviousPackageHash();
        if (packageHash == null) {
            return null;
        }

        return getPackage(packageHash);
    }

    private String getBasePackageHashKey() {
        return CodePushConstants.BASE_PACKAGE_KEY;
    }

    public void setBasePackageHash(String newBasePackageHash) {
        JSONObject currentPackageInfo = getCurrentPackageInfo();
        CodePushUtils.setJSONValueForKey(currentPackageInfo, getBasePackageHashKey(), newBasePackageHash);
        updateCurrentPackageInfo(currentPackageInfo);
    }

    public String getBasePackageHash() {
        JSONObject currentPackageInfo = getCurrentPackageInfo();
        if (currentPackageInfo == null) {
            return null;
        }

        String packageHash = currentPackageInfo.optString(getBasePackageHashKey(), null);
        if (packageHash == null) {
            return null;
        }

        JSONObject basePackage = getPackage(packageHash);
        if (basePackage == null || !CodePushUpdateUtils.isPackageBundleLatest(context, basePackage)) {
            return null;
        }

        return packageHash;
    }

    public JSONObject getBasePackage() {
        String packageHash = getBasePackageHash();
        if (packageHash == null) {
            return null;
        }

        return getPackage(packageHash);
    }

    public String getBasePackageFolderPath() {
        String packageHash = getBasePackageHash();
        if (packageHash == null) {
            return null;
        }

        return getPackageFolderPath(packageHash);
    }

    public String getBasePackageBundlePath(String bundleFileName) {
        String packageFolder = getBasePackageFolderPath();
        if (packageFolder == null) {
            return null;
        }

        JSONObject basePackage = getBasePackage();
        if (basePackage == null) {
            return null;
        }

        String relativeBundlePath = basePackage.optString(CodePushConstants.RELATIVE_BUNDLE_PATH_KEY, null);
        if (relativeBundlePath == null) {
            return CodePushUtils.appendPathComponent(packageFolder, bundleFileName);
        } else {
            return CodePushUtils.appendPathComponent(packageFolder, relativeBundlePath);
        }
    }

    public String getBinaryContentsHash(boolean isDebugMode) {
        String hash = CodePushUpdateUtils.getHashForBinaryContents(context, deploymentKey, isDebugMode);
        if (TextUtils.isEmpty(hash)) {
            return getBasePackageHash();
        }

        return hash;
    }

    public JSONObject getPackage(String packageHash) {
        String folderPath = getPackageFolderPath(packageHash);
        String packageFilePath = CodePushUtils.appendPathComponent(folderPath, CodePushConstants.PACKAGE_FILE_NAME);
        try {
            return CodePushUtils.getJsonObjectFromFile(packageFilePath);
        } catch (IOException e) {
            return null;
        }
    }

    public JSONObject obtainCurrentDiffPackage(JSONObject updatePackage) {
        try {
            if (updatePackage.has(CodePushConstants.CURRENT_PACKAGE_DIFF_KEY)) {
                return updatePackage.getJSONObject(CodePushConstants.CURRENT_PACKAGE_DIFF_KEY);
            }
        } catch (JSONException e) {
            CodePushUtils.log("Obtain current package diff from update package error.");
        }

        return null;
    }

    public void downloadPackage(JSONObject updatePackage, String expectedBundleFileName, DownloadProgressCallback progressCallback, String stringPublicKey) throws IOException {
        String basePackageHash = updatePackage.optString(CodePushConstants.BASE_PACKAGE_KEY, null);
        String newUpdateHash = updatePackage.optString(CodePushConstants.PACKAGE_HASH_KEY, null);
        boolean isNewPackageSameAsBase = newUpdateHash != null && newUpdateHash.equals(basePackageHash);
        boolean isDiffAvailable = updatePackage.optBoolean(CodePushConstants.DIFF_AVAILABLE, false);
        long basePackageSize = updatePackage.optLong(CodePushConstants.BASE_PACKAGE_SIZE_KEY, 0);
        long newPackageSize = updatePackage.optLong(CodePushConstants.PACKAGE_SIZE_KEY, 0);
        long diffPackageSize = updatePackage.optLong(CodePushConstants.DOWNLOAD_DIFF_SIZE_KEY, 0);
        long totalDownloadSize = isNewPackageSameAsBase ? 0 : isDiffAvailable ? diffPackageSize : newPackageSize;
        boolean isBasePackageNeeded = false;

        if (!CodePushUpdateUtils.isAssetBundleFileExists(context, expectedBundleFileName)) {
            JSONObject basePackage = getBasePackage();
            if (basePackage == null) {
                try {
                    basePackage = new JSONObject(updatePackage.toString());
                } catch (JSONException e) {
                    CodePushUtils.log(e);
                }
                if (basePackage == null) {
                    throw new CodePushInvalidUpdateException("Unable to download base package because it was not included in the update and no base package is currently installed.");
                }
                try {
                    String baseDownloadUrl = basePackage.optString(CodePushConstants.BASE_DOWNLOAD_URL_KEY, null);
                    if (TextUtils.isEmpty(basePackageHash) || TextUtils.isEmpty(baseDownloadUrl)) {
                        throw new CodePushInvalidUpdateException("Unable to download base package because basePackageHash or baseDownloadUrl is null.");
                    }

                    basePackage.put(CodePushConstants.PACKAGE_HASH_KEY, basePackageHash);
                    basePackage.put(CodePushConstants.DIFF_AVAILABLE, false);
                    basePackage.put(CodePushConstants.DOWNLOAD_URL_KEY, baseDownloadUrl);
                } catch (JSONException e) {
                    throw new CodePushInvalidUpdateException("Unable to download base package because base package info is invalid.");
                }
                isBasePackageNeeded = true;
                totalDownloadSize += basePackageSize;
                DownloadProgressCallback customCallback = new CustomDownloadProgressCallback(
                        totalDownloadSize,
                        0,
                        progressCallback
                );
                doDownloadPackage(basePackage, false, expectedBundleFileName, customCallback, stringPublicKey);
                // After downloading the base package, we need to set the base package hash in the current package info.
                setBasePackageHash(basePackageHash);
            }
        }

        if (!isNewPackageSameAsBase) {
            boolean isCurrentDiffPackageDownloadSuccess = false;
            try {
                CodePushUtils.log("Download current diff package start...");
                isCurrentDiffPackageDownloadSuccess = downloadCurrentDiffPackage(updatePackage, expectedBundleFileName, progressCallback, stringPublicKey);
                CodePushUtils.log("Download current diff package " + (isCurrentDiffPackageDownloadSuccess ? "success" : "failed"));
            } catch (Exception e) {
                CodePushUtils.log("Download current diff package error. " + e.getMessage());
            }

            if (!isCurrentDiffPackageDownloadSuccess) {
                DownloadProgressCallback customCallback = new CustomDownloadProgressCallback(
                        totalDownloadSize,
                        isBasePackageNeeded ? basePackageSize : 0,
                        progressCallback
                );

                doDownloadPackage(updatePackage, false, expectedBundleFileName, customCallback, stringPublicKey);
            }
        }
    }

    private boolean downloadCurrentDiffPackage(
            JSONObject updatePackage,
            String expectedBundleFileName,
            DownloadProgressCallback progressCallback,
            String stringPublicKey
    ) throws Exception {

        JSONObject currentPackageDiffPackage = obtainCurrentDiffPackage(updatePackage);
        if (currentPackageDiffPackage == null) return false;
        final String downloadDiffUrl = currentPackageDiffPackage.optString(CodePushConstants.DOWNLOAD_DIFF_URL_KEY);
        final boolean isDiffAvailable = currentPackageDiffPackage.optBoolean(CodePushConstants.DIFF_AVAILABLE);
        if (TextUtils.isEmpty(downloadDiffUrl) || !isDiffAvailable) return false;

        JSONObject updatePackageForked = new JSONObject(updatePackage.toString());
        updatePackageForked.put(CodePushConstants.DOWNLOAD_DIFF_URL_KEY, downloadDiffUrl);
        updatePackageForked.put(CodePushConstants.DIFF_AVAILABLE, true);

        // TODO 进度条
        doDownloadPackage(updatePackageForked, true, expectedBundleFileName, progressCallback, stringPublicKey);

        return true;
    }

    private void doDownloadPackage(JSONObject updatePackage, boolean isCurrentDiffPackage, String expectedBundleFileName, DownloadProgressCallback progressCallback, String stringPublicKey) throws IOException {
        String newUpdateHash = updatePackage.optString(CodePushConstants.PACKAGE_HASH_KEY, null);
        String newUpdateFolderPath = getPackageFolderPath(newUpdateHash);
        String newUpdateMetadataPath = CodePushUtils.appendPathComponent(newUpdateFolderPath, CodePushConstants.PACKAGE_FILE_NAME);
        if (FileUtils.fileAtPathExists(newUpdateFolderPath)) {
            // This removes any stale data in newPackageFolderPath that could have been left
            // uncleared due to a crash or error during the download or install process.
            FileUtils.deleteDirectoryAtPath(newUpdateFolderPath);
        }
        Boolean isDiff = updatePackage.optBoolean(CodePushConstants.DIFF_AVAILABLE, false);
        File downloadFolder = new File(getCodePushPath());
        downloadFolder.mkdirs();
        File downloadFile = new File(downloadFolder, CodePushConstants.DOWNLOAD_FILE_NAME);
        boolean isZip = false;
        if (isDiff) {
            isZip = downloadBundle(updatePackage, downloadFile, CodePushConstants.DOWNLOAD_DIFF_URL_KEY, progressCallback);
            try {
                if (isZip) {
                    throw new CodePushInvalidUpdateException("diff包格式不能为zip格式");
                }
                progressCallback.patchEvent(CodePushPatchState.START, 0);
                CodePushUtils.log("Patch diff update start.");
                final int result = patchUpdatePackage(downloadFile, isCurrentDiffPackage, newUpdateFolderPath, expectedBundleFileName);
                CodePushUtils.log("Patch diff update done.");
                progressCallback.patchEvent(CodePushPatchState.DONE, result);
                CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.RELATIVE_BUNDLE_PATH_FAILED, false);
            } catch (Exception e) {
                CodePushUtils.log("Applying diff update error." + e.getMessage());
                CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.RELATIVE_BUNDLE_PATH_FAILED, true);
                isZip = downloadBundle(updatePackage, downloadFile, CodePushConstants.DOWNLOAD_URL_KEY, progressCallback);
                if (!isCurrentDiffPackage) {
                    if (e instanceof CodePushPatchException) {
                        progressCallback.patchEvent(CodePushPatchState.ERROR, ((CodePushPatchException) e).getCode());
                    } else {
                        progressCallback.patchEvent(CodePushPatchState.ERROR, -1);
                    }
                }
            }
        } else {
            isZip = downloadBundle(updatePackage, downloadFile, CodePushConstants.DOWNLOAD_URL_KEY, progressCallback);
        }

        // zip与 diff 文件需要加密与codePush校验
        if (isZip || isDiff) {
            boolean isDiffUpdate = false;
            if (isZip) {
                // Unzip the downloaded file and then delete the zip
                String unzippedFolderPath = getUnzippedFolderPath();
                FileUtils.unzipFile(downloadFile, unzippedFolderPath);
                FileUtils.deleteFileOrFolderSilently(downloadFile);

                // Merge contents with current update based on the manifest
                String diffManifestFilePath = CodePushUtils.appendPathComponent(unzippedFolderPath,
                        CodePushConstants.DIFF_MANIFEST_FILE_NAME);
                FileUtils.fileAtPathExists(diffManifestFilePath);
                if (isDiffUpdate) {
                    String currentPackageFolderPath = getCurrentPackageFolderPath();
                    CodePushUpdateUtils.copyNecessaryFilesFromCurrentPackage(diffManifestFilePath, currentPackageFolderPath, newUpdateFolderPath);
                    File diffManifestFile = new File(diffManifestFilePath);
                    diffManifestFile.delete();
                }

                FileUtils.copyDirectoryContents(unzippedFolderPath, newUpdateFolderPath);
                FileUtils.deleteFileAtPathSilently(unzippedFolderPath);

            }
            // For zip updates, we need to find the relative path to the jsBundle and save it in the
            // metadata so that we can find and run it easily the next time.
            String relativeBundlePath = CodePushUpdateUtils.findJSBundleInUpdateContents(newUpdateFolderPath, expectedBundleFileName);

            if (relativeBundlePath == null) {
                throw new CodePushInvalidUpdateException("Update is invalid - A JS bundle file named \"" + expectedBundleFileName + "\" could not be found within the downloaded contents. Please check that you are releasing your CodePush updates using the exact same JS bundle file name that was shipped with your app's binary.");
            } else {
                if (FileUtils.fileAtPathExists(newUpdateMetadataPath)) {
                    File metadataFileFromOldUpdate = new File(newUpdateMetadataPath);
                    metadataFileFromOldUpdate.delete();
                }

                if (isDiffUpdate) {
                    CodePushUtils.log("Applying diff update.");
                } else {
                    CodePushUtils.log("Applying full update.");
                }

                boolean isSignatureVerificationEnabled = (stringPublicKey != null);

                String signaturePath = CodePushUpdateUtils.getSignatureFilePath(newUpdateFolderPath);
                boolean isSignatureAppearedInBundle = FileUtils.fileAtPathExists(signaturePath);

                if (isSignatureVerificationEnabled) {
                    if (isSignatureAppearedInBundle) {
                        CodePushUpdateUtils.verifyFolderHash(newUpdateFolderPath, newUpdateHash);
                        CodePushUpdateUtils.verifyUpdateSignature(newUpdateFolderPath, newUpdateHash, stringPublicKey);
                    } else {
                        throw new CodePushInvalidUpdateException(
                                "Error! Public key was provided but there is no JWT signature within app bundle to verify. " +
                                        "Possible reasons, why that might happen: \n" +
                                        "1. You've been released CodePush bundle update using version of CodePush CLI that is not support code signing.\n" +
                                        "2. You've been released CodePush bundle update without providing --privateKeyPath option."
                        );
                    }
                } else {
                    if (isSignatureAppearedInBundle) {
                        CodePushUtils.log(
                                "Warning! JWT signature exists in codepush update but code integrity check couldn't be performed because there is no public key configured. " +
                                        "Please ensure that public key is properly configured within your application."
                        );
                        CodePushUpdateUtils.verifyFolderHash(newUpdateFolderPath, newUpdateHash);
                    } else {
                        if (isDiffUpdate) {
                            CodePushUpdateUtils.verifyFolderHash(newUpdateFolderPath, newUpdateHash);
                        }
                    }
                }

                CodePushUtils.setJSONValueForKey(updatePackage, CodePushConstants.RELATIVE_BUNDLE_PATH_KEY, relativeBundlePath);
            }
        } else {
            // File is a jsbundle, move it to a folder with the packageHash as its name
            FileUtils.moveFile(downloadFile, newUpdateFolderPath, expectedBundleFileName);
        }

        // Save metadata to the folder.
        CodePushUtils.writeJsonToFile(updatePackage, newUpdateMetadataPath);
    }

    public int patchUpdatePackage(File downloadFile, boolean isCurrentDiffPackage, String newUpdateFolderPath, String expectedBundleFileName) throws IOException {
        String cacheDirPath = context.getCacheDir() + CodePushConstants.BASE_FILE_NAME;
        File baseDir = null;
        if (isCurrentDiffPackage) {
            String currentPackageBundlePath = getCurrentPackageBundlePath(expectedBundleFileName);
            if (currentPackageBundlePath == null) {
                throw new CodePushInvalidUpdateException("Current diff package patch error. 无法找到base包，diff包无法patch");
            }
            baseDir = FileUtils.copyFileToDirectory(currentPackageBundlePath, cacheDirPath);
        } else {
            String binaryJSBundleUrl = getBinaryJSBundleUrl(expectedBundleFileName);
            if (binaryJSBundleUrl == null) {
                throw new CodePushInvalidUpdateException("Base diff Package patch error. 无法找到base包，diff包无法patch");
            }

            if (binaryJSBundleUrl.startsWith(CodePushConstants.ASSETS_BUNDLE_PREFIX)) {
                baseDir = FileUtils.copyAssetToFolder(this.context, cacheDirPath, expectedBundleFileName);
            } else {
                baseDir = FileUtils.copyFileToDirectory(binaryJSBundleUrl, cacheDirPath);
            }
        }
        int result = HPatch.patch(baseDir.getPath(), downloadFile.getAbsolutePath(), newUpdateFolderPath);
        if (result != 0) {
            throw new CodePushPatchException("diff包 patch失败", result);
        }
        CodePushUtils.log("Applying  bundle diff update." + result);
        return result;
    }

    public Boolean downloadBundle(JSONObject updatePackage, File downloadFile, String url, DownloadProgressCallback progressCallback) throws IOException {
        String downloadUrlString = updatePackage.optString(url, null);
        HttpURLConnection connection = null;
        BufferedInputStream bin = null;
        FileOutputStream fos = null;
        BufferedOutputStream bout = null;

        // Download the file while checking if it is a zip and notifying client of progress.
        try {
            URL downloadUrl = new URL(downloadUrlString);
            connection = (HttpURLConnection) (downloadUrl.openConnection());
            connection.setRequestProperty("Accept-Encoding", "identity");
            bin = new BufferedInputStream(connection.getInputStream());

            long totalBytes = connection.getContentLength();
            long receivedBytes = 0;


            fos = new FileOutputStream(downloadFile);
            bout = new BufferedOutputStream(fos, CodePushConstants.DOWNLOAD_BUFFER_SIZE);
            byte[] data = new byte[CodePushConstants.DOWNLOAD_BUFFER_SIZE];
            byte[] header = new byte[4];

            int numBytesRead = 0;
            while ((numBytesRead = bin.read(data, 0, CodePushConstants.DOWNLOAD_BUFFER_SIZE)) >= 0) {
                if (receivedBytes < 4) {
                    for (int i = 0; i < numBytesRead; i++) {
                        int headerOffset = (int) (receivedBytes) + i;
                        if (headerOffset >= 4) {
                            break;
                        }

                        header[headerOffset] = data[i];
                    }
                }

                receivedBytes += numBytesRead;
                bout.write(data, 0, numBytesRead);
                progressCallback.call(new DownloadProgress(totalBytes, receivedBytes));
            }

            if (totalBytes != receivedBytes) {
                throw new CodePushUnknownException("Received " + receivedBytes + " bytes, expected " + totalBytes);
            }

            return ByteBuffer.wrap(header).getInt() == 0x504b0304;
        } catch (MalformedURLException e) {
            throw new CodePushMalformedDataException(downloadUrlString, e);
        } finally {
            try {
                if (bout != null) bout.close();
                if (fos != null) fos.close();
                if (bin != null) bin.close();
                if (connection != null) connection.disconnect();
            } catch (IOException e) {
                throw new CodePushUnknownException("Error closing IO resources.", e);
            }
        }
    }

    public void installPackage(JSONObject updatePackage, boolean removePendingUpdate) {
        String packageHash = updatePackage.optString(CodePushConstants.PACKAGE_HASH_KEY, null);
        String basePackageHash = getBasePackageHash();
        if (TextUtils.isEmpty(basePackageHash)) {
            basePackageHash = updatePackage.optString(CodePushConstants.BASE_PACKAGE_KEY, null);
        }
        JSONObject info = getCurrentPackageInfo();

        String currentPackageHash = info.optString(CodePushConstants.CURRENT_PACKAGE_KEY, null);
        if (packageHash != null && packageHash.equals(currentPackageHash)) {
            // The current package is already the one being installed, so we should no-op.
            return;
        }

        if (removePendingUpdate) {
            String currentPackageFolderPath = getCurrentPackageFolderPath();
            if (currentPackageFolderPath != null) {
                FileUtils.deleteDirectoryAtPath(currentPackageFolderPath);
            }
        } else {
            String previousPackageHash = getPreviousPackageHash();
            if (previousPackageHash != null && !previousPackageHash.equals(packageHash) && !previousPackageHash.equals(basePackageHash)) {
                FileUtils.deleteDirectoryAtPath(getPackageFolderPath(previousPackageHash));
            }

            CodePushUtils.setJSONValueForKey(info, CodePushConstants.PREVIOUS_PACKAGE_KEY, info.optString(CodePushConstants.CURRENT_PACKAGE_KEY, null));
        }

        CodePushUtils.setJSONValueForKey(info, CodePushConstants.CURRENT_PACKAGE_KEY, packageHash);
        updateCurrentPackageInfo(info);
    }

    public void rollbackPackage() {
        JSONObject info = getCurrentPackageInfo();
        String currentPackageFolderPath = getCurrentPackageFolderPath();
        FileUtils.deleteDirectoryAtPath(currentPackageFolderPath);
        CodePushUtils.setJSONValueForKey(info, CodePushConstants.CURRENT_PACKAGE_KEY, info.optString(CodePushConstants.PREVIOUS_PACKAGE_KEY, null));
        CodePushUtils.setJSONValueForKey(info, CodePushConstants.PREVIOUS_PACKAGE_KEY, null);
        updateCurrentPackageInfo(info);
    }

    public void downloadAndReplaceCurrentBundle(String remoteBundleUrl, String bundleFileName) throws IOException {
        URL downloadUrl;
        HttpURLConnection connection = null;
        BufferedInputStream bin = null;
        FileOutputStream fos = null;
        BufferedOutputStream bout = null;
        try {
            downloadUrl = new URL(remoteBundleUrl);
            connection = (HttpURLConnection) (downloadUrl.openConnection());
            bin = new BufferedInputStream(connection.getInputStream());
            File downloadFile = new File(getCurrentPackageBundlePath(bundleFileName));
            downloadFile.delete();
            fos = new FileOutputStream(downloadFile);
            bout = new BufferedOutputStream(fos, CodePushConstants.DOWNLOAD_BUFFER_SIZE);
            byte[] data = new byte[CodePushConstants.DOWNLOAD_BUFFER_SIZE];
            int numBytesRead = 0;
            while ((numBytesRead = bin.read(data, 0, CodePushConstants.DOWNLOAD_BUFFER_SIZE)) >= 0) {
                bout.write(data, 0, numBytesRead);
            }
        } catch (MalformedURLException e) {
            throw new CodePushMalformedDataException(remoteBundleUrl, e);
        } finally {
            try {
                if (bout != null) bout.close();
                if (fos != null) fos.close();
                if (bin != null) bin.close();
                if (connection != null) connection.disconnect();
            } catch (IOException e) {
                throw new CodePushUnknownException("Error closing IO resources.", e);
            }
        }
    }

    public void clearUpdates() {
        FileUtils.deleteDirectoryAtPath(getCodePushPath());
    }

    public String getPackageHashFromJSBundleFile(String jsBundleFile) {
        String codePushPath = getCodePushPath();

        if (!jsBundleFile.startsWith(codePushPath)) return null;

        String[] strArray = jsBundleFile.replace(codePushPath, "")
                .split(String.valueOf(File.separatorChar));

        if (strArray.length >= 2) {
            return strArray[1];
        }

        return null;
    }

    public String getBinaryJSBundleUrl(String assetsBundleFileName) {
        if (CodePushUpdateUtils.isAssetBundleFileExists(context, assetsBundleFileName)) {
            return CodePushConstants.ASSETS_BUNDLE_PREFIX + assetsBundleFileName;
        } else {
            try {
                return getBasePackageBundlePath(assetsBundleFileName);
            } catch (CodePushMalformedDataException e) {
                // We need to recover the app in case 'codepush.json' is corrupted
                CodePushUtils.log(e.getMessage());
            }
        }

        return null;
    }

    public static class CustomDownloadProgressCallback implements DownloadProgressCallback {

        private long mTotalBytes;
        private long mOffsetBytes;
        private DownloadProgressCallback mCallback;

        public CustomDownloadProgressCallback(long totalBytes, long offsetBytes, DownloadProgressCallback callback) {
            mTotalBytes = totalBytes;
            mOffsetBytes = offsetBytes;
            mCallback = callback;
        }

        @Override
        public void call(DownloadProgress downloadProgress) {
            mCallback.call(new DownloadProgress(mTotalBytes, mOffsetBytes + downloadProgress.getReceivedBytes()));
        }

        @Override
        public void patchEvent(CodePushPatchState state, int errorCode) {
            mCallback.patchEvent(state, errorCode);
        }
    }

}
