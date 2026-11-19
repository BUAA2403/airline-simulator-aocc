package com.polarisair.aocc;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintManager;
import android.print.PrintAttributes;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class MainActivity extends Activity {
 private static final String HOST="appassets.androidplatform.net",ORIGIN="https://"+HOST,KEY="polaris-aocc-session-v1";
 private final ExecutorService workers=Executors.newFixedThreadPool(4);
 private WebView web; private SQLiteDatabase db;
 private String sessionRequest,saveRequest,saveContent;private ValueCallback<Uri[]> fileCallback;
 private static final int SESSION=1,SAVE=2,UPLOAD=3;
 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  android.content.pm.PackageInfo provider=WebView.getCurrentWebViewPackage();
  try{if(provider==null||Integer.parseInt(provider.versionName.split("\\.")[0])<110){new AlertDialog.Builder(this).setMessage("请先更新 Android System WebView / Chrome（至少 110 版本），然后重新打开运行中心。").setPositiveButton("打开更新页面",(dialog,which)->{openExternal(Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.webview"));finish();}).setNegativeButton("关闭",(dialog,which)->finish()).setCancelable(false).show();return;}}catch(Exception error){message("请确保 Android System WebView 已更新");}
  db=openOrCreateDatabase("polaris-phone.sqlite",MODE_PRIVATE,null);
  db.execSQL("CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,airline TEXT,source TEXT,bucket TEXT,captured_at TEXT,body TEXT,bytes INTEGER,UNIQUE(airline,source,bucket))");
  db.execSQL("CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,level TEXT,message TEXT)");
  FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.rgb(23,54,78));
  web=new WebView(this);frame.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(frame);
  frame.setOnApplyWindowInsetsListener((view,insets)->{
   if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets padding=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());view.setPadding(padding.left,padding.top,padding.right,padding.bottom);}
   else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
   return insets;
  });
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSafeBrowsingEnabled(true);settings.setJavaScriptCanOpenWindowsAutomatically(false);
  web.setBackgroundColor(Color.rgb(23,54,78));web.addJavascriptInterface(new NativeBridge(),"PolarisNative");
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
    Uri uri=request.getUrl();if(local(uri))return false;
    if(request.isForMainFrame()&&"https".equals(uri.getScheme()))openExternal(uri);
    return true;
   }
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    Uri uri=request.getUrl();if(!local(uri)||!"GET".equals(request.getMethod()))return denied();
    String asset=uri.getPath();if(asset==null||asset.contains("..")||asset.contains("\\")||asset.indexOf('\0')>=0)return denied();
    if("/".equals(asset))asset="/index.html";
    try{
     Map<String,String> headers=new HashMap<>();headers.put("X-Content-Type-Options","nosniff");headers.put("Cache-Control","no-cache");headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
     return new WebResourceResponse(mime(asset),"UTF-8",200,"OK",headers,getAssets().open(asset.substring(1)));
    }catch(Exception error){return denied();}
   }
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
    if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
    try{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.setType("*/*");intent.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(intent,UPLOAD);}catch(Exception error){fileCallback=null;callback.onReceiveValue(null);}return true;
   }
  });
  web.loadUrl(ORIGIN+"/index.html");
 }
 private boolean local(Uri uri){return "https".equals(uri.getScheme())&&HOST.equals(uri.getHost())&&uri.getPort()==-1&&uri.getUserInfo()==null;}
 private WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
 private static String mime(String file){
  if(file.endsWith(".html"))return "text/html";if(file.endsWith(".js")||file.endsWith(".mjs"))return "application/javascript";if(file.endsWith(".css"))return "text/css";if(file.endsWith(".json"))return "application/json";if(file.endsWith(".svg"))return "image/svg+xml";if(file.endsWith(".webp"))return "image/webp";if(file.endsWith(".png"))return "image/png";if(file.endsWith(".jpg"))return "image/jpeg";if(file.endsWith(".woff2"))return "font/woff2";return "text/plain";
 }
 private void openExternal(Uri uri){try{startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));}catch(Exception error){message("请安装浏览器后打开官方页面");}}
 private void message(String value){runOnUiThread(()->Toast.makeText(this,value,Toast.LENGTH_LONG).show());}
 private void reply(String id,JSONObject value){runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.__polarisReply?.("+JSONObject.quote(id)+","+value.toString()+")",null);});}
 private void failed(String id){JSONObject value=new JSONObject();try{value.put("error",true);}catch(Exception ignored){}reply(id,value);}
 private static byte[] readBounded(InputStream stream,int max)throws Exception{
  if(stream==null)return new byte[0];try(InputStream input=stream;ByteArrayOutputStream output=new ByteArrayOutputStream()){
   byte[] bytes=new byte[16384];int count;while((count=input.read(bytes))!=-1){if(output.size()+count>max)throw new Exception("limit");output.write(bytes,0,count);}return output.toByteArray();
  }
 }
 private SecretKey sessionKey()throws Exception{
  KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);if(keys.containsAlias(KEY))return ((KeyStore.SecretKeyEntry)keys.getEntry(KEY,null)).getSecretKey();
  KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");generator.init(new KeyGenParameterSpec.Builder(KEY,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return generator.generateKey();
 }
 public final class NativeBridge{
  @JavascriptInterface public synchronized String loadConfig(){
   String stored=getSharedPreferences("vault",MODE_PRIVATE).getString("session",null);if(stored==null)return "{}";
   try{JSONObject envelope=new JSONObject(stored);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,sessionKey(),new GCMParameterSpec(128,Base64.decode(envelope.getString("iv"),Base64.NO_WRAP)));return new String(cipher.doFinal(Base64.decode(envelope.getString("body"),Base64.NO_WRAP)),StandardCharsets.UTF_8);}catch(Exception error){throw new IllegalStateException("手机授权无法解密，请重新授权");}
  }
  @JavascriptInterface public synchronized boolean saveConfig(String text){
   try{if(text.length()>40000)return false;new JSONObject(text);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,sessionKey());JSONObject envelope=new JSONObject();envelope.put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP));envelope.put("body",Base64.encodeToString(cipher.doFinal(text.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));return getSharedPreferences("vault",MODE_PRIVATE).edit().putString("session",envelope.toString()).commit();}catch(Exception error){return false;}
  }
  @JavascriptInterface public String sha256(String text){
   try{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder();for(byte value:bytes)hex.append(String.format("%02x",value&255));return hex.toString();}catch(Exception error){throw new IllegalStateException("hash");}
  }
  @JavascriptInterface public void showMessage(String text){message(text.length()>250?text.substring(0,250):text);}
  @JavascriptInterface public void showGuide(){runOnUiThread(()->new AlertDialog.Builder(MainActivity.this).setTitle("手机独立连接指南").setMessage("1. 进入「数据连接」，在手机 Chrome 中打开官方涂装编辑器并登录。\n\n2. 收藏官方页面，书签名称设为「北极星授权」。复制应用提供的手机授权工具，编辑书签，把网址完整替换为复制内容。\n\n3. 在已登录的官方页面地址栏输入「北极星授权」，点选书签，下载授权 JSON 文件。\n\n4. 回应用选择该文件。成功后删除下载目录中的临时授权文件。\n\n应用在前台时每 60 秒同步，后台暂停；离线时显示上次快照。手机使用独立会话，无需启动电脑。\n\n请在手机重新登录，不要导入电脑端的会话，以免共享刷新令牌。Google 密码只在官方登录页面输入。").setPositiveButton("知道了",null).show());}
  @JavascriptInterface public void printDocument(){runOnUiThread(()->{try{((PrintManager)getSystemService(PRINT_SERVICE)).print("Airline Simulator AOCC 航班计划",web.createPrintDocumentAdapter("POLARIS-AIR-timetable"),new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape()).build());}catch(Exception error){message("无法打印，请使用下载时刻表");}});}
  @JavascriptInterface public void copyText(String text){
   if(!text.startsWith("javascript:")||text.length()>10000)return;
   runOnUiThread(()->((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("AOCC 手机授权工具",text)));
  }
  @JavascriptInterface public synchronized String data(String operation,String raw){
   try{
    JSONObject input=new JSONObject(raw),result=new JSONObject();Object value=JSONObject.NULL;
    if("latest".equals(operation)){
     try(Cursor rows=db.rawQuery("SELECT body,source FROM snapshots ORDER BY id DESC LIMIT 1",null)){if(rows.moveToFirst())value=new JSONObject().put("snapshot",new JSONObject(rows.getString(0))).put("source",rows.getString(1));}
    }else if("save".equals(operation)){
     JSONObject snapshot=input.getJSONObject("snapshot");String text=snapshot.toString(),airline=snapshot.getJSONObject("airline").getString("id"),source=input.getString("source"),at=snapshot.getString("capturedAt");int bytes=text.getBytes(StandardCharsets.UTF_8).length;
     if(bytes>25*1024*1024||at.length()<13)throw new Exception("snapshot limit");
     db.beginTransaction();try{
      db.execSQL("INSERT OR REPLACE INTO snapshots(airline,source,bucket,captured_at,body,bytes) VALUES(?,?,?,?,?,?)",new Object[]{airline,source,at.substring(0,13),at,text,bytes});
      db.execSQL("DELETE FROM snapshots WHERE id IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT -1 OFFSET 336)");
      long total=0;try(Cursor rows=db.rawQuery("SELECT id,bytes FROM snapshots ORDER BY id DESC",null)){while(rows.moveToNext()){total+=rows.getInt(1);if(total>64L*1024*1024)db.delete("snapshots","id=?",new String[]{rows.getString(0)});}}
      db.setTransactionSuccessful();
     }finally{db.endTransaction();}
     value=true;
    }else if("history".equals(operation)||"analysis".equals(operation)){
     JSONArray values=new JSONArray();boolean analysis="analysis".equals(operation);
     String sql="SELECT body FROM snapshots WHERE airline=? AND source=?"+(analysis?" AND captured_at<=?":"")+" ORDER BY captured_at DESC LIMIT 168";
     String[] args=analysis?new String[]{input.getString("airlineId"),input.getString("source"),input.getString("capturedAt")}:new String[]{input.getString("airlineId"),input.getString("source")};
     try(Cursor rows=db.rawQuery(sql,args)){if(rows.moveToLast())do{
      JSONObject s=new JSONObject(rows.getString(0));if(analysis){values.put(s);continue;}
      JSONObject a=s.getJSONObject("airline"),metrics=s.optJSONObject("metrics");if(metrics==null)metrics=new JSONObject();
      values.put(new JSONObject().put("capturedAt",s.getString("capturedAt")).put("cash",a.opt("cash")).put("accountCash",metrics.opt("accountCash")).put("aircraftCount",s.getJSONArray("aircraft").length()).put("flightCount",s.getJSONArray("flights").length()).put("routeCount",s.getJSONArray("routes").length()).put("revenue",metrics.opt("revenue")));
     }while(rows.moveToPrevious());}value=values;
    }else if("log".equals(operation)){
     String level=input.getString("level"),text=input.getString("message");db.execSQL("INSERT INTO events(at,level,message) VALUES(?,?,?)",new Object[]{java.time.Instant.now().toString(),level,text});db.execSQL("DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY id DESC LIMIT -1 OFFSET 200)");value=true;
    }else if("logs".equals(operation)){
     JSONArray values=new JSONArray();try(Cursor rows=db.rawQuery("SELECT at,level,message FROM events ORDER BY id DESC LIMIT 40",null)){while(rows.moveToNext())values.put(new JSONObject().put("at",rows.getString(0)).put("level",rows.getString(1)).put("message",rows.getString(2)));}value=values;
    }else throw new Exception("operation");
    return result.put("value",value).toString();
   }catch(Exception error){return "{\"error\":true}";}
  }
  @JavascriptInterface public void request(String id,String raw){workers.execute(()->{
   HttpURLConnection connection=null;
   try{
    JSONObject input=new JSONObject(raw);URL url=new URL(input.getString("url"));String method=input.optString("method","GET"),host=url.getHost(),path=url.getPath();
    boolean auth="auth.airline-simulator.com".equals(host),game="urmwaqnhesasfaeprcga-all.supabase.co".equals(host)||"urmwaqnhesasfaeprcga.supabase.co".equals(host);
    boolean authRead=auth&&"GET".equals(method)&&"/auth/v1/user".equals(path);
    boolean refresh=auth&&"POST".equals(method)&&"/auth/v1/token".equals(path)&&"grant_type=refresh_token".equals(url.getQuery());
    boolean gameRead=game&&"GET".equals(method)&&path.matches("/rest/v1/(player_aircraft_data|new_player_flight_data|player_route_data|potion_usage|rpc/get_master_player_by_master_uid|rpc/get_player_by_uid|rpc/get_server_time)");
    if(!"https".equals(url.getProtocol())||url.getUserInfo()!=null||(url.getPort()!=-1&&url.getPort()!=443)||url.getRef()!=null||!(authRead||refresh||gameRead))throw new Exception("destination");
    JSONObject headers=input.optJSONObject("headers");connection=(HttpURLConnection)url.openConnection();connection.setConnectTimeout(15000);connection.setReadTimeout(15000);connection.setInstanceFollowRedirects(false);connection.setRequestMethod(method);
    if(headers!=null){for(String key:new String[]{"apikey","Authorization","Content-Type"})if(headers.has(key)){String value=headers.getString(key);if(value.contains("\r")||value.contains("\n")||value.length()>20000)throw new Exception("header");connection.setRequestProperty(key,value);}}
    if(refresh){JSONObject body=new JSONObject(input.getString("body"));String token=body.getString("refresh_token");if(body.length()!=1||token.length()>16000)throw new Exception("refresh body");connection.setDoOutput(true);try(OutputStream out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
    int status=connection.getResponseCode();String text=new String(readBounded(status>=400?connection.getErrorStream():connection.getInputStream(),50*1024*1024),StandardCharsets.UTF_8);
    JSONObject responseHeaders=new JSONObject();String retry=connection.getHeaderField("Retry-After");if(retry!=null)responseHeaders.put("retry-after",retry);
    reply(id,new JSONObject().put("status",status).put("body",text).put("headers",responseHeaders));
   }catch(Exception error){failed(id);}finally{if(connection!=null)connection.disconnect();}
  });}
  @JavascriptInterface public void chooseSession(String id,String ignored){runOnUiThread(()->{
   if(sessionRequest!=null||saveRequest!=null){failed(id);return;}sessionRequest=id;
   try{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");startActivityForResult(intent,SESSION);}catch(Exception error){sessionRequest=null;failed(id);}
  });}
  @JavascriptInterface public void saveFile(String id,String raw){runOnUiThread(()->{
   if(saveRequest!=null||sessionRequest!=null){failed(id);return;}
   try{JSONObject input=new JSONObject(raw);String name=input.getString("name").replaceAll("[^a-zA-Z0-9_.-]","_");String content=input.getString("base64");if(content.length()>70*1024*1024)throw new Exception("size");saveRequest=id;saveContent=content;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(input.optString("mime","application/octet-stream").split(";")[0]);intent.putExtra(Intent.EXTRA_TITLE,name);startActivityForResult(intent,SAVE);}catch(Exception error){saveRequest=null;saveContent=null;failed(id);}
  });}
 }
 @Override protected void onActivityResult(int requestCode,int resultCode,Intent intent){
  super.onActivityResult(requestCode,resultCode,intent);Uri uri=resultCode==RESULT_OK&&intent!=null?intent.getData():null;
  if(requestCode==UPLOAD){if(fileCallback!=null){fileCallback.onReceiveValue(uri==null?null:new Uri[]{uri});fileCallback=null;}return;}
  if(requestCode==SESSION){String id=sessionRequest;sessionRequest=null;if(id==null)return;workers.execute(()->{
   try{String text=uri==null?null:new String(readBounded(getContentResolver().openInputStream(uri),100000),StandardCharsets.UTF_8);reply(id,new JSONObject().put("text",text==null?JSONObject.NULL:text));}catch(Exception error){failed(id);}
  });}
  if(requestCode==SAVE){String id=saveRequest,content=saveContent;saveRequest=null;saveContent=null;if(id==null)return;workers.execute(()->{
   try{if(uri!=null){try(OutputStream out=getContentResolver().openOutputStream(uri)){out.write(Base64.decode(content,Base64.NO_WRAP));}message("文件已保存");}reply(id,new JSONObject().put("saved",uri!=null));}catch(Exception error){failed(id);}
  });}
 }
 @Override protected void onPause(){if(web!=null){web.evaluateJavascript("window.__aoccPause?.()",null);web.onPause();}super.onPause();}
 @Override protected void onResume(){super.onResume();if(web!=null){web.onResume();web.evaluateJavascript("window.__aoccResume?.()",null);}}
 @Override public void onBackPressed(){if(web!=null)web.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))",null);new AlertDialog.Builder(this).setMessage("退出手机运行中心？数据将保留，下次打开时继续同步。").setNegativeButton("继续使用",null).setPositiveButton("退出",(dialog,which)->finish()).show();}
 @Override protected void onDestroy(){if(web!=null){web.removeJavascriptInterface("PolarisNative");web.destroy();web=null;}workers.shutdownNow();if(db!=null)db.close();super.onDestroy();}
}
