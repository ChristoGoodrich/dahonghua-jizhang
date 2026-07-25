const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo config plugin for Android budget widget.
 * Copies widget files to the android project during prebuild.
 */
function withAndroidWidget(config) {
  // Add widget receiver to AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const app = manifest.application[0];

    // Check if receiver already exists
    const existingReceiver = app.receiver?.find(
      (r) => r.$?.["android:name"] === ".widget.BudgetWidgetProvider"
    );

    if (!existingReceiver) {
      if (!app.receiver) app.receiver = [];
      app.receiver.push({
        $: {
          "android:name": ".widget.BudgetWidgetProvider",
          "android:exported": "true",
          "android:label": "@string/widget_name",
        },
        "intent-filter": [
          {
            action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }],
          },
        ],
        "meta-data": [
          {
            $: {
              "android:name": "android.appwidget.provider",
              "android:resource": "@xml/widget_budget_info",
            },
          },
        ],
      });
    }

    return config;
  });

  // Copy widget files during prebuild
  config = withDangerousMod(config, [
    "android",
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidPath = path.join(projectRoot, "android");
      const pluginPath = path.join(projectRoot, "plugins", "android-widget");

      // Create widget package directory
      const widgetDir = path.join(
        androidPath,
        "app",
        "src",
        "main",
        "java",
        "com",
        "dahonghua",
        "app",
        "widget"
      );
      fs.mkdirSync(widgetDir, { recursive: true });

      // Copy Kotlin files
      const kotlinFiles = [
        "BudgetWidgetProvider.kt",
        "WidgetModule.kt",
        "WidgetPackage.kt",
      ];
      for (const file of kotlinFiles) {
        const src = path.join(pluginPath, "kotlin", file);
        const dest = path.join(widgetDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }

      // Copy resource files
      const resDir = path.join(androidPath, "app", "src", "main", "res");

      // Layout
      const layoutDir = path.join(resDir, "layout");
      fs.mkdirSync(layoutDir, { recursive: true });
      const layoutSrc = path.join(pluginPath, "res", "layout", "widget_budget.xml");
      if (fs.existsSync(layoutSrc)) {
        fs.copyFileSync(layoutSrc, path.join(layoutDir, "widget_budget.xml"));
      }

      // Drawable
      const drawableDir = path.join(resDir, "drawable");
      fs.mkdirSync(drawableDir, { recursive: true });
      for (const file of ["widget_background.xml", "widget_progress_drawable.xml"]) {
        const src = path.join(pluginPath, "res", "drawable", file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(drawableDir, file));
        }
      }

      // XML
      const xmlDir = path.join(resDir, "xml");
      fs.mkdirSync(xmlDir, { recursive: true });
      const xmlSrc = path.join(pluginPath, "res", "xml", "widget_budget_info.xml");
      if (fs.existsSync(xmlSrc)) {
        fs.copyFileSync(xmlSrc, path.join(xmlDir, "widget_budget_info.xml"));
      }

      // Update strings.xml
      const stringsPath = path.join(resDir, "values", "strings.xml");
      if (fs.existsSync(stringsPath)) {
        let strings = fs.readFileSync(stringsPath, "utf-8");
        if (!strings.includes("widget_name")) {
          strings = strings.replace(
            "</resources>",
            '  <string name="widget_name">预算概览</string>\n  <string name="widget_description">查看本月预算使用情况</string>\n</resources>'
          );
          fs.writeFileSync(stringsPath, strings);
        }
      }

      return config;
    },
  ]);

  return config;
}

module.exports = withAndroidWidget;
