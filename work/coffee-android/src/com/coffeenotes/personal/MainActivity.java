package com.coffeenotes.personal;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.content.res.Configuration;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline local-content activity. It never navigates to or loads a remote page. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String URL = "https://" + HOST + "/assets/index.html";
    private static final int PICK_FILE = 31, CREATE_BACKUP = 32;
    private static final int MAX_BACKUP_BYTES = 12 * 1024 * 1024;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private WebView web;
    private FrameLayout root;
    private ValueCallback<Uri[]> fileCallback;
    private boolean exporting, destroyed, pageReady, backPending, exportPickerOpen;
    private boolean filePickerOpen;
    private String exportName, exportMime;
    private Boolean queuedExportResult;
    private String queuedExportMessage;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(251, 250, 245));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                int types = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                        | WindowInsets.Type.ime();
                android.graphics.Insets all = insets.getInsets(types);
                view.setPadding(all.left, all.top, all.right, all.bottom);
                // The native container already handled these areas. Forward zeroes so
                // modern WebView does not pad or shrink the web viewport a second time.
                return new WindowInsets.Builder(insets)
                        .setInsets(types, android.graphics.Insets.NONE).build();
            });
            root.requestApplyInsets();
        }
        if (savedInstanceState != null && pendingFile().isFile()) {
            exportPickerOpen = savedInstanceState.getBoolean("exportPickerOpen", false);
            exporting = exportPickerOpen;
            exportName = savedInstanceState.getString("exportName");
            exportMime = savedInstanceState.getString("exportMime");
        }
        if (savedInstanceState != null) {
            filePickerOpen = savedInstanceState.getBoolean("filePickerOpen", false);
            if (savedInstanceState.containsKey("exportResult")) {
                queuedExportResult = savedInstanceState.getBoolean("exportResult");
                queuedExportMessage = savedInstanceState.getString("exportMessage", "");
            }
        }
        createWebView();
    }

    @SuppressWarnings("deprecation") private void createWebView() {
        pageReady = false;
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(251, 250, 245));
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        // Content URIs are returned only by the system document picker, after user selection.
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setTextZoom(100);
        settings.setSafeBrowsingEnabled(true);
        web.addJavascriptInterface(new NativeBridge(), "CoffeeAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isLocal(uri) && "/assets/index.html".equals(uri.getPath())
                        && "GET".equals(request.getMethod())) {
                    try {
                        return new WebResourceResponse("text/html", "UTF-8", 200, "OK",
                                Collections.singletonMap("Cache-Control", "no-cache"),
                                getAssets().open("index.html"));
                    } catch (Exception error) {
                        return failedResponse("本地页面无法读取，请重新安装安装包。", 500);
                    }
                }
                return failedResponse("资源不存在", 404);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isLocal(request.getUrl()) || !"/assets/index.html".equals(request.getUrl().getPath());
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (view != web || !URL.equals(url)) return;
                pageReady = true;
                if (queuedExportResult != null) {
                    boolean result = queuedExportResult;
                    String message = queuedExportMessage;
                    queuedExportResult = null; queuedExportMessage = null;
                    notifyExport(result, message);
                }
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view == web) { web = null; pageReady = false; backPending = false; }
                if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
                root.removeView(view);
                view.destroy();
                if (!destroyed && !isFinishing()) {
                    new AlertDialog.Builder(MainActivity.this)
                            .setTitle("重新打开咖啡手记")
                            .setMessage("页面组件暂时停止了。已保存的记录仍在，可以重新打开继续补记。")
                            .setPositiveButton("重新打开", (d, which) -> createWebView())
                            .setNegativeButton("关闭", (d, which) -> finish()).show();
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                       FileChooserParams params) {
                if (!isLocal(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) return false;
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                filePickerOpen = true;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                String[] accepts = params.getAcceptTypes();
                boolean images = false;
                for (String accept : accepts) if (accept != null && accept.startsWith("image/")) images = true;
                picker.setType(images ? "image/*" : "*/*");
                // Document providers disagree about JSON MIME types; the web importer
                // validates content, so do not hide a valid backup by its MIME label.
                if (images) picker.putExtra(Intent.EXTRA_MIME_TYPES,
                        new String[]{"image/jpeg", "image/png", "image/webp"});
                try { startActivityForResult(picker, PICK_FILE); }
                catch (ActivityNotFoundException | SecurityException error) {
                    filePickerOpen = false;
                    fileCallback.onReceiveValue(null); fileCallback = null;
                    Toast.makeText(MainActivity.this, "手机暂时没有可用的文件选择器", Toast.LENGTH_LONG).show();
                }
                return true;
            }
            @Override public boolean onJsBeforeUnload(WebView view, String url, String message,
                                                     android.webkit.JsResult result) {
                result.cancel();
                return true;
            }
        });
        web.loadUrl(URL);
    }

    private static boolean isLocal(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getUserInfo() == null;
    }
    private static WebResourceResponse failedResponse(String message, int status) {
        return new WebResourceResponse("text/plain", "UTF-8", status, "Unavailable",
                Collections.emptyMap(), new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }
    private File pendingFile() { return new File(getCacheDir(), "coffee-pending-export"); }

    public final class NativeBridge {
        @JavascriptInterface public void saveBackup(String contents, String name, String mime) {
            runOnUiThread(() -> {
                if (destroyed || web == null || !isLocal(Uri.parse(web.getUrl() == null ? "" : web.getUrl()))) return;
                if (exporting) { notifyExport(false, "已有一份备份正在保存，请完成或取消后再试。"); return; }
                if (contents == null || contents.length() > MAX_BACKUP_BYTES || name == null
                        || name.length() > 160 || !(name.endsWith(".json") || name.endsWith(".txt"))) {
                    notifyExport(false, "备份内容或名称无效，原有记录没有改变。"); return;
                }
                byte[] bytes = contents.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > MAX_BACKUP_BYTES) { notifyExport(false, "备份过大，请减少图片后再导出。"); return; }
                exporting = true;
                exportName = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
                exportMime = "text/plain".equals(mime) ? "text/plain" : "application/json";
                io.execute(() -> {
                    try (OutputStream output = new FileOutputStream(pendingFile())) { output.write(bytes); }
                    catch (Exception error) { runOnUiThread(() -> { exporting = false; notifyExport(false, "备份暂时无法准备，请重试。"); }); return; }
                    runOnUiThread(() -> {
                        if (destroyed || isFinishing()) return;
                        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType(exportMime);
                        intent.putExtra(Intent.EXTRA_TITLE, exportName);
                        try {
                            exportPickerOpen = true;
                            startActivityForResult(intent, CREATE_BACKUP);
                        }
                        catch (ActivityNotFoundException | SecurityException error) {
                            clearExport(); notifyExport(false, "手机暂时没有可用的文件保存器。");
                        }
                    });
                });
            });
        }
        @JavascriptInterface public void setAppearance(String theme) {
            runOnUiThread(() -> {
                if (destroyed) return;
                boolean dark = "dark".equals(theme);
                int color = dark ? Color.rgb(25, 30, 23) : Color.rgb(251, 250, 245);
                root.setBackgroundColor(color);
                if (web != null) web.setBackgroundColor(color);
                getWindow().setStatusBarColor(color);
                getWindow().setNavigationBarColor(color);
                if (Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
                    int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    getWindow().getInsetsController().setSystemBarsAppearance(dark ? 0 : mask, mask);
                } else {
                    root.setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                            | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
                }
            });
        }
    }

    private void notifyExport(boolean ok, String message) {
        if (destroyed) return;
        if (web == null || !pageReady) {
            queuedExportResult = ok; queuedExportMessage = message; return;
        }
        web.evaluateJavascript("window.CoffeeNative&&window.CoffeeNative.onExportResult("
                + ok + "," + JSONObject.quote(message) + ")", null);
    }
    private void clearExport() {
        exporting = false; exportPickerOpen = false; exportName = null; exportMime = null;
        pendingFile().delete();
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE) {
            filePickerOpen = false;
            if (fileCallback != null) {
                Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
                fileCallback.onReceiveValue(uri != null && "content".equals(uri.getScheme()) ? new Uri[]{uri} : null);
                fileCallback = null;
            } else if (resultCode == RESULT_OK) {
                Toast.makeText(this, "页面已重新打开，请再次选择照片或备份文件。", Toast.LENGTH_LONG).show();
            }
        } else if (requestCode == CREATE_BACKUP) {
            exportPickerOpen = false;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (uri == null || !"content".equals(uri.getScheme())) {
                clearExport(); notifyExport(false, "已取消导出，记录仍在手机内。"); return;
            }
            io.execute(() -> {
                boolean success = false;
                try (InputStream input = new FileInputStream(pendingFile());
                     OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IllegalStateException("No output stream");
                    byte[] buffer = new byte[8192]; int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    output.flush(); success = true;
                } catch (Exception error) { /* UI reports failure; original app data is unchanged. */ }
                final boolean saved = success;
                runOnUiThread(() -> { clearExport(); notifyExport(saved, saved
                        ? "备份已保存到你选择的位置。" : "这次备份没有保存成功，记录仍在手机内，请重试。"); });
            });
        }
    }

    @Override public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        if (backPending) return;
        backPending = true;
        web.evaluateJavascript("window.CoffeeNative?window.CoffeeNative.handleBack():false", value -> {
            backPending = false;
            if (destroyed || isFinishing()) return;
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        // Keep the same document, input focus and draft when rotating or resizing.
        root.requestApplyInsets();
    }
    @Override protected void onPause() {
        if (web != null) web.evaluateJavascript("window.CoffeeNative&&window.CoffeeNative.onBackground()", null);
        super.onPause();
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putBoolean("exportPickerOpen", exportPickerOpen);
        out.putBoolean("filePickerOpen", filePickerOpen);
        out.putString("exportName", exportName); out.putString("exportMime", exportMime);
        if (queuedExportResult != null) {
            out.putBoolean("exportResult", queuedExportResult);
            out.putString("exportMessage", queuedExportMessage);
        }
    }
    @Override protected void onDestroy() {
        destroyed = true;
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (web != null) { root.removeView(web); web.removeJavascriptInterface("CoffeeAndroid"); web.destroy(); web = null; }
        io.shutdown();
        super.onDestroy();
    }
}
