package com.dahonghua.flutter_app

import com.dahonghua.flutter_app.notif.NotifChannel
import com.dahonghua.flutter_app.widget.WidgetChannel
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
  override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
    super.configureFlutterEngine(flutterEngine)
    // `applicationContext`, not the activity: the queue and the capture flag
    // outlive any one screen, and the listener writes to them from a process
    // where this activity does not exist.
    NotifChannel.register(
      flutterEngine.dartExecutor.binaryMessenger,
      applicationContext,
    )
    // Same reason for `applicationContext`: a widget is drawn by the launcher
    // in a process where this activity does not exist.
    WidgetChannel.register(
      flutterEngine.dartExecutor.binaryMessenger,
      applicationContext,
    )
  }
}
